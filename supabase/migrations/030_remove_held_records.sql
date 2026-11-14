-- =====================================================================
-- Migration 30: remove held records (BD8, docs/38_BEFORE_THE_DOMAIN.md)
--
-- Drops GS11's "held for you" feature outright -- its own earning rule
-- (the Suitcase turntable) is removed in the same step, client-side, and
-- its last remaining client reads/writes (held_for_me(), hand_back(),
-- the "Held for you" crate section and the "Set aside" picker) are gone
-- as of this PR. Reverses 025_held_for_you.sql in full: the two RPCs,
-- the insert trigger and its function, the table and its policies.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 29) then
    raise exception 'migration 029 must be applied before 030';
  end if;
end $$;

revoke all on function public.hand_back(uuid, text) from authenticated;
drop function public.hand_back(uuid, text);

revoke all on function public.held_for_me(uuid) from authenticated;
drop function public.held_for_me(uuid);

drop trigger held_records_before_insert on public.held_records;
drop function public.held_records_before_insert();

drop table public.held_records;

insert into private.schema_migrations (version) values (30);
