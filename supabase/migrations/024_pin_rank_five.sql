-- =====================================================================
-- Migration 24: "in rotation" caps at 5, not 8 (GS8, docs/30_GROOVES_AND_SHELF.md)
--
-- Staff picks is now "in rotation": pins 1-3 framed on the wall, 4-5
-- face-out on the shelves -- there's no slot left in the new layout for
-- a 6th-8th pin. Tightens crate_items.pin_rank's check constraint from
-- "between 1 and 8" (001_schema.sql) to "between 1 and 5"; the client's
-- own cap (src/miziki-social.js's MAX_PINS) matches.
--
-- 001_schema.sql's check constraint is unnamed, so Postgres auto-named it
-- crate_items_pin_rank_check -- dropped by that generated name and
-- replaced, the same "can't edit an applied migration, add a new one"
-- shape every prior constraint-tightening migration in this directory
-- uses. Any pin ranked 6-8 on a live row is cleared (set to null, not
-- deleted -- the record itself stays in the crate, just unpinned) before
-- the tighter constraint is added, so this never fails against existing
-- data; 009_feed_privacy.sql's set_updated_at trigger already fires an
-- unpin feed event for a pin_rank going non-null -> null, same as any
-- other unpin.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 23) then
    raise exception 'migration 023 must be applied before 024';
  end if;
end $$;

update public.crate_items set pin_rank = null where pin_rank > 5;

alter table public.crate_items drop constraint crate_items_pin_rank_check;
alter table public.crate_items add constraint crate_items_pin_rank_check check (pin_rank between 1 and 5);

insert into private.schema_migrations (version) values (24);
