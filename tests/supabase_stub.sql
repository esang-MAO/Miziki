do $$ begin create role anon nologin; exception when duplicate_object then null; end $$; do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$; do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create publication supabase_realtime;

-- step 07 (B4): a minimal stand-in for Supabase's own storage.buckets/
-- storage.objects tables and the storage.foldername() helper its own
-- Storage policies call — just enough shape (bucket_id, name, owner,
-- the real foldername() split-on-'/' behavior) to exercise 006_images.sql's
-- RLS policies with real Postgres role/auth.uid() semantics, the same
-- "auth.uid() + real RLS, not a real Storage API" approach this file's
-- own auth.users/auth.uid() stub already takes. What this can't stand in
-- for — the Storage API's own file_size_limit/allowed_mime_types
-- enforcement, and actual byte storage/retrieval — isn't RLS and isn't
-- testable here; see docs/SUPABASE_SETUP.md's own manual check for that.
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, updated_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.buckets, storage.objects to anon, authenticated;
