-- =====================================================================
-- Migration 14: verify, and keep a way back (RF19, docs/12_REFINE.md)
--
-- Point 1: library_backup gains a checksum column -- a SHA-256 of the
-- doc's own canonical (key-order-independent) JSON form, computed
-- client-side (src/sync/images.js's sha256Hex, over
-- src/sync/backup-doc.js's new canonicalStringify(doc)) and sent
-- alongside the doc on every push. put_library_backup() (migration 13)
-- gains a sixth parameter, p_checksum, stored the same way doc/doc_seq
-- already are. The server never verifies it -- same as every other
-- merge rule in this schema, verification is a client-side concern
-- (src/sync/backup.js's fetchRemoteRows(), which recomputes the expected
-- checksum from each freshly-fetched row and skips -- never merges -- a
-- row whose checksum doesn't match, surfacing it via getBackupStatus()'s
-- lastError). Nullable, since a pre-migration-14 row (or a client that
-- hasn't upgraded yet) has none -- accepted without verification, the
-- same backward-compat posture every other optional column in this
-- schema already has.
--
-- Adding a parameter to put_library_backup() changes its own signature,
-- so (per migration 008's own precedent for set_now_spinning) the old
-- 5-argument version is dropped explicitly first, rather than left in
-- place as a second overload a plain `create or replace` would produce.
-- Body is otherwise byte-for-byte the same as migration 13's version --
-- only the new parameter and the one new column in the insert/upsert
-- are added. security invoker, same reasoning as migration 13: the
-- existing RLS policies already require user_id = auth.uid(), so no
-- elevated privilege is needed here either.
--
-- Point 3: library_backup_history -- a server-side "undo" a moderator
-- (or Ken himself, following docs/MODERATION.md's own restore snippet)
-- can reach for if a bad push (an app bug, a corrupted doc that still
-- happens to pass this migration's own structural checks, or -- now that
-- point 1/2 exist -- any row that got this far before verification
-- existed) ever overwrites a device's row with something worse than what
-- was there before. A `before update` trigger on library_backup copies
-- the *old* row into this table before the update applies, then prunes
-- that device's own history down to the most recent 10 rows -- a rolling
-- window, not an unbounded log. Nothing in the app reads this table --
-- see docs/MODERATION.md's own new restore section for the one hand-run
-- query that does.
--
-- RLS: owner-only select (so "Download my data"/a future UI could in
-- principle show a device's own history), no insert/update/delete policy
-- for ordinary users at all -- only the security definer trigger
-- function can ever write to it, the same way a trigger function is
-- otherwise unreachable as an ordinary RPC call (Postgres restricts
-- trigger functions to trigger context, so no separate revoke/grant is
-- needed to stop a client from invoking it directly).
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 13) then
    raise exception 'migration 013 must be applied before 014';
  end if;
end $$;

-- ---------- 1. checksum column + put_library_backup()'s 6th parameter ----
alter table public.library_backup add column checksum text;

drop function if exists public.put_library_backup(uuid, bigint, jsonb, text, smallint);

create function public.put_library_backup(
  p_device uuid,
  p_seq bigint,
  p_doc jsonb,
  p_device_label text,
  p_schema_version smallint,
  p_checksum text default null
) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  insert into public.library_backup (user_id, device_id, device_label, schema_version, doc, doc_seq, checksum)
  values (auth.uid(), p_device, p_device_label, p_schema_version, p_doc, p_seq, p_checksum)
  on conflict (user_id, device_id) do update set
    device_label   = excluded.device_label,
    schema_version = excluded.schema_version,
    doc            = excluded.doc,
    doc_seq        = excluded.doc_seq,
    checksum       = excluded.checksum
  where public.library_backup.doc_seq < excluded.doc_seq;
end $$;

revoke all on function public.put_library_backup(uuid, bigint, jsonb, text, smallint, text) from public, anon;
grant execute on function public.put_library_backup(uuid, bigint, jsonb, text, smallint, text) to authenticated;

-- ---------- 2. validateDoc() (point 2 of RF19) is client-side only --
-- src/sync/backup-doc.js's fromDocs(), applied to each remote row before
-- it's allowed to compete in a merge. Nothing here on the server needs
-- to change for it -- the server already never parses `doc` for any
-- other merge rule either (see library_backup's own original comment:
-- "the server never reads inside doc").

-- ---------- 3. library_backup_history: the last 10 rows per device ------
create table public.library_backup_history (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  device_id      uuid not null,
  device_label   text,
  schema_version smallint,
  doc            jsonb,
  doc_seq        bigint,
  checksum       text,
  updated_at     timestamptz,
  recorded_at    timestamptz not null default now()
);

create index library_backup_history_device_idx
  on public.library_backup_history (user_id, device_id, recorded_at desc);

alter table public.library_backup_history enable row level security;

create policy library_backup_history_select on public.library_backup_history for select to authenticated
  using (user_id = auth.uid());

revoke all on public.library_backup_history from public, anon;
-- No insert/update/delete grant to authenticated at all -- only the
-- trigger function below (security definer) ever writes to this table.

create function private.capture_library_backup_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.library_backup_history
    (user_id, device_id, device_label, schema_version, doc, doc_seq, checksum, updated_at)
  values
    (old.user_id, old.device_id, old.device_label, old.schema_version, old.doc, old.doc_seq, old.checksum, old.updated_at);

  delete from public.library_backup_history
  where user_id = old.user_id and device_id = old.device_id
    and id not in (
      select id from public.library_backup_history
      where user_id = old.user_id and device_id = old.device_id
      order by recorded_at desc, id desc
      limit 10
    );

  return new;
end $$;

create trigger library_backup_history_trg
  before update on public.library_backup
  for each row execute function private.capture_library_backup_history();

insert into private.schema_migrations (version) values (14);
