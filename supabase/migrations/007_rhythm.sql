-- =====================================================================
-- Miziki social layer — migration 7 (DA5, docs/DAY_ARC.md): the shared
-- half of "listening rhythm" — a per-account, opt-in snapshot of the
-- aggregate percentages and verdict (never individual plays or times)
-- src/sync/backup.js pushes at most daily while the Privacy screen's
-- "Show my listening rhythm on my crate" switch (default off) is on.
--
-- Additive on top of 001-006. Never edit an applied migration.
-- =====================================================================

-- ---------- 1. the column itself, plus a size check (the same
-- octet_length-on-text-cast pattern 005's own library_backup.doc uses,
-- just a far smaller cap -- this is a handful of percentages, a verdict
-- string and a timestamp, never a play log) ----------------------------
alter table public.profiles add column listening_rhythm jsonb;
alter table public.profiles add constraint listening_rhythm_size
  check (octet_length(listening_rhythm::text) <= 2000);

-- ---------- 2. owner-write, via the existing column-grant mechanism
-- (001 already revoked table-level update on profiles and grants back
-- only specific columns -- this just adds one more column to that same
-- allow-list; it does not need to re-revoke anything first, since a
-- column-level grant is its own separate privilege entry, not something
-- the original table-level revoke ever touched). The app writes (or
-- clears, with a plain `null`) this column the same way it already
-- writes display_name/bio/etc. -- MizikiSocial.updateProfile(), no new
-- RPC needed for the owner's own write. ---------------------------------
grant update (listening_rhythm) on public.profiles to authenticated;

-- ---------- 3. reading someone else's value, gated by the crate's own
-- visibility rules -- NOT by widening profiles_select ------------------
--
-- profiles_select (001) is deliberately blanket: any non-blocked signed-in
-- user can already read a whole profiles row (handle, display name, bio,
-- avatar) regardless of that owner's visibility setting, specifically so
-- a handle stays findable for a follow request (001's own comment: "basics
-- are findable by handle... unless a block exists"). Postgres RLS is
-- row-level, not column-level, so there is no way to let that same row
-- stay selectable while hiding just this one new column from someone
-- visibility would otherwise exclude -- loosening profiles_select itself
-- to be visibility-aware would regress that intentional, already-tested
-- findability behavior for every other column on the row.
--
-- Instead, reading on another user's behalf goes through this small,
-- read-only function -- the same "can_view-gated, plain SELECT, default
-- PUBLIC execute" shape 003_digging.sql's own digging_page()/
-- digging_count() already established for exactly this problem (a
-- shared value that needs its own visibility check beyond the owning
-- table's blanket RLS). Returns null, not an error, for anyone who
-- shouldn't see it -- the same "absent, not denied" shape the rest of
-- the crate's own visibility gates already use.
--
-- security definer, not invoker, unlike digging_page()/digging_count()
-- themselves -- a real difference found and fixed by this migration's
-- own test run, not copied blind from that precedent: can_view() lives
-- in the API-invisible `private` schema (005_backup.sql) with `usage`
-- on that schema granted only to `authenticated` (never `anon`), so a
-- security-invoker function calling it runs with the *caller's* own
-- privileges and fails outright for a signed-out request ("permission
-- denied for schema private") rather than returning null the way every
-- other visibility gate in this app degrades. digging_page() never hit
-- this in practice only because nothing ever calls it signed out; this
-- function's own anon-request test (tests/client.test.js) means it has
-- to actually work, not just happen to go unexercised. security definer
-- runs as this function's owner instead, who already has access to
-- every schema -- can_view()'s own body already returns false for a
-- null viewer() uuid unless the owner's visibility is 'public' (and, in
-- that case, still false — "signed-in users only" per its own comment),
-- so a signed-out caller still correctly gets null, now by falling
-- through can_view()'s real logic instead of by not being allowed to
-- even ask.
create function public.get_listening_rhythm(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when private.can_view(p_user, null) then p.listening_rhythm else null end
  from public.profiles p where p.id = p_user;
$$;

-- ---------- 4. no realtime publication change -- this is a slow-moving
-- (at most daily), pulled-on-demand snapshot, not a live presence signal
-- like now_spinning; it was never added to the realtime publication, and
-- doesn't need to be.
