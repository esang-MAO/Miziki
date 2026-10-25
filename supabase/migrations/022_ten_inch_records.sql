-- =====================================================================
-- Migration 22: 10" records (AU-followup, docs/16_AUDIO.md §5's own
-- table, extended)
--
-- The client's record-art/format.js gained a fourth format-table cell,
-- 10" @45 (between the 7" single and the 12" single/EP bands) --
-- formatWireCode()/formatFromWireCode() now encode it as '10-45'. The
-- check constraint 021_friends_see_format.sql put on
-- crate_items.record_format only allowed the three codes that existed
-- then ('7-45', '12-45', '12-33'); a device publishing a 10" record's
-- format would have had its sync_crate() call rejected outright by that
-- constraint. This migration widens it to the fourth value -- nothing
-- else about the column (nullable, no default, the same plain-overwrite
-- treatment in sync_crate()) changes.
--
-- Postgres has no "add one more allowed value" form for an existing
-- check constraint -- the only way is dropping and re-adding it. The
-- constraint was declared inline on the `add column` statement in 021
-- with no name given, so Postgres auto-named it
-- crate_items_record_format_check (the standard <table>_<column>_check
-- pattern); dropped by that name, `if exists` so a hand-renamed
-- constraint on some already-migrated database doesn't make this
-- migration fail outright.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 21) then
    raise exception 'migration 021 must be applied before 022';
  end if;
end $$;

alter table public.crate_items
  drop constraint if exists crate_items_record_format_check;

alter table public.crate_items
  add constraint crate_items_record_format_check
  check (record_format in ('7-45', '10-45', '12-45', '12-33'));

insert into private.schema_migrations (version) values (22);
