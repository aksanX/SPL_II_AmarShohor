-- =====================================================================
-- AmarShohor — 40. Storage rules for untraceable upload names
-- Supabase only (needs Supabase Storage; skipped by the local tests, like 0004).
--
-- Uploads:  into your own old-style folder, or as "u/<random>.<ext>".
--           Storage records the uploader (owner_id) by itself.
-- Delete:   your own files, by that record, only while nothing uses them.
-- Admins:   may delete any unused file older than a day (cleanup).
-- Viewing stays public, as before.
-- =====================================================================

drop policy if exists "media: upload into own folder" on storage.objects;
drop policy if exists "media: delete own unused files" on storage.objects;

create policy "media: upload own files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and ((storage.foldername(name))[1] = auth.uid()::text
         or name ~ '^u/[0-9a-f-]{36}\.[a-z0-9]{1,5}$')
  );

create policy "media: delete own unused files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and coalesce(owner_id, owner::text) = auth.uid()::text
    and not public.media_in_use(name)
  );

create policy "media: admins delete unused files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and public.is_admin(auth.uid())
    and created_at < now() - interval '1 day'
    and not public.media_in_use(name)
  );
