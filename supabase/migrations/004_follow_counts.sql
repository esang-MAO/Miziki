-- Added during the social UI build: the storefront's own stat row needs a
-- "Followers" count (frame 01), which no existing RPC provided. Scoped to
-- the caller's own id on both sides, so security invoker + the existing
-- follows RLS (follower_id = auth.uid() or followee_id = auth.uid()) always
-- permits it — no need to touch RLS or widen access. Friend stores don't
-- show a followers count (frame 02 shows Records/Staff picks/In common
-- instead), so this is never needed for anyone but the caller.
create function public.my_follow_counts()
returns table (followers bigint, following bigint)
language sql stable security invoker set search_path = public as $$
  select
    (select count(*) from public.follows where followee_id = auth.uid() and status = 'accepted'),
    (select count(*) from public.follows where follower_id = auth.uid() and status = 'accepted');
$$;
