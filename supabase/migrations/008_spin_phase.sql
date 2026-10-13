-- =====================================================================
-- Miziki social layer — migration 8 (DA6, docs/DAY_ARC.md): "spun at
-- dusk" — the day-arc phase a record was spinning in travels with
-- now_spinning, so friends see *when in the day* someone's listening,
-- never a clock time and never a location. Only sent while "Share what
-- you're spinning" (now_spinning's own existing opt-in, default off) is
-- already on.
--
-- Additive on top of 001-007. Never edit an applied migration.
-- =====================================================================

-- ---------- 1. the column itself: nullable (an older client that
-- hasn't picked up this PR yet still calls set_now_spinning with no
-- phase at all, and that row is simply "phase unknown" forever after,
-- never an error), with a check constraint listing the seven day-arc
-- phase names dayPosition() (src/sundown/day.js) can ever return. ------
alter table public.now_spinning add column phase text;
alter table public.now_spinning add constraint now_spinning_phase_check
  check (phase is null or phase in
    ('night', 'dawn', 'morning', 'midday', 'afternoon', 'golden', 'twilight'));

-- ---------- 2. set_now_spinning gains a p_phase parameter. Adding a
-- parameter changes the function's own signature, so `create or replace`
-- would leave the old 5-argument version in place as a second, separate
-- overload rather than actually replacing it (Postgres resolves `create
-- or replace function` by exact argument-type match) -- drop the old
-- signature explicitly first, so there is exactly one set_now_spinning
-- after this migration, not two. Body is otherwise byte-for-byte the
-- same as 005's own version (still private.effective_visibility/
-- private.item_visibility, still security invoker, still the same
-- private-record early return) -- only the new parameter and the one
-- new column in the insert/upsert are added. -------------------------
drop function if exists public.set_now_spinning(text, text, text, text, integer);

create function public.set_now_spinning(
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

-- clear_now_spinning (002) needs no change -- it only ever deletes the
-- caller's own row, by user_id, regardless of which columns that row had.
