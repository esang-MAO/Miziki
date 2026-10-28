-- =====================================================================
-- Migration 23: connected crate (docs/20_CONNECTED.md)
--
-- A shared, server-side cache of MusicBrainz artist relationships, so
-- the artist page's "Connected" shelf (src/library/connected.js) never
-- makes a phone talk to musicbrainz.org directly. The one writer is the
-- mb-connections edge function (supabase/functions/mb-connections/),
-- running with the service role; clients only ever read, through
-- artist_connections() below.
--
-- This is public catalog data (who was in which band, what they
-- released), not anyone's listening data: no user_id column anywhere,
-- readable signed in or out.
--
-- mb_artists: one row per normalized artist name ever looked up.
--   mbid null = MusicBrainz was asked and had no confident match; the
--   row still records fetched_at so the same miss isn't retried on every
--   artist-page open.
-- artist_connections: one row per (artist, release group, via artist) --
--   each release group a related artist (a member, a band this artist
--   was in, a collaboration) put out under their own name.
-- =====================================================================

do $$ begin
  if not exists (select 1 from private.schema_migrations where version = 22) then
    raise exception 'migration 022 must be applied before 023';
  end if;
end $$;

create table public.mb_artists (
  name_norm  text primary key check (char_length(name_norm) between 1 and 200),
  mbid       uuid,
  name       text check (char_length(name) <= 300),
  -- [{"kind": "bandcamp"|"official", "url": "https://..."}], at most a few
  urls       jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);

create table public.artist_connections (
  artist_mbid        uuid not null,
  release_group_mbid uuid not null,
  title              text not null check (char_length(title) between 1 and 300),
  year               smallint check (year between 1860 and 2200),
  via_mbid           uuid not null,
  via_name           text not null check (char_length(via_name) between 1 and 300),
  -- how via_* relates to the page's artist: 'member' (was in this band),
  -- 'band' (a band this artist was in), 'collab' (a named collaboration)
  role               text not null check (role in ('member', 'band', 'collab')),
  -- the via artist's own Bandcamp or official site, from MusicBrainz's
  -- url relationships; null when MusicBrainz has none
  buy_url            text check (buy_url is null or (buy_url ~ '^https://' and char_length(buy_url) <= 500)),
  primary key (artist_mbid, release_group_mbid, via_mbid)
);

create index artist_connections_artist_idx on public.artist_connections (artist_mbid);

alter table public.mb_artists enable row level security;
alter table public.artist_connections enable row level security;

-- Read-only to clients; no insert/update/delete policy or grant at all --
-- the edge function writes with the service role, which bypasses RLS.
create policy mb_artists_select on public.mb_artists for select to anon, authenticated using (true);
create policy artist_connections_select on public.artist_connections for select to anon, authenticated using (true);
revoke all on public.mb_artists from anon, authenticated;
revoke all on public.artist_connections from anon, authenticated;
grant select on public.mb_artists to anon, authenticated;
grant select on public.artist_connections to anon, authenticated;

-- ---------------------------------------------------------------------
-- artist_connections(p_name_norm): what the cache knows about one
-- artist, plus whether it's worth asking the edge function to refresh.
--   status 'missing' -- never looked up
--   status 'nomatch' -- looked up, MusicBrainz had no confident match
--   status 'fresh'   -- cached within the last 30 days
--   status 'stale'   -- cached, but older than 30 days (still returned)
-- p_name_norm is the client's normKey() of the artist name; the edge
-- function computes the same key server-side (_shared/mb-connections.js
-- normName(), kept identical by tests/unit/connected.test.js).
-- ---------------------------------------------------------------------
create or replace function public.artist_connections(p_name_norm text)
returns jsonb language sql stable security invoker set search_path = public as $$
  select case
    when a.name_norm is null then jsonb_build_object('status', 'missing', 'artist', null, 'items', '[]'::jsonb)
    when a.mbid is null then jsonb_build_object(
      'status', case when a.fetched_at < now() - interval '30 days' then 'missing' else 'nomatch' end,
      'artist', null, 'items', '[]'::jsonb)
    else jsonb_build_object(
      'status', case when a.fetched_at < now() - interval '30 days' then 'stale' else 'fresh' end,
      'artist', jsonb_build_object('mbid', a.mbid, 'name', a.name, 'urls', a.urls),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'release_group_mbid', c.release_group_mbid, 'title', c.title, 'year', c.year,
                 'via_mbid', c.via_mbid, 'via_name', c.via_name, 'role', c.role, 'buy_url', c.buy_url)
               order by case c.role when 'member' then 0 when 'band' then 1 else 2 end,
                        c.via_name, c.year nulls last, c.title)
        from public.artist_connections c where c.artist_mbid = a.mbid), '[]'::jsonb))
  end
  from (select 1) one
  left join public.mb_artists a on a.name_norm = p_name_norm;
$$;

revoke all on function public.artist_connections(text) from public;
grant execute on function public.artist_connections(text) to anon, authenticated;

insert into private.schema_migrations (version) values (23);
