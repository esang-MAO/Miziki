-- =====================================================================
-- Miziki social layer — migration 5: account backup table, reserved
-- handles, account deletion, and the Oct 12 Security Advisor fixes.
--
-- Additive on top of 001-004 wherever possible; the four RLS helper
-- functions move to a new, API-invisible schema, and every function
-- body that called them by name is re-declared (create or replace) to
-- call the moved name instead — see each section's own comment for the
-- exact list. Never edit 001-004; this file is the only place those
-- functions' current, live bodies live from here on.
-- =====================================================================

-- ---------- 1. library_backup: one row per device, owned by that device
-- All merging happens on the client (src/sync/, B2) — the server never
-- reads inside `doc`, so two devices can never overwrite each other's
-- own row, and a bad/old doc on one device can't corrupt another's.
create table public.library_backup (
  user_id        uuid not null references auth.users(id) on delete cascade,
  device_id      uuid not null,
  device_label   text check (char_length(device_label) <= 60),
  schema_version smallint not null,
  doc            jsonb not null check (octet_length(doc::text) <= 2 * 1024 * 1024),
  updated_at     timestamptz not null default now(),
  primary key (user_id, device_id)
);

create trigger library_backup_touch
  before update on public.library_backup
  for each row execute function public.touch_updated_at();

alter table public.library_backup enable row level security;

create policy library_backup_select on public.library_backup for select to authenticated
  using (user_id = auth.uid());
create policy library_backup_insert on public.library_backup for insert to authenticated
  with check (user_id = auth.uid());
create policy library_backup_update on public.library_backup for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy library_backup_delete on public.library_backup for delete to authenticated
  using (user_id = auth.uid());

revoke all on public.library_backup from anon;

-- Listening history is private, even from friends: no view, feed or RPC
-- anywhere in this schema reads library_backup, and it never will.

-- ---------- 2. reserved handles --------------------------------------
-- Existing rows aren't checked (a trigger, not a validated CHECK
-- constraint, so nothing already stored is affected) — only future
-- inserts and handle changes. Keep this list in sync with the matching
-- RESERVED_HANDLES set in src/miziki-social.js.
create function public.profiles_handle_not_reserved()
returns trigger language plpgsql as $$
begin
  if lower(NEW.handle) = any (array[
    'admin', 'administrator', 'support', 'help', 'miziki', 'official',
    'security', 'moderator', 'mod', 'staff', 'team', 'root', 'system',
    'null', 'undefined'
  ]) then
    raise exception 'That handle is reserved';
  end if;
  return NEW;
end $$;

create trigger profiles_handle_reserved
  before insert or update of handle on public.profiles
  for each row execute function public.profiles_handle_not_reserved();

-- ---------- 3. delete_my_account(): irreversible, caller-only ---------
-- auth.users' existing `on delete cascade` foreign keys (profiles, and
-- everything that cascades from profiles: follows, blocks, crate_items,
-- verified_stats, now_spinning, digging_list, feed_events, reports) plus
-- library_backup's own (above) remove every row this user ever wrote.
-- Owned by postgres (the role every migration here runs as), which on
-- Supabase already has the grants needed to delete from auth.users —
-- the standard, documented shape for in-app account deletion.
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- 4. Security Advisor (Oct 12): move the RLS helpers out of
-- the API ---------------------------------------------------------------
-- is_blocked_between/effective_visibility/item_visibility/can_view are
-- security definer functions in public, so anyone — even signed out —
-- could call them directly through /rest/v1/rpc/..., leaking whether two
-- users blocked each other or whether a private crate item exists.
-- `private` is never added to Supabase's exposed Data API schemas, so
-- moving them there closes that off entirely. RLS policies reference a
-- function by its resolved OID at policy-creation time, not by schema­
-- qualified name, so every existing policy in 001/003 keeps working
-- completely unchanged — only the function *bodies* that call these four
-- by name need updating, listed in full below.
create schema private;
grant usage on schema private to authenticated;

alter function public.is_blocked_between(uuid, uuid) set schema private;
alter function public.item_visibility(uuid, uuid) set schema private;
alter function public.effective_visibility(uuid, public.visibility_level) set schema private;

