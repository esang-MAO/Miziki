-- =====================================================================
-- Migration 13: pushes that can't go backwards (RF18, docs/12_REFINE.md)
--
-- Bug this closes: library_backup's own upsert (src/sync/backup.js's
-- pushBackup()) is a plain `.upsert(..., {onConflict:'user_id,device_id'})`
-- with no ordering guarantee at all. A retry after network backoff
-- (BACKOFF, same file) that lands *after* a newer push from the same
-- device already succeeded -- the ordinary "request A is slow, request B
-- for the same row is sent later and arrives first" race, nothing exotic
-- -- silently overwrites that device's own newer doc with its own older
-- one. Per RF18 point 2/3, a pull's own trailing push (pullAndMergeBackup's
-- "await pushBackup()" at the end) and a debounced runPush() can now also
-- genuinely overlap in flight, which is exactly this kind of race.
--
-- Fix: library_backup gains doc_seq, a plain bigint the client bumps once
-- per push *attempt* (S.backupPushSeq, src/state.js -- a simple per-device
-- counter, not to be confused with S.backupSeq, RF16's Lamport clock for
-- individual field stamps *inside* the doc; this one is row-level
-- ordering for the doc as a whole). The upsert moves behind a small RPC,
-- put_library_backup(), whose own ON CONFLICT clause only applies the
-- update `where library_backup.doc_seq < excluded.doc_seq` -- Postgres
-- still reports the statement as having "handled" the conflict either way,
-- so a stale, late-arriving retry is a quiet no-op on the server, not an
-- error the client has to catch.
--
-- security invoker (not definer): the existing RLS policies on
-- library_backup already require `user_id = auth.uid()` on every
-- operation, and this RPC inserts/updates with exactly that value, so it
-- needs no elevated privilege at all -- same reasoning 003_digging.sql's
-- digging_page()/digging_count() already used for staying invoker-mode
-- wherever RLS alone is enough (007_rhythm.sql's get_listening_rhythm()
-- is the one place in this schema that genuinely needs definer, since an
-- anon caller there has to reach the private schema at all).
--
-- doc_seq's own default of 0 (not null) matters for the one row shape this
-- RPC never sees: a pre-existing row from before this migration, upserted
-- by a client that hasn't pushed since the RF18 build shipped. Such a row
-- reads doc_seq = 0, so this device's own very first post-upgrade push
-- (p_seq starting at 1, since S.backupPushSeq's own in-memory default is 0
-- and pushBackup() increments before using it) always clears the
-- `doc_seq < excluded.doc_seq` check correctly.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 12) then
    raise exception 'migration 012 must be applied before 013';
  end if;
end $$;

alter table public.library_backup
  add column doc_seq bigint not null default 0;

create or replace function public.put_library_backup(
  p_device uuid,
  p_seq bigint,
  p_doc jsonb,
  p_device_label text,
  p_schema_version smallint
) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  insert into public.library_backup (user_id, device_id, device_label, schema_version, doc, doc_seq)
  values (auth.uid(), p_device, p_device_label, p_schema_version, p_doc, p_seq)
  on conflict (user_id, device_id) do update set
    device_label   = excluded.device_label,
    schema_version = excluded.schema_version,
    doc            = excluded.doc,
    doc_seq        = excluded.doc_seq
  where public.library_backup.doc_seq < excluded.doc_seq;
end $$;

revoke all on function public.put_library_backup(uuid, bigint, jsonb, text, smallint) from public, anon;
grant execute on function public.put_library_backup(uuid, bigint, jsonb, text, smallint) to authenticated;

insert into private.schema_migrations (version) values (13);
