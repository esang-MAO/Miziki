-- =====================================================================
-- Migration 10: crate merge fix (RF3, docs/12_REFINE.md)
--
-- Bug: restoreFromServer() (src/miziki-social.js) only ever adopted the
-- server's crate values into a device's local state the first time that
-- device ever synced for this account. After that, buildItems() always
-- sent rating/sleeve_note straight from local state -- null when this
-- device had never set one -- and sync_crate()'s plain `on conflict do
-- update set rating = excluded.rating` overwrote the server row whole. A
-- second device that had never rated an album, but added a sleeve note to
-- it, silently wiped whatever rating a first device had already set.
--
-- Fix, in two parts (the client half -- mergeFromServer() merging server
-- values into X.state.items on every sync, not just the first one ever,
-- field by field, gated by a per-field "do I have an unpushed local edit
-- for this one" flag rather than a timestamp compare -- already shipped in
-- src/miziki-social.js in this same PR; see that file's own comment on
-- mergeFromServer() for why a row-level timestamp was tried first and
-- rejected):
--
--   1. my_crate_meta(): add `updated_at` to its return columns. Not load-
--      bearing for the merge fix itself (the client gates on its own
--      per-field dirty tracking, not this column), but a reasonable,
--      already-trigger-maintained value to expose for future use (e.g. a
--      "last edited" display) while this function's shape is being touched
--      anyway. Changing a RETURNS TABLE's column list needs DROP + CREATE,
--      not CREATE OR REPLACE (same reason 008_spin_phase.sql dropped
--      set_now_spinning's old signature before recreating it with a new
--      parameter).
--
--   2. sync_crate(): a `null` in the payload for rating/sleeve_note now
--      means "no change" rather than "clear it" -- clearing is an explicit
--      sentinel instead (rating 0, sleeve_note ''). A brand-new row has
--      nothing to preserve, so a missing field there is simply absent, same
--      as before this migration; only the on-conflict path (an existing
--      row) actually needs the "no change" branch, since that's the only
--      place a stale/uninformed write could otherwise clobber a real value.
--      Every other column (quality_tier, pin_rank, visibility, title/
--      artist/year) keeps its existing plain-overwrite behavior -- RF3's
--      own spec scopes the sentinel treatment to rating and sleeve_note
--      only; visibility's null already has a well-defined, unambiguous
--      meaning ("inherit the profile's own setting"), so it isn't in scope.
--
--      Implemented as INSERT ... ON CONFLICT DO NOTHING (new rows; nothing
--      to preserve) followed by a separate correlated UPDATE (existing
--      rows; has something to preserve), rather than one INSERT ... ON
--      CONFLICT DO UPDATE -- an ON CONFLICT DO UPDATE's `excluded` pseudo-
--      row only carries final column values, which can't tell "the payload
--      said nothing about this field" apart from "the payload explicitly
--      cleared it" once both have already been collapsed to the same SQL
--      null; a plain correlated UPDATE still has the raw incoming JSON
--      available to tell the two apart.
--
--      The UPDATE is guarded with `is distinct from` so a push that
--      changes nothing at all for a given row is a true no-op: crate_items
--      already has a BEFORE UPDATE trigger (crate_items_touch) that bumps
--      `updated_at` on every UPDATE regardless of whether any column
--      actually changed, and the client's own merge-before-push now
--      compares against that same timestamp -- an unconditional UPDATE
--      would make a no-op re-sync look like a fresher edit than it is to
--      another device's next merge.
-- =====================================================================

drop function if exists public.my_crate_meta(integer, integer);
create function public.my_crate_meta(p_offset integer default 0, p_limit integer default 500)
returns table (release_key text, title text, artist text, quality_tier smallint, rating smallint,
               sleeve_note text, pin_rank smallint, visibility public.visibility_level, added_at timestamptz,
               updated_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select r.release_key, r.title, r.artist, c.quality_tier, c.rating, c.sleeve_note,
         c.pin_rank, c.visibility, c.added_at, c.updated_at
  from public.crate_items c join public.releases r on r.id = c.release_id
  where c.user_id = auth.uid()
  order by c.added_at, r.release_key
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 1000);
$$;

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
    (user_id, release_id, quality_tier, rating, sleeve_note, pin_rank, visibility, added_at)
  select distinct on (r.id)
         auth.uid(), r.id,
         nullif(i->>'quality_tier', '')::smallint,
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
  -- change, the sentinel clears); every other column stays a plain
  -- overwrite, exactly as before this migration.
  update public.crate_items c set
    quality_tier = x.quality_tier,
    rating       = case when x.rating_given is null then c.rating
                        when x.rating_given = 0 then null
                        else x.rating_given end,
    sleeve_note  = case when x.sleeve_note_given is null then c.sleeve_note
                        when x.sleeve_note_given = '' then null
                        else x.sleeve_note_given end,
    pin_rank     = x.pin_rank,
    visibility   = x.visibility
  from (
    select distinct on (r.id)
           r.id as release_id,
           nullif(i->>'quality_tier', '')::smallint as quality_tier,
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

  return n_ins + n_upd;
end $$;
