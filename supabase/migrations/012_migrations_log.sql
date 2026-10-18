-- =====================================================================
-- Migration 12: migrations ledger (RF5, docs/12_REFINE.md, point 1)
--
-- "A one-person team has no second reviewer for a migration before it
-- reaches production" -- this is the guardrail: a durable, server-side
-- record of which migrations have actually been applied, so a later
-- migration can refuse to run out of order (against a fresh database
-- someone forgot to bring fully up to date, a staging project that
-- skipped a step, or a migration mistakenly re-applied after a later one)
-- rather than silently doing partial damage.
--
-- private.schema_migrations (not public -- same reasoning as the RLS-
-- helper functions 005_backup.sql already moved there: this is bookkeeping
-- for migrations themselves, never something a client should read or
-- write through the Data API, and `private` is already outside Supabase's
-- exposed schema list).
--
-- Backfilled for every migration that predates this one (1-11) -- all of
-- them are already applied by the time this file exists, so there's
-- nothing to assert for migrations 1-11 themselves; this migration is
-- where the ledger starts being real, not a record of history being
-- rewritten.
--
-- Convention for every migration after this one (13+), per RF5 point 1:
-- start with an assertion that the previous version is present, end by
-- inserting its own. For example, migration 13 would open with
--
--   do $$ begin
--     if not exists (select 1 from private.schema_migrations where version = 12) then
--       raise exception 'migration 012 must be applied before 013';
--     end if;
--   end $$;
--
-- and close with
--
--   insert into private.schema_migrations (version) values (13);
--
-- A plain `insert ... values (n)` with no `on conflict` is deliberate for
-- every migration after this one -- schema_migrations' own primary key
-- already makes a double-apply of the same migration file fail loudly (a
-- primary-key violation) instead of silently succeeding a second time,
-- which is exactly the "did someone re-run an old migration out of order"
-- case this ledger exists to catch. This migration (012) backfills 1-11
-- with `on conflict do nothing` since those versions genuinely have no
-- single ledger row of their own to insert -- there is no "migration 011
-- must be present" assertion above this comment because that's exactly
-- what the backfill below both records and depends on. The table creation
-- itself is ordinary one-time DDL, same as every other migration in this
-- directory (never literally re-applied against the same database, since
-- the Supabase CLI's own migration runner tracks what it's already run --
-- see CLAUDE.md's "Apply them in numeric order. Never edit a migration
-- that has already been applied" rule).
-- =====================================================================

create table private.schema_migrations (
  version integer primary key,
  applied_at timestamptz not null default now()
);

revoke all on private.schema_migrations from public, anon, authenticated;

insert into private.schema_migrations (version)
select generate_series(1, 11)
on conflict (version) do nothing;

insert into private.schema_migrations (version) values (12)
on conflict (version) do nothing;
