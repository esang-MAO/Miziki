-- =====================================================================
-- Miziki social layer — migration 2: client RPCs (additive)
--
-- Run AFTER miziki_social_schema.sql. Safe to run on top of it.
--
-- Why this exists
--   The standard client upsert (supabase-js .upsert()) sends
--   "ON CONFLICT ... DO UPDATE SET <every column in the payload>", including
--   user_id / release_id. Migration 1 deliberately grants UPDATE only on the
--   mutable columns, so those upserts are refused with "permission denied".
--   These functions run as the caller (SECURITY INVOKER, so RLS and column
--   grants still apply) and only ever update the columns a user may edit.
--
-- Also
--   * "quiet" mode: bulk first-time syncs shouldn't flood friends' feeds.
--     Triggers from migration 1 are re-declared here with a quiet check.
--   * Paged reads (Supabase caps REST responses at 1000 rows by default).
-- =====================================================================

-- ---------- quiet-aware feed triggers (create or replace) -------------
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

  eff := public.effective_visibility(NEW.user_id, NEW.visibility);

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

  eff := public.effective_visibility(
           NEW.user_id, public.item_visibility(NEW.user_id, NEW.release_id));
  if eff is null or eff = 'private' then
    return NEW;
  end if;

  insert into public.feed_events (actor_id, type, release_id, payload)
  values (NEW.user_id, 'unlock', NEW.release_id,
          jsonb_build_object('variant', NEW.unlocked_variant));
  return NEW;
end $$;

revoke execute on function
  public.crate_items_emit_events(), public.verified_stats_emit_events()
from public, anon, authenticated;

-- ---------- writes ---------------------------------------------------

-- Upsert up to 500 crate items. Each element:
--   {release_key, title, artist, year?, quality_tier?, rating?, sleeve_note?,
--    pin_rank?, visibility?, added_at?}
-- Creates catalog rows as needed. Returns the number of crate rows written.
create function public.sync_crate(p_items jsonb, p_quiet boolean default false)
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'p_items must be an array'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'too many items (max 500)'; end if;
  if p_quiet then perform set_config('miziki.quiet', 'on', true); end if;

  insert into public.releases (release_key, title, artist, year)
  select distinct on (i->>'release_key')
         i->>'release_key', i->>'title', i->>'artist',
         nullif(i->>'year', '')::smallint
  from jsonb_array_elements(p_items) i
  order by i->>'release_key'
  on conflict (release_key) do nothing;

  insert into public.crate_items
    (user_id, release_id, quality_tier, rating, sleeve_note, pin_rank, visibility, added_at)
  select distinct on (r.id)
         auth.uid(), r.id,
         nullif(i->>'quality_tier', '')::smallint,
         nullif(i->>'rating', '')::smallint,
         nullif(i->>'sleeve_note', ''),
         nullif(i->>'pin_rank', '')::smallint,
         nullif(i->>'visibility', '')::public.visibility_level,
         coalesce(nullif(i->>'added_at', '')::timestamptz, now())
  from jsonb_array_elements(p_items) i
  join public.releases r on r.release_key = i->>'release_key'
  order by r.id, (nullif(i->>'rating','') is not null) desc
  on conflict (user_id, release_id) do update set
    quality_tier = excluded.quality_tier,
    rating       = excluded.rating,
    sleeve_note  = excluded.sleeve_note,
    pin_rank     = excluded.pin_rank,
    visibility   = excluded.visibility;

  get diagnostics n = row_count;
  return n;
end $$;

create function public.remove_from_crate(p_keys text[])
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if coalesce(array_length(p_keys, 1), 0) > 500 then raise exception 'too many keys (max 500)'; end if;
  delete from public.crate_items c
  using public.releases r
  where c.release_id = r.id and c.user_id = auth.uid() and r.release_key = any(p_keys);
  get diagnostics n = row_count;
  return n;
end $$;

-- Listening milestones. Monotonic: counts never go down, unlocks never clear.
-- Elements: {release_key, full_album_sessions?, unlocked_variant?, last_session_at?}
create function public.sync_stats(p_items jsonb, p_quiet boolean default false)
returns integer language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'p_items must be an array'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'too many items (max 500)'; end if;
  if p_quiet then perform set_config('miziki.quiet', 'on', true); end if;

  insert into public.verified_stats
    (user_id, release_id, full_album_sessions, unlocked_variant, last_session_at)
  select distinct on (r.id)
         auth.uid(), r.id,
         greatest(coalesce(nullif(i->>'full_album_sessions','')::int, 0), 0),
         nullif(i->>'unlocked_variant', ''),
         nullif(i->>'last_session_at', '')::timestamptz
  from jsonb_array_elements(p_items) i
  join public.releases r on r.release_key = i->>'release_key'
  order by r.id
  on conflict (user_id, release_id) do update set
    full_album_sessions = greatest(public.verified_stats.full_album_sessions, excluded.full_album_sessions),
    unlocked_variant    = coalesce(excluded.unlocked_variant, public.verified_stats.unlocked_variant),
    last_session_at     = coalesce(excluded.last_session_at, public.verified_stats.last_session_at);

  get diagnostics n = row_count;
  return n;
