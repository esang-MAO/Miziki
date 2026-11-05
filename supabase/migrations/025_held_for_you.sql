-- =====================================================================
-- Migration 25: held for you (GS11, docs/30_GROOVES_AND_SHELF.md)
--
-- A friend can set aside up to three of their own records for you, with
-- a short note -- found on their crate page ("Held for you"), never
-- pushed as a notification or feed event (CLAUDE.md: Miziki never asks
-- for attention). You can hand records back one at a time; the hold
-- itself expires 30 days after it's created.
--
-- release_ids/handed_back store release_key strings, not releases.id --
-- the client never has a raw release UUID for its own crate (crate sync
-- is release_key-only, see my_crate_meta() in 010_crate_merge.sql), so
-- release_key is what a "set aside" picker can actually hand the server.
--
-- from_user is who's giving (must own every record they're setting
-- aside -- checked in the insert trigger below, since RLS's row-level
-- with check can't look at crate_items); to_user is who it's held for.
-- Only to_user can ever change a row, and only its handed_back column
-- (the column-level grant, same shape as follows.status/crate_items'
-- update grant below in 001_schema.sql).
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 24) then
    raise exception 'migration 024 must be applied before 025';
  end if;
end $$;

create table public.held_records (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references public.profiles(id) on delete cascade,
  to_user      uuid not null references public.profiles(id) on delete cascade,
  release_ids  text[] not null check (array_length(release_ids, 1) between 1 and 3),
  note         text check (char_length(note) <= 140),
  handed_back  text[] not null default '{}'::text[] check (handed_back <@ release_ids),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '30 days'),
  check (from_user <> to_user)
);

create index held_records_to_idx   on public.held_records (to_user, created_at desc);
create index held_records_from_idx on public.held_records (from_user, created_at desc);

-- Server-decided, same shape as follows_before_insert(): the two parties
-- must currently be mutual, non-blocked followers, every release_key
-- must actually be in from_user's own crate, and handed_back/expires_at
-- are never taken from the client.
create function public.held_records_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_blocked_between(NEW.from_user, NEW.to_user) then
    raise exception 'cannot hold records for this user';
  end if;

  if not (
    exists (
      select 1 from public.follows a
      where a.follower_id = NEW.from_user and a.followee_id = NEW.to_user and a.status = 'accepted'
    )
    and exists (
      select 1 from public.follows b
      where b.follower_id = NEW.to_user and b.followee_id = NEW.from_user and b.status = 'accepted'
    )
  ) then
    raise exception 'cannot hold records for a non-mutual follow';
  end if;

  if exists (
    select 1 from unnest(NEW.release_ids) as rk(release_key)
    where char_length(rk.release_key) not between 8 and 64
       or not exists (
         select 1 from public.releases r
         join public.crate_items c on c.release_id = r.id
         where r.release_key = rk.release_key and c.user_id = NEW.from_user
       )
  ) then
    raise exception 'can only hold records from your own crate';
  end if;

  NEW.handed_back := '{}'::text[];
  NEW.expires_at := now() + interval '30 days';
  return NEW;
end $$;

create trigger held_records_before_insert
  before insert on public.held_records
  for each row execute function public.held_records_before_insert();

revoke execute on function public.held_records_before_insert() from public, anon, authenticated;

alter table public.held_records enable row level security;

-- Only the two parties can see a hold.
create policy held_records_select on public.held_records for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());
create policy held_records_insert on public.held_records for insert to authenticated
  with check (from_user = auth.uid());
create policy held_records_update on public.held_records for update to authenticated
  using (to_user = auth.uid()) with check (to_user = auth.uid());

revoke all on public.held_records from anon;

-- Column-level write limits: to_user can only mark records handed back.
revoke update on public.held_records from authenticated;
grant  update (handed_back) on public.held_records to authenticated;

-- ---------------------------------------------------------------------
-- held_for_me(p_from): live (non-expired) holds for the signed-in user,
-- with each release_key resolved against the shared catalog and flagged
-- against the row's own handed_back array. p_from narrows to one friend
-- (the "Held for you" stack on their crate page is only ever theirs);
-- left null, every live hold across every friend comes back.
-- ---------------------------------------------------------------------
create function public.held_for_me(p_from uuid default null)
returns table (
  id          uuid,
  from_user   uuid,
  from_handle text,
  note        text,
  created_at  timestamptz,
  expires_at  timestamptz,
  releases    jsonb
)
language sql stable security invoker set search_path = public as $$
  select h.id, h.from_user, p.handle, h.note, h.created_at, h.expires_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'release_key', r.release_key, 'title', r.title, 'artist', r.artist,
               'year', r.year, 'handed_back', r.release_key = any(h.handed_back))
             order by array_position(h.release_ids, r.release_key))
      from public.releases r where r.release_key = any(h.release_ids)
    ), '[]'::jsonb) as releases
  from public.held_records h
  join public.profiles p on p.id = h.from_user
  where h.to_user = auth.uid() and h.expires_at > now()
    and (p_from is null or h.from_user = p_from)
  order by h.created_at desc;
$$;

revoke all on function public.held_for_me(uuid) from public;
grant execute on function public.held_for_me(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- hand_back(p_hold_id, p_release_key): mark one record within a hold as
-- handed back. Atomic (no read-then-write race), and still only ever
-- touches a row this user is the to_user of -- RLS/the column grant
-- above apply the same way they would to a direct client update.
-- ---------------------------------------------------------------------
create function public.hand_back(p_hold_id uuid, p_release_key text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  update public.held_records
  set handed_back = array_append(handed_back, p_release_key)
  where id = p_hold_id
    and to_user = auth.uid()
    and p_release_key = any(release_ids)
    and not (p_release_key = any(handed_back));
end $$;

revoke all on function public.hand_back(uuid, text) from public;
grant execute on function public.hand_back(uuid, text) to authenticated;

insert into private.schema_migrations (version) values (25);
