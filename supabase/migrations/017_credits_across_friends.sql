-- =====================================================================
-- Migration 17: credits across friends (RF23, docs/12_REFINE.md)
--
-- release_credits(release_id, person_name_norm, role): one row per
-- (user, release, person, role) quadruple, written by sync_crate() from
-- the credits library/credits.js already parses locally
-- (albumCreditRoll()) -- never computed server-side, and never matched
-- or deduped across releases (RF24's job, blocked on Ken's MetaBrainz
-- account). RF23's own spec names only three columns; user_id is the
-- same implicit addition every sibling per-item table in this schema
-- already carries (crate_items, verified_stats and now_spinning are all
-- keyed by (user_id, release_id) too, even where CLAUDE.md's own
-- shorthand for them omits user_id) -- without it there would be no way
-- to tie a credit row back to the one crate item whose visibility rule
-- it has to inherit, which is this migration's whole requirement
-- ("readable under the same can_view rule as the crate item that
-- supplied it").
--
-- No display_name column: the one place this is read
-- (renderPersonView(), src/library/credits.js) is always already showing
-- a specific person's own page by their display name -- the new
-- "N friends have records [person] [role]" line only ever needs a count,
-- then (tapped) a list of *who*, for a name/role this device already has
-- in hand. It never needs the name to travel back from the server.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 16) then
    raise exception 'migration 016 must be applied before 017';
  end if;
end $$;

create table public.release_credits (
  user_id          uuid not null references auth.users(id) on delete cascade,
  release_id       uuid not null references public.releases(id) on delete cascade,
  person_name_norm text not null check (char_length(person_name_norm) <= 200),
  role             text not null check (char_length(role) <= 60),
  primary key (user_id, release_id, person_name_norm, role)
);

-- The reverse lookup credit_friends() below runs: "who else has a credit
-- row for this exact (person, role)" -- the index that query needs.
create index release_credits_person_role_idx
  on public.release_credits (person_name_norm, role);

alter table public.release_credits enable row level security;

-- Same shape as stats_select/spinning_select (001_schema.sql): visible
-- wherever the crate item that supplied this credit would itself be
-- visible -- never a looser or stricter rule of its own.
create policy credits_select on public.release_credits for select to authenticated
  using (private.can_view(user_id, private.item_visibility(user_id, release_id)));
create policy credits_insert on public.release_credits for insert to authenticated
  with check (user_id = auth.uid());
create policy credits_delete on public.release_credits for delete to authenticated
  using (user_id = auth.uid());
-- No update policy/grant: sync_crate() below always replaces a release's
-- whole credit set for a user (delete, then insert), never patches a row
-- in place -- there is nothing an UPDATE would ever be used for.

revoke all on public.release_credits from anon;
grant select, insert, delete on public.release_credits to authenticated;

