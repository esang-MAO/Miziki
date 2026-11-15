-- =====================================================================
-- Undo for migration 30 (BD8, docs/38_BEFORE_THE_DOMAIN.md). Never
-- applied by routine -- restores 025_held_for_you.sql's table, trigger
-- and both RPCs verbatim if 030 turns out to be a bad migration. The
-- client code that read/wrote them is gone as of this PR's own commit,
-- so restoring the schema alone does not bring the feature back in the
-- app -- it only undoes the destructive part of this migration.
-- =====================================================================

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

create policy held_records_select on public.held_records for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());
create policy held_records_insert on public.held_records for insert to authenticated
  with check (from_user = auth.uid());
create policy held_records_update on public.held_records for update to authenticated
  using (to_user = auth.uid()) with check (to_user = auth.uid());

revoke all on public.held_records from anon;

revoke update on public.held_records from authenticated;
grant  update (handed_back) on public.held_records to authenticated;

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

delete from private.schema_migrations where version = 30;
