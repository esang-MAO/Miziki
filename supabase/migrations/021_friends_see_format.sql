-- =====================================================================
-- Migration 21: friends see the format (AU11, docs/16_AUDIO.md §5)
--
-- "Friends see the same format because the owner's app publishes it
-- with the record (a new column on the published record row...)." --
-- the record's own *automatic* format (7"/45, 12"/45, 12"/33 -- the
-- table applied to the longest side), never the personal Auto/33⅓/45
-- override (which stays local/backed-up only, state.js's S.albumFormat
-- -- "The override is personal: it syncs in your backup, but friends
-- see the automatic format").
--
-- Lives on crate_items, not releases, for the same reason quality_tier
-- does: today it's computed from *this user's own rip* (its track
-- lengths), so two accounts' copies of the same release can in
-- principle land on opposite sides of a boundary until MusicBrainz
-- canonical lengths land (the doc's own note -- AU11 doesn't build
-- that; it only publishes what each device already computes for
-- itself). Stored as one short text code rather than two columns ({size,
-- speed} both baked in -- '7-45'/'12-45'/'12-33'), since nothing
-- server-side ever reads size and speed separately; the client's own
-- src/record-art/format.js owns the encode/decode (formatWireCode()/
-- formatFromWireCode()). Null means "unknown" (e.g. a record whose
-- track durations were never measured) -- the same "don't guess" rule
-- crate/model.js's own hasKnownFormat() guard already applies locally
-- (AU10).
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 20) then
    raise exception 'migration 020 must be applied before 021';
  end if;
end $$;

alter table public.crate_items
  add column record_format text check (record_format in ('7-45', '12-45', '12-33'));

-- 001_schema.sql revoked table-level update on crate_items and granted
-- back only the five named columns (quality_tier, rating, sleeve_note,
-- pin_rank, visibility) -- a column-level grant is additive and doesn't
-- need a revoke first, the same shape 007_rhythm.sql's own grant for
-- profiles.listening_rhythm already established. Without this, sync_crate
-- (security invoker) fails "permission denied for table crate_items" the
-- moment its UPDATE touches the new column.
grant update (record_format) on public.crate_items to authenticated;

-- sync_crate(): same signature as before (017 already widened it for
-- credits with no need to drop the old overload) -- record_format gets
-- the same plain-overwrite treatment quality_tier already has, never the
-- RF3 null-means-no-change/sentinel-means-clear treatment rating and
-- sleeve_note get, since there's no "clear it" gesture of its own for a
-- format: a missing/null value already reads as "unknown."
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

  -- Brand-new rows only: there is no prior value to preserve, so a missing
  -- rating/sleeve_note field is simply absent -- identical to this
  -- function's behavior before RF3.
  insert into public.crate_items
    (user_id, release_id, quality_tier, record_format, rating, sleeve_note, pin_rank, visibility, added_at)
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
         nullif(i->>'pin_rank', '')::smallint,
         nullif(i->>'visibility', '')::public.visibility_level,
         coalesce(nullif(i->>'added_at', '')::timestamptz, now())
  from jsonb_array_elements(p_items) i
  join public.releases r on r.release_key = i->>'release_key'
  order by r.id, (nullif(i->>'rating','') is not null) desc
  on conflict (user_id, release_id) do nothing;
  get diagnostics n_ins = row_count;

  -- Existing rows: rating/sleeve_note get the RF3 treatment (null = no
  -- change, the sentinel clears); every other column, record_format
  -- included, stays a plain overwrite, exactly as before this migration.
  update public.crate_items c set
    quality_tier  = x.quality_tier,
    record_format = x.record_format,
    rating        = case when x.rating_given is null then c.rating
                          when x.rating_given = 0 then null
                          else x.rating_given end,
    sleeve_note   = case when x.sleeve_note_given is null then c.sleeve_note
                          when x.sleeve_note_given = '' then null
                          else x.sleeve_note_given end,
    pin_rank      = x.pin_rank,
    visibility    = x.visibility
  from (
    select distinct on (r.id)
           r.id as release_id,
           nullif(i->>'quality_tier', '')::smallint as quality_tier,
           nullif(i->>'record_format', '') as record_format,
           nullif(i->>'rating', '')::smallint as rating_given,
           i->>'sleeve_note' as sleeve_note_given,
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
      or c.pin_rank is distinct from x.pin_rank
      or c.visibility is distinct from x.visibility
    );
  get diagnostics n_upd = row_count;

  -- Credits (RF23): unchanged from 017 -- replace the whole
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

-- crate_page(): the RPC a friend's own "browse the crate" screen reads
-- (src/social/screens/friend-store.js's loadFriendCrate()/MizikiSocial.
-- crate()) -- widened so the record sheet can show the format chip for
-- someone else's record. RETURNS TABLE's column list can't change under
-- CREATE OR REPLACE, so drop first (008_spin_phase.sql/010_crate_merge.
-- sql's own precedent for widening an existing function's shape).
drop function if exists public.crate_page(uuid, integer, integer, boolean);
create function public.crate_page(p_user uuid, p_offset integer default 0, p_limit integer default 60,
                                  p_pinned_only boolean default false)
returns table (release_id uuid, title text, artist text, year smallint, quality_tier smallint,
               rating smallint, sleeve_note text, pin_rank smallint, added_at timestamptz,
               record_format text)
language sql stable security invoker set search_path = public as $$
  select r.id, r.title, r.artist, r.year, c.quality_tier, c.rating, c.sleeve_note, c.pin_rank, c.added_at,
         c.record_format
  from public.crate_items c join public.releases r on r.id = c.release_id
  where c.user_id = p_user and (not p_pinned_only or c.pin_rank is not null)
  order by case when p_pinned_only then c.pin_rank end,
           lower(r.artist), r.year nulls last, lower(r.title)
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 200);
$$;

insert into private.schema_migrations (version) values (21);
