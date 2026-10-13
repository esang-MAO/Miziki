-- =====================================================================
-- Miziki social layer — migration 6: custom covers and profile pictures
-- (step 07, B4). Images go to Supabase Storage, not the database — this
-- migration only adds the two buckets and their RLS policies on the
-- existing storage.objects/storage.buckets tables Supabase itself
-- provides; nothing here creates either of those tables.
--
-- What gets backed up, and what never does (src/sync/images.js, src/
-- sync/backup.js): custom covers the user set in the edit sheet, and the
-- profile picture (which doubles as the public avatar once signed in).
-- Generated crate-art tiers, the thumb:* thumbnails, and embedded
-- artwork inside a music file are never uploaded — all three are
-- rebuilt locally (crate tiers/thumbnails from whatever art is already
-- on the device; embedded art comes back with the file itself).
-- =====================================================================

-- ---------- 1. buckets ------------------------------------------------
-- covers: private — only the owner can read, upload or delete under
-- their own {user_id}/ folder. Path: {user_id}/{sha256}.jpg.
-- avatars: publicly readable — friends see your picture. Only the
-- owner can upload or delete. Path: {user_id}/avatar-{sha256}.jpg.
-- Both: allowed types image/jpeg + image/webp, and a size cap enforced
-- by the Storage API itself (not something a Postgres policy can check)
-- — about 1 MB for covers, 300 KB for avatars, per the spec. `on
-- conflict (id) do nothing` makes re-running this file in the SQL
-- editor harmless, the same caution 005's own bucket-less tables didn't
-- need but this one, touching Supabase-managed tables, does.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('covers',  'covers',  false, 1048576, array['image/jpeg', 'image/webp']),
  ('avatars', 'avatars', true,   307200, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- ---------- 2. covers: owner-only under their own folder --------------
-- storage.foldername(name) splits the object's path on '/' and drops
-- the last segment, so (storage.foldername(name))[1] is exactly the
-- {user_id} prefix both paths above are keyed by.
create policy covers_select on storage.objects for select to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy covers_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy covers_update on storage.objects for update to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy covers_delete on storage.objects for delete to authenticated
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 3. avatars: public read, owner-only write ------------------
-- `to public` (not just `authenticated`) so a signed-out visitor viewing
-- a friend's storefront link can see their picture too — the bucket's
-- own `public = true` flag already lets the Storage API serve these
-- without even reaching RLS, but this policy keeps direct table access
-- consistent with that, rather than relying on the one mechanism alone.
create policy avatars_select on storage.objects for select to public
  using (bucket_id = 'avatars');
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 4. account deletion ---------------------------------------
-- Storage objects have no foreign key to auth.users, so
-- delete_my_account()'s existing cascades (005_backup.sql) can't reach
-- either bucket — src/miziki-social.js's deleteAccount() lists and
-- removes the caller's own covers/{uid}/ and avatars/{uid}/ files via
-- the Storage API, before calling the RPC, while this account's own
-- owner-only policies above still apply to it. No SQL change needed
-- here; noted so this migration's own comment doesn't look like it
-- forgot about the gap.
