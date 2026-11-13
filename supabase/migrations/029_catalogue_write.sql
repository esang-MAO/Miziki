-- =====================================================================
-- Migration 29: close the shared catalogue write (BD1, docs/38_BEFORE_THE_DOMAIN.md)
--
-- releases_insert (001_schema.sql) lets any authenticated user insert
-- any row into the shared catalogue with any title/artist, and
-- `on conflict (release_key) do nothing` means the first writer for a
-- key wins for good -- there's no path back to fix a bad title. Every
-- client path already goes through sync_crate/set_now_spinning, which
-- are security invoker, so the open policy only ever existed to let
-- those functions' own inserts through as the caller.
--
-- 005_backup.sql already tightened the policy once, to
-- `with check (created_by = auth.uid())`, with `releases.created_by`
-- added there (uuid, references auth.users, defaults to auth.uid()) so a
-- bad row could at least be traced -- its own comment says the real fix
-- is "canonical release identity / server-verified keys... before a
-- public launch." This migration is that fix for the one piece in
-- scope now: it moves the write behind a security definer helper
-- (private.ensure_release, same posture as the RLS-helper functions
-- 005_backup.sql already moved out of the exposed API) that trims and
-- sanitizes the title/artist and caps how many an account can create in
-- a day, then closes the policy and grant entirely -- no direct insert
-- path is left, traced or not. `created_by` is reused as-is; this
-- migration does not add it.
--
-- Also adds the two other daily caps the read confirmed were missing:
-- follows and reports. Same shape as the release cap, same reasoning --
-- an account that got signed in to as someone else, or an account
-- script, caps out instead of running unbounded.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 28) then
    raise exception 'migration 028 must be applied before 029';
  end if;
end $$;

