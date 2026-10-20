-- =====================================================================
-- Migration 19: pressings in common (CR11, docs/13_CRATE.md)
--
-- CR11 point 1 ("records in common shows each copy's pressing") needs to
-- compare the viewer's own quality_tier against the other person's for
-- the same release. The pressing itself (its colour/finish) is derived
-- entirely client-side from the shared album identity key
-- (src/record-art/tiers.js's selectVariant()/selectVariantForAlbum(),
-- keyed on normKey(album title) -- the same `title` this function
-- already returns), so this migration adds no new column and no new
-- table: it only widens records_in_common()'s own result to also carry
-- both sides' quality_tier, the one piece a client can't derive locally
-- for someone else's record.
--
-- CREATE OR REPLACE can't change a function's output columns, so the old
-- 4-column version is dropped first -- the same move 008_spin_phase.sql
-- already made for widening an existing RPC's own signature.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 18) then
    raise exception 'migration 018 must be applied before 019';
  end if;
end $$;

drop function if exists public.records_in_common(uuid);

create function public.records_in_common(p_other uuid)
returns table (release_id uuid, title text, artist text, year smallint,
               my_quality_tier smallint, their_quality_tier smallint)
language sql stable security invoker set search_path = public as $$
  select r.id, r.title, r.artist, r.year, mine.quality_tier, theirs.quality_tier
  from public.crate_items mine
  join public.crate_items theirs
    on theirs.release_id = mine.release_id and theirs.user_id = p_other
  join public.releases r on r.id = mine.release_id
  where mine.user_id = auth.uid()
  order by r.artist, r.year, r.title;
$$;

insert into private.schema_migrations (version) values (19);