-- can_view's own body calls the two functions just moved — re-declared
-- here (still as public.can_view for the moment) so the new, correct
-- private.* references are in place before it moves too.
create or replace function public.can_view(p_owner uuid, p_item public.visibility_level default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  viewer uuid := auth.uid();
  eff    public.visibility_level;
begin
  if viewer is not null and viewer = p_owner then
    return true;
  end if;

  eff := private.effective_visibility(p_owner, p_item);
  if eff is null or eff = 'private' then
    return false;
  end if;

  if viewer is not null and private.is_blocked_between(viewer, p_owner) then
    return false;
  end if;

  if eff = 'public' then
    return viewer is not null;   -- signed-in users only
  end if;

  -- friends: accepted followers only
  return viewer is not null and exists (
    select 1 from public.follows f
    where f.follower_id = viewer and f.followee_id = p_owner and f.status = 'accepted'
  );
end $$;

alter function public.can_view(uuid, public.visibility_level) set schema private;

revoke execute on function
  private.is_blocked_between(uuid, uuid),
  private.item_visibility(uuid, uuid),
  private.effective_visibility(uuid, public.visibility_level),
  private.can_view(uuid, public.visibility_level)
from public, anon;
grant execute on function
  private.is_blocked_between(uuid, uuid),
  private.item_visibility(uuid, uuid),
  private.effective_visibility(uuid, public.visibility_level),
  private.can_view(uuid, public.visibility_level)
to authenticated;

-- Every other function whose *body* called one of the four by name,
-- re-declared with the private.* reference — nothing else about any of
-- these changed (same triggers, same RPCs, same signatures, same
-- quiet-mode/milestone/visibility logic as 001/002/003's own versions).
--   001's triggers/helpers: follows_before_insert, can_view (above)
--   002's RPCs: crate_items_emit_events, verified_stats_emit_events,
--     set_now_spinning
--   003's digging functions: digging_page
create or replace function public.follows_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if private.is_blocked_between(NEW.follower_id, NEW.followee_id) then
    raise exception 'cannot follow this user';
  end if;
  NEW.status := case
    when (select visibility from public.profiles where id = NEW.followee_id) = 'public'
      then 'accepted'::public.follow_status
    else 'pending'::public.follow_status
  end;
  return NEW;
end $$;

create or replace function public.crate_items_emit_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  eff        public.visibility_level;
  is_new     boolean := (TG_OP = 'INSERT');
  old_pin    smallint;
  old_rating smallint;
  old_note   text;
  recent_id  bigint;
  vis_changed boolean := false;
begin
  if current_setting('miziki.quiet', true) = 'on' then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    old_pin := OLD.pin_rank;
    old_rating := OLD.rating;
    old_note := OLD.sleeve_note;
    vis_changed := NEW.visibility is distinct from OLD.visibility;
  end if;

  eff := private.effective_visibility(NEW.user_id, NEW.visibility);

  if eff is null or eff = 'private' then
    delete from public.feed_events
    where actor_id = NEW.user_id and release_id = NEW.release_id
      and type in ('pinned', 'review');
    return NEW;
  end if;

  if is_new then
    select id into recent_id from public.feed_events
    where actor_id = NEW.user_id and type = 'added'
      and created_at > now() - interval '15 minutes'
    order by created_at desc limit 1;

    if recent_id is not null then
      update public.feed_events
      set payload = jsonb_set(
            payload, '{count}',
            to_jsonb(coalesce((payload->>'count')::int, 1) + 1)),
          created_at = now()
      where id = recent_id;
    else
      insert into public.feed_events (actor_id, type, release_id, payload)
      values (NEW.user_id, 'added', NEW.release_id, '{"count": 1}'::jsonb);
    end if;
  end if;

  if NEW.pin_rank is null then
    delete from public.feed_events
    where actor_id = NEW.user_id and release_id = NEW.release_id and type = 'pinned';
  elsif is_new or old_pin is null or vis_changed then
    delete from public.feed_events
    where actor_id = NEW.user_id and release_id = NEW.release_id and type = 'pinned';
    insert into public.feed_events (actor_id, type, release_id, payload)
    values (NEW.user_id, 'pinned', NEW.release_id, '{}'::jsonb);
  end if;

  if NEW.rating is null and NEW.sleeve_note is null then
    delete from public.feed_events
    where actor_id = NEW.user_id and release_id = NEW.release_id and type = 'review';
  elsif is_new
     or NEW.rating is distinct from old_rating
     or NEW.sleeve_note is distinct from old_note
     or vis_changed then
    delete from public.feed_events
    where actor_id = NEW.user_id and release_id = NEW.release_id and type = 'review';
    insert into public.feed_events (actor_id, type, release_id, payload)
    values (NEW.user_id, 'review', NEW.release_id,
            jsonb_build_object('rating', NEW.rating, 'note', NEW.sleeve_note));
  end if;

  return NEW;
end $$;

create or replace function public.verified_stats_emit_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  eff public.visibility_level;
  changed boolean;
begin
  if current_setting('miziki.quiet', true) = 'on' then
    return NEW;
  end if;
  if NEW.unlocked_variant is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    changed := NEW.unlocked_variant is distinct from OLD.unlocked_variant;
  else
    changed := true;
  end if;
  if not changed then
    return NEW;
  end if;

  eff := private.effective_visibility(
           NEW.user_id, private.item_visibility(NEW.user_id, NEW.release_id));
  if eff is null or eff = 'private' then
    return NEW;
  end if;

  insert into public.feed_events (actor_id, type, release_id, payload)
  values (NEW.user_id, 'unlock', NEW.release_id,
          jsonb_build_object('variant', NEW.unlocked_variant));
  return NEW;
end $$;

create or replace function public.set_now_spinning(
  p_key text, p_title text, p_artist text, p_track text default null, p_ttl_seconds integer default 600)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_rel uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  insert into public.releases (release_key, title, artist)
  values (p_key, p_title, p_artist)
  on conflict (release_key) do nothing;
  select id into v_rel from public.releases where release_key = p_key;

  if private.effective_visibility(auth.uid(), private.item_visibility(auth.uid(), v_rel)) = 'private' then
    delete from public.now_spinning where user_id = auth.uid();
    return false;
  end if;

  insert into public.now_spinning (user_id, release_id, track_title, started_at, expires_at)
  values (auth.uid(), v_rel, left(p_track, 200), now(),
          now() + make_interval(secs => least(greatest(p_ttl_seconds, 60), 3600)))
  on conflict (user_id) do update set
    release_id  = excluded.release_id,
    track_title = excluded.track_title,
    started_at  = excluded.started_at,
    expires_at  = excluded.expires_at;
  return true;
end $$;

create or replace function public.digging_page(p_user uuid, p_offset integer default 0, p_limit integer default 30)
returns table (release_id uuid, title text, artist text, year smallint, added_at timestamptz,
               source_handle text, in_my_digging boolean, in_my_crate boolean)
language sql stable security invoker set search_path = public as $$
  select r.id, r.title, r.artist, r.year, d.added_at,
         case when d.source_user_id is not null and private.can_view(d.source_user_id, null)
              then (select handle from public.profiles where id = d.source_user_id) end,
         exists (select 1 from public.digging_list m where m.user_id = auth.uid() and m.release_id = r.id),
         exists (select 1 from public.crate_items c where c.user_id = auth.uid() and c.release_id = r.id)
  from public.digging_list d join public.releases r on r.id = d.release_id
  where d.user_id = p_user
  order by d.added_at desc
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 100);
$$;

-- ---------- 5. releases_insert: trace who inserted each catalog row ---
-- releases_insert was `with check (true)` because sync_crate/
-- set_now_spinning are security invoker and insert releases as the
-- user — necessary, but it also let anyone pre-register a popular
-- album's release_key with a fake title/artist (first insert wins, via
-- `on conflict (release_key) do nothing`). Full server-side key
-- derivation isn't reliable (the client's normalization uses Unicode
-- classes Postgres doesn't replicate), so for now: attribute every row
-- so a bad one can be traced and cleaned. See CLAUDE.md's own note on
-- the real fix (canonical release identity / server-verified keys)
-- before a public launch.
alter table public.releases
  add column created_by uuid default auth.uid() references auth.users(id) on delete set null;

drop policy releases_insert on public.releases;
create policy releases_insert on public.releases for insert to authenticated
  with check (created_by = auth.uid());

-- ---------- 6. touch_updated_at: fix the mutable search_path ---------
-- pg_catalog (where now() lives) is always implicitly searched
-- regardless of search_path, so this alone is enough — no body change.
alter function public.touch_updated_at() set search_path = '';

-- ---------- 7. realtime (new table has none to add) -------------------
-- library_backup is never published over realtime — it's private,
-- owner-only data, not a social/live-presence signal like now_spinning.