-- ---------- 1. the write, behind one helper ---------------------------
create function private.ensure_release(p_key text, p_title text, p_artist text, p_year smallint default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_title  text := regexp_replace(trim(p_title),  '[\x00-\x1F\x7F]', '', 'g');
  v_artist text := regexp_replace(trim(p_artist), '[\x00-\x1F\x7F]', '', 'g');
  v_count  integer;
  v_id     uuid;
begin
  select count(*) into v_count from public.releases
  where created_by = auth.uid() and created_at > now() - interval '24 hours';
  if v_count >= 2000 then
    raise exception 'too many new releases today';
  end if;

  insert into public.releases (release_key, title, artist, year, created_by)
  values (p_key, v_title, v_artist, p_year, auth.uid())
  on conflict (release_key) do nothing;

  select id into v_id from public.releases where release_key = p_key;
  return v_id;
end $$;

revoke execute on function private.ensure_release(text, text, text, smallint) from public, anon;
grant execute on function private.ensure_release(text, text, text, smallint) to authenticated;

-- sync_crate (latest at 026_note_anchor.sql): the one bulk insert becomes
-- a loop over the helper -- everything else in the function (the two
-- crate_items statements, the credits block) is unchanged.
create or replace function public.sync_crate(p_items jsonb, p_quiet boolean default false)
returns integer language plpgsql security invoker set search_path = public as $$
declare n_ins integer; n_upd integer; v_item record;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'p_items must be an array'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'too many items (max 500)'; end if;
  if p_quiet then perform set_config('miziki.quiet', 'on', true); end if;

  for v_item in
    select distinct on (i->>'release_key')
           i->>'release_key' as release_key, i->>'title' as title, i->>'artist' as artist,
           nullif(i->>'year', '')::smallint as year
    from jsonb_array_elements(p_items) i
    order by i->>'release_key'
  loop
    perform private.ensure_release(v_item.release_key, v_item.title, v_item.artist, v_item.year);
  end loop;

  -- Brand-new rows only: there is no prior value to preserve, so a missing
  -- rating/sleeve_note/note_anchor field is simply absent -- identical to
  -- this function's behavior before RF3/this migration.
  insert into public.crate_items
    (user_id, release_id, quality_tier, record_format, rating, sleeve_note, note_anchor, pin_rank, visibility, added_at)
  select distinct on (r.id)
         auth.uid(), r.id,
         nullif(i->>'quality_tier', '')::smallint,
         nullif(i->>'record_format', ''),
         case when (i->>'rating') is null then null
              when (i->>'rating')::smallint = 0 then null
              else (i->>'rating')::smallint end,
         case when (i->>'sleeve_note') is null then null
              when (i->>'sleeve_note') = '' then null
              else i->>'sleeve_note' end,
         case when not (i ? 'note_anchor') or jsonb_typeof(i->'note_anchor') = 'null' then null
              when i->'note_anchor' = '{}'::jsonb then null
              else i->'note_anchor' end,
         nullif(i->>'pin_rank', '')::smallint,
         nullif(i->>'visibility', '')::public.visibility_level,
         coalesce(nullif(i->>'added_at', '')::timestamptz, now())
  from jsonb_array_elements(p_items) i
  join public.releases r on r.release_key = i->>'release_key'
  order by r.id, (nullif(i->>'rating','') is not null) desc
  on conflict (user_id, release_id) do nothing;
  get diagnostics n_ins = row_count;

  -- Existing rows: rating/sleeve_note/note_anchor get the RF3 treatment
  -- (no key, or JSON null = no change; the sentinel clears); every other
  -- column stays a plain overwrite, exactly as before this migration.
  update public.crate_items c set
    quality_tier  = x.quality_tier,
    record_format = x.record_format,
    rating        = case when x.rating_given is null then c.rating
                          when x.rating_given = 0 then null
                          else x.rating_given end,
    sleeve_note   = case when x.sleeve_note_given is null then c.sleeve_note
                          when x.sleeve_note_given = '' then null
                          else x.sleeve_note_given end,
    note_anchor   = case when x.note_anchor_given is null then c.note_anchor
                          when x.note_anchor_given = '{}'::jsonb then null
                          else x.note_anchor_given end,
    pin_rank      = x.pin_rank,
    visibility    = x.visibility
  from (
    select distinct on (r.id)
           r.id as release_id,
           nullif(i->>'quality_tier', '')::smallint as quality_tier,
           nullif(i->>'record_format', '') as record_format,
           nullif(i->>'rating', '')::smallint as rating_given,
           i->>'sleeve_note' as sleeve_note_given,
           case when not (i ? 'note_anchor') or jsonb_typeof(i->'note_anchor') = 'null' then null
                else i->'note_anchor' end as note_anchor_given,
           nullif(i->>'pin_rank', '')::smallint as pin_rank,
           nullif(i->>'visibility', '')::public.visibility_level as visibility
    from jsonb_array_elements(p_items) i
    join public.releases r on r.release_key = i->>'release_key'
    order by r.id, (nullif(i->>'rating','') is not null) desc
  ) x
  where c.user_id = auth.uid() and c.release_id = x.release_id
    and (
      c.quality_tier is distinct from x.quality_tier
      or c.record_format is distinct from x.record_format
      or c.rating is distinct from (case when x.rating_given is null then c.rating
                                          when x.rating_given = 0 then null
                                          else x.rating_given end)
      or c.sleeve_note is distinct from (case when x.sleeve_note_given is null then c.sleeve_note
                                               when x.sleeve_note_given = '' then null
                                               else x.sleeve_note_given end)
      or c.note_anchor is distinct from (case when x.note_anchor_given is null then c.note_anchor
                                               when x.note_anchor_given = '{}'::jsonb then null
                                               else x.note_anchor_given end)
      or c.pin_rank is distinct from x.pin_rank
      or c.visibility is distinct from x.visibility
    );
  get diagnostics n_upd = row_count;

  -- Credits (RF23): unchanged from 017/021/026 -- replace the whole
  -- release_credits set for this user, per release, for every item that
  -- carries a `credits` key at all.
  delete from public.release_credits rc
  using jsonb_array_elements(p_items) i
  join public.releases r on r.release_key = i->>'release_key'
  where rc.user_id = auth.uid() and rc.release_id = r.id
    and (i ? 'credits');

  insert into public.release_credits (user_id, release_id, person_name_norm, role)
  select distinct auth.uid(), r.id, c->>'name', c->>'role'
  from jsonb_array_elements(p_items) i
  join public.releases r on r.release_key = i->>'release_key'
  cross join lateral jsonb_array_elements(
    case when jsonb_array_length(coalesce(i->'credits', '[]'::jsonb)) > 300
         then '[]'::jsonb else coalesce(i->'credits', '[]'::jsonb) end
  ) c
  where (i ? 'credits')
    and nullif(c->>'name', '') is not null
    and nullif(c->>'role', '') is not null
  on conflict (user_id, release_id, person_name_norm, role) do nothing;

  return n_ins + n_upd;
end $$;

-- set_now_spinning (latest at 008_spin_phase.sql): the insert/select pair
-- becomes one call to the helper -- nothing else in the function changes.
create or replace function public.set_now_spinning(
  p_key text, p_title text, p_artist text, p_track text default null, p_ttl_seconds integer default 600,
  p_phase text default null)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_rel uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;

  v_rel := private.ensure_release(p_key, p_title, p_artist, null);

  if private.effective_visibility(auth.uid(), private.item_visibility(auth.uid(), v_rel)) = 'private' then
    delete from public.now_spinning where user_id = auth.uid();
    return false;
  end if;

  insert into public.now_spinning (user_id, release_id, track_title, started_at, expires_at, phase)
  values (auth.uid(), v_rel, left(p_track, 200), now(),
          now() + make_interval(secs => least(greatest(p_ttl_seconds, 60), 3600)),
          p_phase)
  on conflict (user_id) do update set
    release_id  = excluded.release_id,
    track_title = excluded.track_title,
    started_at  = excluded.started_at,
    expires_at  = excluded.expires_at,
    phase       = excluded.phase;
  return true;
end $$;

-- ---------- 2. close the open policy and grant ------------------------
drop policy releases_insert on public.releases;
revoke insert on public.releases from authenticated;

-- ---------- 3. follows/reports: a daily cap per account ----------------
-- follows_before_insert (latest at 005_backup.sql) gains the cap; the
-- blocked-user check and the pending/accepted assignment are unchanged.
create or replace function public.follows_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if private.is_blocked_between(NEW.follower_id, NEW.followee_id) then
    raise exception 'cannot follow this user';
  end if;

  select count(*) into v_count from public.follows
  where follower_id = NEW.follower_id and created_at > now() - interval '24 hours';
  if v_count >= 200 then
    raise exception 'too many new follows today';
  end if;

  NEW.status := case
    when (select visibility from public.profiles where id = NEW.followee_id) = 'public'
      then 'accepted'::public.follow_status
    else 'pending'::public.follow_status
  end;
  return NEW;
end $$;

-- reports has no before-insert trigger yet.
create function public.reports_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  select count(*) into v_count from public.reports
  where reporter_id = NEW.reporter_id and created_at > now() - interval '24 hours';
  if v_count >= 20 then
    raise exception 'too many reports today';
  end if;
  return NEW;
end $$;

create trigger reports_before_insert before insert on public.reports
  for each row execute function public.reports_before_insert();

insert into private.schema_migrations (version) values (29);