end $$;

-- Publish "now spinning". Returns false (and clears any live row) when the
-- record is private, so the client can skip quietly.
create function public.set_now_spinning(
  p_key text, p_title text, p_artist text, p_track text default null, p_ttl_seconds integer default 600)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_rel uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  insert into public.releases (release_key, title, artist)
  values (p_key, p_title, p_artist)
  on conflict (release_key) do nothing;
  select id into v_rel from public.releases where release_key = p_key;

  if public.effective_visibility(auth.uid(), public.item_visibility(auth.uid(), v_rel)) = 'private' then
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

create function public.clear_now_spinning()
returns void language sql security invoker set search_path = public as $$
  delete from public.now_spinning where user_id = auth.uid();
$$;

-- ---------- reads ----------------------------------------------------

-- Everything this user has published, for restoring a fresh install.
create function public.my_crate_meta(p_offset integer default 0, p_limit integer default 500)
returns table (release_key text, title text, artist text, quality_tier smallint, rating smallint,
               sleeve_note text, pin_rank smallint, visibility public.visibility_level, added_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select r.release_key, r.title, r.artist, c.quality_tier, c.rating, c.sleeve_note,
         c.pin_rank, c.visibility, c.added_at
  from public.crate_items c join public.releases r on r.id = c.release_id
  where c.user_id = auth.uid()
  order by c.added_at, r.release_key
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000);
$$;

create function public.profile_summary(p_user uuid)
returns table (records bigint, pins bigint, in_common bigint)
language sql stable security invoker set search_path = public as $$
  select
    (select count(*) from public.crate_items a where a.user_id = p_user),
    (select count(*) from public.crate_items a where a.user_id = p_user and a.pin_rank is not null),
    (select count(*) from public.crate_items a
       join public.crate_items b on b.release_id = a.release_id and b.user_id = auth.uid()
      where a.user_id = p_user and p_user <> auth.uid());
$$;

-- Their records you don't own, best-rated first.
create function public.fresh_for_you(p_other uuid, p_min_rating integer default 4, p_limit integer default 20)
returns table (release_id uuid, title text, artist text, year smallint, rating smallint,
               sleeve_note text, quality_tier smallint, in_digging boolean)
language sql stable security invoker set search_path = public as $$
  select r.id, r.title, r.artist, r.year, c.rating, c.sleeve_note, c.quality_tier,
         exists (select 1 from public.digging_list d
                 where d.user_id = auth.uid() and d.release_id = r.id)
  from public.crate_items c join public.releases r on r.id = c.release_id
  where c.user_id = p_other
    and c.rating >= p_min_rating
    and not exists (select 1 from public.crate_items m
                    where m.user_id = auth.uid() and m.release_id = c.release_id)
  order by c.rating desc, c.added_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

-- Home feed with the joins the UI needs.
create function public.home_feed_rich(p_limit integer default 50, p_before timestamptz default now())
returns table (id bigint, actor_id uuid, actor_handle text, actor_name text,
               type public.feed_event_type, release_id uuid, title text, artist text,
               payload jsonb, created_at timestamptz)
language sql stable security invoker set search_path = public as $$
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

-- Paged crate listing for a user you're allowed to see (RLS decides).
create function public.crate_page(p_user uuid, p_offset integer default 0, p_limit integer default 60,
                                  p_pinned_only boolean default false)
returns table (release_id uuid, title text, artist text, year smallint, quality_tier smallint,
               rating smallint, sleeve_note text, pin_rank smallint, added_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select r.id, r.title, r.artist, r.year, c.quality_tier, c.rating, c.sleeve_note, c.pin_rank, c.added_at
  from public.crate_items c join public.releases r on r.id = c.release_id
  where c.user_id = p_user and (not p_pinned_only or c.pin_rank is not null)
  order by case when p_pinned_only then c.pin_rank end,
           lower(r.artist), r.year nulls last, lower(r.title)
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 200);
$$;
