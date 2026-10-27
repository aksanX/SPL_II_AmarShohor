-- =====================================================================
-- AmarShohor — 4. Media storage (Supabase Storage)
-- Files are stored as  media/<user-id>/<random>.<ext>
-- Anyone can view; you can only upload into your own folder; you can only
-- delete your own files and only if they are not used as evidence.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 26214400,  -- 25 MB
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "media: anyone can view"
  on storage.objects for select
  using (bucket_id = 'media');

create policy "media: upload into own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "media: delete own unused files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'media'
         and (storage.foldername(name))[1] = auth.uid()::text
         and not public.media_in_use(name));
