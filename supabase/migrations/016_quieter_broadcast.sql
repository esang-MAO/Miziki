-- =====================================================================
-- Migration 16: a quieter broadcast (RF21, docs/12_REFINE.md)
--
-- Three independent changes, all about how little the social layer says
-- on a listener's behalf without being asked:
--
--   1. Private spin is entirely client-side (S.privateSpin, the player's
--      own "Don't share this session" menu row) -- nowSpinning() is
--      simply never called while it's on, so there is nothing for this
--      migration to do for that part.
--
--   2. Milestones (metal unlocks) stop posting to the feed at all, no
--      matter what the Privacy screen's "Share milestones" switch says.
--      That switch still controls whether verified_stats itself syncs
--      for a friend to see on this user's own crate/share card (the
--      actual metal) -- it just no longer also means a feed_events row.
--      public.verified_stats_emit_events() (re-declared 005_backup.sql,
--      itself re-declaring 001_schema.sql's original) is re-declared a
--      third time here as a pure no-op: the trigger itself stays attached
--      (same name/signature, same OID), so a future PR has somewhere to
--      re-attach real behavior if milestones ever rejoin the feed, but
--      right now it never inserts. public.rebuild_feed_events(p_user)
--      (009_feed_privacy.sql) is re-declared the same way, dropping its
--      own "-- unlock" insert block -- otherwise the repair path would
--      quietly resurrect exactly the rows this migration just removed.
--      Every 'unlock' row already sitting in feed_events is deleted
--      outright, not just stopped going forward.
--
--   3. feed_events rows expire after 45 days. Two mechanisms, per the
--      spec's own "pg_cron if available, otherwise on every
--      home_feed_rich call": a scheduled pg_cron job sweeping every
--      row older than 45 days, guarded so a project with pg_cron not
--      enabled (likely, on a free-tier one-person project) still
--      applies this migration cleanly; and public.expire_own_feed_events(),
--      a tiny security-definer function (public schema, so it keeps the
--      ordinary "CREATE FUNCTION grants EXECUTE to PUBLIC" default rather
--      than needing an explicit grant -- the same posture
--      007_rhythm.sql's get_listening_rhythm() already uses) that
--      public.home_feed_rich() now calls on every read, scoped to
--      auth.uid() so it can never touch anyone else's rows. home_feed_rich
--      itself drops its `stable` marker (it's no longer side-effect-free)
--      but keeps `security invoker` -- the expiry runs as the caller
--      through the definer function, the SELECT itself still runs under
--      the caller's own RLS exactly as before.
--
-- See docs/PRIVACY_POLICY.md and src/profile/legal.js (updated alongside
-- this migration) for the 45-day expiry disclosure.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 15) then
    raise exception 'migration 015 must be applied before 016';
  end if;
end $$;

-- ---------- 2. milestones leave the feed ------------------------------

create or replace function public.verified_stats_emit_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- RF21: a metal unlock never posts to the feed, regardless of "Share
  -- milestones" -- that switch still gates whether verified_stats syncs
  -- at all (so a friend's crate page can show the metal), just not this.
  return NEW;
end $$;

create or replace function public.rebuild_feed_events(p_user uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_user <> auth.uid() then raise exception 'can only rebuild your own feed'; end if;

  delete from public.feed_events where actor_id = p_user;

  insert into public.feed_events (actor_id, type, release_id, payload, created_at)
  select c.user_id, 'added', c.release_id, '{"count": 1}'::jsonb, c.added_at
  from public.crate_items c
  where c.user_id = p_user
    and private.effective_visibility(c.user_id, c.visibility) is distinct from 'private'
    and private.effective_visibility(c.user_id, c.visibility) is not null;

  insert into public.feed_events (actor_id, type, release_id, payload, created_at)
  select c.user_id, 'pinned', c.release_id, '{}'::jsonb, c.updated_at
  from public.crate_items c
  where c.user_id = p_user and c.pin_rank is not null
    and private.effective_visibility(c.user_id, c.visibility) is distinct from 'private'
    and private.effective_visibility(c.user_id, c.visibility) is not null;

  insert into public.feed_events (actor_id, type, release_id, payload, created_at)
  select c.user_id, 'review', c.release_id,
         jsonb_build_object('rating', c.rating, 'note', c.sleeve_note), c.updated_at
  from public.crate_items c
  where c.user_id = p_user and (c.rating is not null or c.sleeve_note is not null)
    and private.effective_visibility(c.user_id, c.visibility) is distinct from 'private'
    and private.effective_visibility(c.user_id, c.visibility) is not null;

  -- RF21: no 'unlock' rows any more -- milestones left the feed, so the
  -- repair path must not bring them back for an account whose trigger
  -- once wrote them before this migration ran.

  get diagnostics n = row_count;
  return n;
end $$;

-- Clean out whatever 'unlock' rows already exist, not just stop writing
-- new ones. Anyone who could already see them loses nothing they could
-- act on; the metal itself is untouched (verified_stats, not feed_events).
delete from public.feed_events where type = 'unlock';

-- ---------- 3. feed_events expire after 45 days -----------------------

-- Caller-scoped, security definer so it can delete despite
-- `revoke insert, update, delete on public.feed_events from authenticated`
-- (001_schema.sql) -- public schema, so it keeps the ordinary "CREATE
-- FUNCTION grants EXECUTE to PUBLIC" default, the same posture
-- get_listening_rhythm() (007_rhythm.sql) already uses, rather than
-- needing an explicit grant. auth.uid() is read from the caller's own
-- JWT regardless of the security-definer role switch, so this can never
-- reach past the caller's own rows.
create function public.expire_own_feed_events()
returns void language sql security definer set search_path = public as $$
  delete from public.feed_events where actor_id = auth.uid() and created_at < now() - interval '45 days';
$$;

create or replace function public.home_feed_rich(p_limit integer default 50, p_before timestamptz default now())
returns table (id bigint, actor_id uuid, actor_handle text, actor_name text,
               type public.feed_event_type, release_id uuid, title text, artist text,
               payload jsonb, created_at timestamptz)
language sql security invoker set search_path = public as $$
  select public.expire_own_feed_events();
  select e.id, e.actor_id, p.handle, p.display_name, e.type, e.release_id,
         r.title, r.artist, e.payload, e.created_at
  from public.feed_events e
  join public.profiles p on p.id = e.actor_id
  left join public.releases r on r.id = e.release_id
  where e.created_at < p_before
    and (e.actor_id = auth.uid()
         or exists (select 1 from public.follows f
                    where f.follower_id = auth.uid()
                      and f.followee_id = e.actor_id
                      and f.status = 'accepted'))
  order by e.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Scheduled sweep, only where pg_cron is actually enabled -- most Supabase
-- projects need it turned on explicitly (Database > Extensions), and a
-- one-person free-tier project may never have. Guarded so this migration
-- still applies cleanly either way; the per-caller cleanup above is the
-- real fallback the spec asks for.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    perform cron.schedule('feed-events-expiry', '17 3 * * *',
      $cron$delete from public.feed_events where created_at < now() - interval '45 days'$cron$);
  end if;
exception when others then
  raise notice 'pg_cron not available/schedulable here -- relying on expire_own_feed_events() via home_feed_rich instead (%)', sqlerrm;
end $$;

insert into private.schema_migrations (version) values (16);
