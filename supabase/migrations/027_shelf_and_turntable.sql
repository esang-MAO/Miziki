-- =====================================================================
-- Migration 27: friends see your shelf finish and turntable
-- (ST6, docs/32_SHELF_AND_TURNTABLES.md)
--
-- Two purely cosmetic choices (src/profile/shelf-finish.js's
-- SHELF_FINISHES, src/profile/turntable.js's TURNTABLE_LINEUP),
-- published on the profile row so a friend's crate screen can render the
-- ST2 shelf unit in the owner's own finish/model instead of always
-- Walnut/Standard. Nullable -- null reads the same as "never set",
-- which src/profile/shelf-finish.js's displayShelfFinish() and
-- src/profile/turntable.js's displayTurntable() already fall back to
-- Walnut/Standard for locally.
--
-- The server never decides Deluxe eligibility or the found-by-listening
-- rules -- same posture as every other synced-but-locally-gated field
-- (quality_tier, achievements). A modified client could in principle
-- write a Deluxe finish/model without actually having Deluxe; accepted,
-- since it's cosmetic only and changes nothing server-side.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 26) then
    raise exception 'migration 026 must be applied before 027';
  end if;
end $$;

alter table public.profiles
  add column shelf_finish text check (shelf_finish in ('walnut', 'oak', 'teak', 'ash', 'black')),
  add column turntable text check (turntable in (
    'standard', 'console', 'linear', 'deck', 'clear', 'suitcase',
    'broadcast', 'upright', 'radiogram', 'slate', 'lathe', 'horn'
  ));

-- 001_schema.sql revoked table-level update on profiles and grants back
-- only a named column list (007_rhythm.sql's listening_rhythm and
-- 003_digging.sql's show_digging_list each needed their own follow-up
-- grant for the same reason) -- a column-level grant is additive, no
-- revoke needed first. profiles_update (001_schema.sql, owner-only) still
-- covers the row-level check; this just adds the two new columns to what
-- that policy's UPDATE is actually allowed to touch.
grant update (shelf_finish, turntable) on public.profiles to authenticated;

insert into private.schema_migrations (version) values (27);