-- ---------------------------------------------------------------------
-- sync_crate(): extended to also accept each item's own `credits` array
-- -- built client-side by src/miziki-social.js from library/credits.js's
-- albumCreditRoll(), never computed here -- and replace that release's
-- whole release_credits set for this user. Only for items that actually
-- carry a `credits` key at all: a partial, pin-only push (pushCrate()'s
-- own clearFirst batch, src/miziki-social.js) sends an item with no
-- `credits` key whatsoever, and must never wipe a release's real credit
-- rows just because that particular call wasn't about credits. The `?`
-- jsonb operator tests for the key's presence, not its value, so an
-- explicit empty array (a real "no credits found in these files" claim)
-- still clears whatever was there before, while a plain missing key
-- leaves it untouched.
--
-- Same signature as before (p_items jsonb, p_quiet boolean) -- no need to
-- drop the old overload first, unlike 008/013's parameter additions.
-- ---------------------------------------------------------------------
create or replace function public.sync_crate(p_items jsonb, p_quiet boolean default false)
returns integer language plpgsql security invoker set search_path = public as $$
declare n_ins integer; n_upd integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'p_items must be an array'; end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'too many items (max 500)'; end if;
  if p_quiet then perform set_config('miziki.quiet', 'on', true); end if;

  insert into public.releases (release_key, title, artist, year)
  select distinct on (i->>'release_key')
         i->>'release_key', i->>'title', i->>'artist',
         nullif(i->>'year', '')::smallint
  from jsonb_array_elements(p_items) i
  order by i->>'release_key'
  on conflict (release_key) do nothing;

  -- Brand-new rows only: there is no prior value to preserve, so a missing
  -- rating/sleeve_note field is simply absent -- identical to this
  -- function's behavior before RF3.
  insert into public.crate_items
    (user_id, release_id, quality_tier, rating, sleeve_note, pin_rank, visibility, added_at)
  select distinct on (r.id)
         auth.uid(), r.id,
         nullif(i->>'quality_tier', '')::smallint,
         case when (i->>'rating') is null then null
              when (i->>'rating')::smallint = 0 then null
              else (i->>'rating')::smallint end,
         case when (i->>'sleeve_note') is null then null
              when (i->>'sleeve_note') = '' then null
              else i->>'sleeve_note' end,
         nullif(i->>'pin_rank', '')::smallint,
         nullif(i->>'visibility', '')::public.visibility_level,
         coalesce(nullif(i->>'added_at', '')::timestamptz, now())
  from jsonb_array_elements(p_items) i
  join public.releases r on r.release_key = i->>'release_key'
  order by r.id, (nullif(i->>'rating','') is not null) desc
  on conflict (user_id, release_id) do nothing;
  get diagnostics n_ins = row_count;

  -- Existing rows: rating/sleeve_note get the RF3 treatment (null = no
  -- change, the sentinel clears); every other column stays a plain
  -- overwrite, exactly as before this migration.
  update public.crate_items c set
    quality_tier = x.quality_tier,
    rating       = case when x.rating_given is null then c.rating
                        when x.rating_given = 0 then null
                        else x.rating_given end,
    sleeve_note  = case when x.sleeve_note_given is null then c.sleeve_note
                        when x.sleeve_note_given = '' then null
                        else x.sleeve_note_given end,
    pin_rank     = x.pin_rank,
    visibility   = x.visibility
  from (
    select distinct on (r.id)
           r.id as release_id,
           nullif(i->>'quality_tier', '')::smallint as quality_tier,
           nullif(i->>'rating', '')::smallint as rating_given,
           i->>'sleeve_note' as sleeve_note_given,
           nullif(i->>'pin_rank', '')::smallint as pin_rank,
           nullif(i->>'visibility', '')::public.visibility_level as visibility
    from jsonb_array_elements(p_items) i
    join public.releases r on r.release_key = i->>'release_key'
    order by r.id, (nullif(i->>'rating','') is not null) desc
  ) x
  where c.user_id = auth.uid() and c.release_id = x.release_id
    and (
      c.quality_tier is distinct from x.quality_tier
      or c.rating is distinct from (case when x.rating_given is null then c.rating
                                          when x.rating_given = 0 then null
                                          else x.rating_given end)
      or c.sleeve_note is distinct from (case when x.sleeve_note_given is null then c.sleeve_note
                                               when x.sleeve_note_given = '' then null
                                               else x.sleeve_note_given end)
      or c.pin_rank is distinct from x.pin_rank
      or c.visibility is distinct from x.visibility
    );
  get diagnostics n_upd = row_count;

  -- Credits (RF23): replace the whole release_credits set for this user,
  -- per release, for every item that carries a `credits` key at all.
  delete from public.release_credits rc
  using jsonb_array_elements(p_items) i
  join public.releases r on r.release_key = i->>'release_key'
  where rc.user_id = auth.uid() and rc.release_id = r.id
    and (i ? 'credits');

  insert into public.release_credits (user_id, release_id, person_name_norm, role)
  select distinct auth.uid(), r.id, c->>'name', c->>'role'
  from jsonb_array_elements(p_items) i
  join public.releases r on r.release_key = i->>'release_key'
  cross join lateral jsonb_array_elements(
    case when jsonb_array_length(coalesce(i->'credits', '[]'::jsonb)) > 300
         then '[]'::jsonb else coalesce(i->'credits', '[]'::jsonb) end
  ) c
  where (i ? 'credits')
    and nullif(c->>'name', '') is not null
    and nullif(c->>'role', '') is not null
  on conflict (user_id, release_id, person_name_norm, role) do nothing;

  return n_ins + n_upd;
end $$;

-- Reverse lookup for the person view's own "N friends have records
-- [person] [role]" line: every other user whose own release_credits row
-- matches this exact (person, role), limited to whatever RLS already
-- lets the caller see -- the same "RLS does the filtering, the function
-- body just joins" shape as records_in_common() (001_schema.sql), so no
-- can_view() call of its own is needed here. security invoker, same
-- reasoning.
create function public.credit_friends(p_person_name_norm text, p_role text)
returns table (user_id uuid, handle text, display_name text, avatar_url text,
               release_id uuid, title text, artist text)
language sql stable security invoker set search_path = public as $$
  select distinct rc.user_id, p.handle, p.display_name, p.avatar_url,
         r.id, r.title, r.artist
  from public.release_credits rc
  join public.releases r on r.id = rc.release_id
  join public.profiles p on p.id = rc.user_id
  where rc.person_name_norm = p_person_name_norm
    and rc.role = p_role
    and rc.user_id <> auth.uid()
  order by p.display_name, r.artist, r.title;
$$;

revoke execute on function public.credit_friends(text, text) from anon;
grant execute on function public.credit_friends(text, text) to authenticated;

insert into private.schema_migrations (version) values (17);
