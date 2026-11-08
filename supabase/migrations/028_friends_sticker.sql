-- =====================================================================
-- Migration 28: friends sticker, server side (CC2, docs/34_CARE_AND_CONTROL.md)
--
-- The sticker drawing already exists (friendsStickerText() in
-- src/share/record-card.js, the 'friends' kind in src/crate/model.js),
-- but nothing feeds it real data -- record.friendsCount is always null
-- today. This migration adds the one new privacy setting it needs and
-- the two RPCs CC3 (the UI step) calls.
--
-- count_in_stickers: opt-out, default on, owner-only. "Never expose it
-- to anyone else: if opting out is visible, the choice itself reveals
-- something." The obvious place is a plain profiles column, but
-- profiles_select (001_schema.sql) lets any non-blocked authenticated
-- user select the whole row -- fine for handle/display_name/bio, wrong
-- here, and a column-level revoke can't fix it: Postgres column grants
-- only ever *add* to a table-level grant, never subtract from one, and
-- `profiles` already carries a blanket table-level SELECT for
-- `authenticated` (the project's own default privileges, same reason
-- 001_schema.sql never has to write "grant select on profiles" itself).
-- So it lives in its own table instead, with ordinary row-level RLS
-- scoped to the owner -- the same shape held_records/digging_list
-- already use for "only the people this literally concerns" data, and
-- the one mechanism that actually delivers "owner-only" in this schema.
-- No row for a user yet means the default, true -- every read below
-- treats a missing row as opted in, so there's nothing to backfill.
--
-- The two counting RPCs still need to read *other* users' rows here
-- (and, for the detail sheet, their digging_list rows) to produce a
-- derived count/list -- something a plain security invoker function
-- can't do, since sticker_privacy_select only ever lets a caller see
-- their own row, security invoker or not. private.friends_sticker_counts/
-- _detail (security definer, never exposed to the Data API since
-- `private` isn't an exposed schema) do that privileged read;
-- public.friends_sticker/_detail stay security invoker themselves and
-- never return anything but a derived owners count or handle, so no raw
-- row ever reaches a caller who isn't its owner.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 27) then
    raise exception 'migration 027 must be applied before 028';
  end if;
end $$;

create table public.sticker_privacy (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  count_in_stickers boolean not null default true
);

alter table public.sticker_privacy enable row level security;

create policy sticker_privacy_select on public.sticker_privacy for select to authenticated
  using (user_id = auth.uid());
create policy sticker_privacy_insert on public.sticker_privacy for insert to authenticated
  with check (user_id = auth.uid());
create policy sticker_privacy_update on public.sticker_privacy for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.sticker_privacy from anon;

-- ---------------------------------------------------------------------
-- private.friends_sticker_counts(p_viewer, p_release_ids): one row per
-- requested release the viewer doesn't already own, with the count of
-- mutual (both directions accepted), non-blocked followers who have it
-- in their crate at a visibility the viewer can see and have opted in.
-- A release the viewer does own, or that isn't in any qualifying
-- follower's crate, still gets a row (owners 0) -- "nothing at 0" is
-- CC3's own display rule, not a reason to drop rows here.
-- ---------------------------------------------------------------------
create function private.friends_sticker_counts(p_viewer uuid, p_release_ids uuid[])
returns table (release_id uuid, owners integer)
language sql stable security definer set search_path = public as $$
  select r.id, count(distinct c.user_id)::integer
  from unnest(p_release_ids) as r(id)
  left join public.crate_items c
    on c.release_id = r.id
    and c.user_id <> p_viewer
    and not private.is_blocked_between(p_viewer, c.user_id)
    and exists (select 1 from public.follows a
                where a.follower_id = p_viewer and a.followee_id = c.user_id and a.status = 'accepted')
    and exists (select 1 from public.follows b
                where b.follower_id = c.user_id and b.followee_id = p_viewer and b.status = 'accepted')
    and private.can_view(c.user_id, c.visibility)
    and coalesce((select sp.count_in_stickers from public.sticker_privacy sp where sp.user_id = c.user_id), true)
  where not exists (
    select 1 from public.crate_items m where m.user_id = p_viewer and m.release_id = r.id
  )
  group by r.id;
$$;

revoke all on function private.friends_sticker_counts(uuid, uuid[]) from public, anon;
grant execute on function private.friends_sticker_counts(uuid, uuid[]) to authenticated;

create function public.friends_sticker(p_release_ids uuid[])
returns table (release_id uuid, owners integer)
language sql stable security invoker set search_path = public as $$
  select * from private.friends_sticker_counts(auth.uid(), p_release_ids);
$$;

revoke all on function public.friends_sticker(uuid[]) from public, anon;
grant execute on function public.friends_sticker(uuid[]) to authenticated;

-- ---------------------------------------------------------------------
-- private.friends_sticker_detail(p_viewer, p_release_id): the same
-- owners as handles ('owns'), plus mutual, non-blocked friends who have
-- the release on a visible digging list ('wants') -- gated by both
-- show_digging_list (the existing digging-list visibility switch) and
-- count_in_stickers, since opting out of being counted means opting out
-- of appearing in this sheet at all, not just out of the aggregate.
-- ---------------------------------------------------------------------
create function private.friends_sticker_detail(p_viewer uuid, p_release_id uuid)
returns table (handle text, kind text)
language sql stable security definer set search_path = public as $$
  select p.handle, 'owns'
  from public.crate_items c
  join public.profiles p on p.id = c.user_id
  where c.release_id = p_release_id
    and c.user_id <> p_viewer
    and not private.is_blocked_between(p_viewer, c.user_id)
    and exists (select 1 from public.follows a
                where a.follower_id = p_viewer and a.followee_id = c.user_id and a.status = 'accepted')
    and exists (select 1 from public.follows b
                where b.follower_id = c.user_id and b.followee_id = p_viewer and b.status = 'accepted')
    and private.can_view(c.user_id, c.visibility)
    and coalesce((select sp.count_in_stickers from public.sticker_privacy sp where sp.user_id = c.user_id), true)
  union
  select p.handle, 'wants'
  from public.digging_list d
  join public.profiles p on p.id = d.user_id
  where d.release_id = p_release_id
    and d.user_id <> p_viewer
    and not private.is_blocked_between(p_viewer, d.user_id)
    and exists (select 1 from public.follows a
                where a.follower_id = p_viewer and a.followee_id = d.user_id and a.status = 'accepted')
    and exists (select 1 from public.follows b
                where b.follower_id = d.user_id and b.followee_id = p_viewer and b.status = 'accepted')
    and p.show_digging_list
    and coalesce((select sp.count_in_stickers from public.sticker_privacy sp where sp.user_id = d.user_id), true);
$$;

revoke all on function private.friends_sticker_detail(uuid, uuid) from public, anon;
grant execute on function private.friends_sticker_detail(uuid, uuid) to authenticated;

create function public.friends_sticker_detail(p_release_id uuid)
returns table (handle text, kind text)
language sql stable security invoker set search_path = public as $$
  select * from private.friends_sticker_detail(auth.uid(), p_release_id);
$$;

revoke all on function public.friends_sticker_detail(uuid) from public, anon;
grant execute on function public.friends_sticker_detail(uuid) to authenticated;

insert into private.schema_migrations (version) values (28);
