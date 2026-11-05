-- =====================================================================
-- Migration 26: a note pinned to a place on the record (GS12,
-- docs/30_GROOVES_AND_SHELF.md)
--
-- Writing a sleeve note can optionally pin it to one track -- shown as a
-- small paper note on the face-out cover with a mono "SIDE B · 4" line
-- (frame FriendShelf), and on the gatefold beside that track. No anchor
-- means today's behavior (the note just sits on the sleeve).
--
-- note_anchor is `{"side": "B", "track": 4}` or null -- side is the
-- gatefold's own side label with "SIDE " stripped (gatefoldSideSplits(),
-- src/gatefold/view.js), track the 1-based position within that side
-- (gatefoldTrackRow()'s own `pos`), never a raw track id, so a track
-- reorder (GF12's own "Track order" mode) doesn't silently orphan an
-- anchor onto the wrong song -- it just points at a position, the same
-- way GS10's albumKeptFor points at a phase, not a specific play.
--
-- Same RF3-shaped wire grammar as rating/sleeve_note (010_crate_merge.sql,
-- see sync_crate()'s own header comment there for why): the key missing
-- entirely, or JSON null, means "no change"; the empty-object sentinel
-- `{}` means "clear it"; any other object is the new anchor. Plain
-- overwrite otherwise -- there's no third "field untouched vs explicitly
-- set to nothing" state beyond those two the existing sentinel grammar
-- already distinguishes.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 25) then
    raise exception 'migration 025 must be applied before 026';
  end if;
end $$;

alter table public.crate_items add column note_anchor jsonb check (
  note_anchor is null or (
    jsonb_typeof(note_anchor) = 'object'
    and jsonb_typeof(note_anchor->'side') = 'string'
    and char_length(note_anchor->>'side') between 1 and 8
    and jsonb_typeof(note_anchor->'track') = 'number'
    and (note_anchor->>'track')::int between 1 and 200
  )
);

-- Additive column-level grant, same shape 021_friends_see_format.sql's
-- own record_format grant uses -- 001_schema.sql's earlier `revoke update
-- on crate_items` still stands, this just adds one more column to what it
-- revoked.
grant update (note_anchor) on public.crate_items to authenticated;

-- sync_crate(): note_anchor gets the exact rating/sleeve_note RF3 shape,
-- just with an empty jsonb object `{}` standing in for 0/'' as the
-- "clear" sentinel (an empty-string side/zero track would otherwise have
-- to mean something, and jsonb has no scalar "this field means nothing"
-- value of its own the way 0/'' do for a number/string column).
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

  -- Credits (RF23): unchanged from 017/021 -- replace the whole
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

-- my_crate_meta(): widened so this device's own merge
-- (src/miziki-social.js's mergeFromServer()) can adopt another device's
-- anchor the same way it already adopts rating/sleeve_note. RETURNS
-- TABLE's column list can't change under CREATE OR REPLACE.
drop function if exists public.my_crate_meta(integer, integer);
create function public.my_crate_meta(p_offset integer default 0, p_limit integer default 500)
returns table (release_key text, title text, artist text, quality_tier smallint, rating smallint,
               sleeve_note text, note_anchor jsonb, pin_rank smallint, visibility public.visibility_level,
               added_at timestamptz, updated_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select r.release_key, r.title, r.artist, c.quality_tier, c.rating, c.sleeve_note, c.note_anchor,
         c.pin_rank, c.visibility, c.added_at, c.updated_at
  from public.crate_items c join public.releases r on r.id = c.release_id
  where c.user_id = auth.uid()
  order by c.added_at, r.release_key
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000);
$$;

-- crate_page(): widened so a friend's face-out "in rotation" tile
-- (src/profile/storefront.js's storePickTile(), via
-- src/social/screens/friend-store.js's friendPicksSection()) can show
-- the "SIDE B · 4" line the way your own already can.
drop function if exists public.crate_page(uuid, integer, integer, boolean);
create function public.crate_page(p_user uuid, p_offset integer default 0, p_limit integer default 60,
                                  p_pinned_only boolean default false)
returns table (release_id uuid, title text, artist text, year smallint, quality_tier smallint,
               rating smallint, sleeve_note text, note_anchor jsonb, pin_rank smallint,
               added_at timestamptz, record_format text)
language sql stable security invoker set search_path = public as $$
  select r.id, r.title, r.artist, r.year, c.quality_tier, c.rating, c.sleeve_note, c.note_anchor,
         c.pin_rank, c.added_at, c.record_format
  from public.crate_items c join public.releases r on r.id = c.release_id
  where c.user_id = p_user and (not p_pinned_only or c.pin_rank is not null)
  order by case when p_pinned_only then c.pin_rank end,
           lower(r.artist), r.year nulls last, lower(r.title)
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 200);
$$;

insert into private.schema_migrations (version) values (26);
