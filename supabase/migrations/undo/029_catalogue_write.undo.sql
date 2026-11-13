-- =====================================================================
-- Undo for migration 29 (BD1, docs/38_BEFORE_THE_DOMAIN.md). Never
-- applied by routine -- reverses 029_catalogue_write.sql by hand if it
-- turns out to be a bad migration.
--
-- Restores every function this migration replaced to its exact
-- pre-029 body (the newest version each had before 029: sync_crate at
-- 026_note_anchor.sql, set_now_spinning at 008_spin_phase.sql,
-- follows_before_insert at 005_backup.sql), drops what 029 added, and
-- re-opens the policy/grant it closed to 005_backup.sql's own
-- `with check (created_by = auth.uid())` -- not the original
-- `with check (true))` from 001_schema.sql, which 005 had already
-- tightened once before this migration ever ran.
-- =====================================================================

drop trigger if exists reports_before_insert on public.reports;
drop function if exists public.reports_before_insert();

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

create policy releases_insert on public.releases for insert to authenticated
  with check (created_by = auth.uid());
grant insert on public.releases to authenticated;

create or replace function public.set_now_spinning(
  p_key text, p_title text, p_artist text, p_track text default null, p_ttl_seconds integer default 600,
  p_phase text default null)
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

create or replace function public.sync_crate(p_items jsonb, p_quiet boolean default false)
returns integer language plpgsql security invoker set search_path = public as $$
declare n_ins integer; n_upd integer;
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

drop function if exists private.ensure_release(text, text, text, smallint);

delete from private.schema_migrations where version = 29;
