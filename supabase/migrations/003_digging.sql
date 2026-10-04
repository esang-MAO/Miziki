-- Migration 3 (additive): shareable digging list with an on/off switch. Default ON.
alter table public.profiles add column show_digging_list boolean not null default true;
grant update (show_digging_list) on public.profiles to authenticated;

-- Others may read a digging list only if they can view the store AND the owner left it on.
create policy digging_select_shared on public.digging_list for select to authenticated
  using (
    user_id <> auth.uid()
    and public.can_view(user_id, null)
    and exists (select 1 from public.profiles p where p.id = digging_list.user_id and p.show_digging_list)
  );

-- One page of someone's digging list (own list always works). Attribution is shown only
-- when the viewer could see the store it came from.
create function public.digging_page(p_user uuid, p_offset integer default 0, p_limit integer default 30)
returns table (release_id uuid, title text, artist text, year smallint, added_at timestamptz,
               source_handle text, in_my_digging boolean, in_my_crate boolean)
language sql stable security invoker set search_path = public as $$
  select r.id, r.title, r.artist, r.year, d.added_at,
         case when d.source_user_id is not null and public.can_view(d.source_user_id, null)
              then (select handle from public.profiles where id = d.source_user_id) end,
         exists (select 1 from public.digging_list m where m.user_id = auth.uid() and m.release_id = r.id),
         exists (select 1 from public.crate_items c where c.user_id = auth.uid() and c.release_id = r.id)
  from public.digging_list d join public.releases r on r.id = d.release_id
  where d.user_id = p_user
  order by d.added_at desc
  offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 100);
$$;

create function public.digging_count(p_user uuid)
returns integer language sql stable security invoker set search_path = public as $$
  select count(*)::int from public.digging_list where user_id = p_user;
$$;
