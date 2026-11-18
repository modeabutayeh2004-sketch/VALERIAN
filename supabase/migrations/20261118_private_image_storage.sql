-- VALERIAN private image storage
-- Additive migration: preserves all existing state, images, and journal records.
-- Run once in the Supabase SQL Editor for project uamxuocwwxoqbiopinuh.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'valerian-assets',
  'valerian-assets',
  false,
  20971520,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','image/svg+xml']
)
on conflict (id) do update
set public = false,
    file_size_limit = 20971520,
    allowed_mime_types = excluded.allowed_mime_types;

-- Every object is stored under <authenticated-user-uuid>/<asset-id>-<sha256>.<ext>.
-- Users can access only objects inside their own first-level folder.
drop policy if exists "VALERIAN assets read own" on storage.objects;
create policy "VALERIAN assets read own"
on storage.objects for select to authenticated
using (
  bucket_id = 'valerian-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "VALERIAN assets insert own" on storage.objects;
create policy "VALERIAN assets insert own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'valerian-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "VALERIAN assets update own" on storage.objects;
create policy "VALERIAN assets update own"
on storage.objects for update to authenticated
using (
  bucket_id = 'valerian-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'valerian-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "VALERIAN assets delete own" on storage.objects;
create policy "VALERIAN assets delete own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'valerian-assets'
  and (storage.foldername(name))[1] = auth.uid()::text
);
