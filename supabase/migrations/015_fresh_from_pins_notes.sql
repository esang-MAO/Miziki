-- =====================================================================
-- Migration 15: fresh from pins and notes; the rating is decoration
-- (RF20, docs/12_REFINE.md)
--
-- fresh_for_you (002_rpc.sql) used the 1-5 rating as both a filter
-- (`c.rating >= p_min_rating`) and the sort key (`order by c.rating
-- desc, ...`). Ken's call: a friend's own curation signal is what they
-- pinned (crate_items.pin_rank) or wrote a sleeve note about
-- (crate_items.sleeve_note), not a bare star count -- a record can be
-- five stars and never spoken of again, or two stars and the one thing
-- someone actually pinned to the top of their crate. The rating stays
-- exactly what it always displayed as elsewhere (the record sheet,
-- the home feed's "rated X *****" line) -- decoration, never a sort key.
--
-- This migration replaces fresh_for_you's body only: same signature
-- (p_min_rating is kept, so no client that still passes it breaks, but
-- it's accepted and ignored -- per the doc's own "drop it in a later
-- migration" instruction, this one doesn't remove the parameter yet),
-- same return shape (rating is still returned, for the record sheet's
-- own decoration -- nothing about *displaying* it changes, only what
-- decides whether a record appears here and in what order).
--
-- New filter: a release in the other person's crate that isn't already
-- in mine, and that they either pinned (pin_rank is not null) or wrote
-- a sleeve note about (sleeve_note is not null) -- either is enough,
-- it's an "or", not an "and".
--
-- New order: pins first, by pin_rank (1 is the top of someone's crate);
-- a pinned record always outranks an unpinned, merely-noted one. Among
-- records with no pin, newest note first. crate_items has no separate
-- "note last edited" column -- updated_at (touch_updated_at(), same
-- file) is bumped on every edit to the row, pin or rating or note
-- alike, so it's the only timestamp this schema has for "newest." That
-- makes it an imperfect proxy (editing the rating alone also bumps it),
-- but it's the same column 009_feed_privacy.sql's own review-event gate
-- already leans on to decide "something changed here," and there's
-- nothing more precise to query against.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 14) then
    raise exception 'migration 014 must be applied before 015';
  end if;
end $$;

create or replace function public.fresh_for_you(p_other uuid, p_min_rating integer default 4, p_limit integer default 20)
returns table (release_id uuid, title text, artist text, year smallint, rating smallint,
               sleeve_note text, quality_tier smallint, in_digging boolean)
language sql stable security invoker set search_path = public as $$
  select r.id, r.title, r.artist, r.year, c.rating, c.sleeve_note, c.quality_tier,
         exists (select 1 from public.digging_list d
                 where d.user_id = auth.uid() and d.release_id = r.id)
  from public.crate_items c join public.releases r on r.id = c.release_id
  where c.user_id = p_other
    and (c.pin_rank is not null or c.sleeve_note is not null)
    and not exists (select 1 from public.crate_items m
                    where m.user_id = auth.uid() and m.release_id = c.release_id)
  order by (c.pin_rank is null), c.pin_rank asc, c.updated_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

insert into private.schema_migrations (version) values (15);
