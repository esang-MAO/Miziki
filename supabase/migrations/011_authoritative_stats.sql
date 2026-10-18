-- =====================================================================
-- Migration 11: one number for sessions (RF4, docs/12_REFINE.md)
--
-- Bug ("What the audit found," item 4): an album's session count had three
-- sources that disagreed -- the per-device S.sessionCounts, the cross-
-- device sum fromDocs().totals computes on every pull (shown only in the
-- one-time restore summary, never used anywhere else), and
-- verified_stats.full_album_sessions, merged by greatest() (a max, not a
-- sum). Phone 3 + desktop 2 showed friends 3, each device 3 or 2, and 5
-- nowhere.
--
-- Fix, client half (src/state.js/src/sync/backup.js, src/history/
-- achievements.js, src/record-art/metals.js, src/miziki-social.js, same
-- PR): every pull now keeps the cross-device sum as its own value,
-- S.mergedStats, read by topAlbums()/topTracks()/albumMetalFor()/
-- trackMetalFor() and the social adapter's own `sessions:` field in place
-- of the matching per-device counter whenever it's present -- so every
-- surface a signed-in device shows (its own profile tab, the metal on the
-- platter, what it pushes to the server) all agree, and all three equal
-- the same sum a friend's view would see if that number were ever
-- surfaced there (today, nothing reads verified_stats back out on the
-- client at all -- no RPC returns it to any caller, confirmed by grepping
-- every `returns table` in this directory -- so there is no existing
-- friend-facing surface for this fix to repair; it's the write path this
-- migration corrects, ready for whenever a read path is built).
--
-- Fix, server half (this migration): `pushStats()` (src/miziki-social.js)
-- now sends the authoritative merged total, not a single device's own
-- count that another device's greatest() could only ever grow -- so
-- sync_stats's own full_album_sessions column becomes a plain overwrite,
-- same as every other already-authoritative field sync_crate overwrites.
-- unlocked_variant is untouched -- still `coalesce(excluded.unlocked_variant,
-- public.verified_stats.unlocked_variant)`, so a push that says nothing
-- about it never clears it. RF4 only asks that it "stay monotonic" (i.e.
-- this migration changes nothing about it), not that it gain a new rank
-- comparison it didn't have before.
--
-- Terminology (RF4, point 5): what a friend would eventually see is
-- "spins," never "verified" -- verified_stats is a client-attested count
-- (001_schema.sql's own header comment says so), not something the
-- server can prove. No column rename (the table/column names stay
-- verified_stats/full_album_sessions, matching every other migration that
-- already references them by name) and no UI copy exists to rename today
-- for the reason in the paragraph above -- this comment is the one place
-- recording the decision so whichever future PR actually surfaces this
-- number to a friend starts from the right word.
-- =====================================================================

create or replace function public.sync_stats(p_items jsonb, p_quiet boolean default false)
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
    -- RF4: the client now sends its own already-merged, cross-device total
    -- (S.mergedStats), not a single device's own count -- a plain
    -- overwrite is correct here the same way sync_crate's other already-
    -- authoritative columns (quality_tier, pin_rank, visibility) already
    -- are, where greatest() would instead let a device that hasn't synced
    -- in a while, and so still has the old pre-merge per-device number,
    -- silently ratchet this column back up past what the account's own
    -- real total is.
    full_album_sessions = excluded.full_album_sessions,
    unlocked_variant    = coalesce(excluded.unlocked_variant, public.verified_stats.unlocked_variant),
    last_session_at     = coalesce(excluded.last_session_at, public.verified_stats.last_session_at);

  get diagnostics n = row_count;
  return n;
end $$;
