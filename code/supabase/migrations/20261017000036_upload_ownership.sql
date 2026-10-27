-- =====================================================================
-- AmarShohor — 36. Who uploaded a file, without putting it in the file name
--
-- Uploads used to live in a folder named after the uploader's account id
-- ("<user id>/<random>.jpg"), and the functions below checked ownership by
-- that folder. But file paths are public (they are in every image link),
-- and so are profiles: anyone could look up who posted an *anonymous*
-- report from its photo link.
--
-- New uploads get untraceable names ("u/<random>.jpg"). Ownership is
-- checked against Storage's own record of the uploader
-- (storage.objects.owner_id), which the browser can't fake. Old-style
-- paths in the uploader's own folder are still accepted, so nothing that
-- was already uploaded breaks.
-- =====================================================================

set search_path = public, extensions;

create or replace function owns_upload(p_path text, p_user uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_path is not null and p_user is not null and (
    -- old style: the uploader's own folder
    position(p_user::text || '/' in p_path) = 1
    -- new style: an untraceable name, uploaded by this user according to Storage
    or (p_path ~ '^u/[0-9a-f-]{36}\.[a-z0-9]{1,5}$'
        and exists (select 1 from storage.objects o
                     where o.bucket_id = 'media' and o.name = p_path
                       and coalesce(o.owner_id, o.owner::text) = p_user::text))
  )
$$;

-- Same as 0002, but ownership is checked with owns_upload().
create or replace function attach_media(
  p_issue uuid, p_user uuid, p_kind media_kind, p_media jsonb, p_event bigint,
  p_min_items int, p_require_image boolean
) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  v_total int := 0;
  v_images int := 0;
  v_videos int := 0;
begin
  for m in select * from jsonb_to_recordset(coalesce(p_media, '[]'::jsonb)) as x(path text, type text) loop
    if not owns_upload(m.path, p_user) then
      raise exception 'Invalid media file' using hint = 'BAD_MEDIA';
    end if;
    if m.type not in ('image', 'video') then
      raise exception 'Media must be an image or a video' using hint = 'BAD_MEDIA';
    end if;
    insert into issue_media (issue_id, uploader_id, kind, media_type, storage_path, event_id)
    values (p_issue, p_user, p_kind, m.type::media_type, m.path, p_event);
    v_total := v_total + 1;
    if m.type = 'image' then v_images := v_images + 1; else v_videos := v_videos + 1; end if;
  end loop;

  if v_total > 5 then raise exception 'You can attach up to 5 files' using hint = 'BAD_MEDIA'; end if;
  if v_videos > 1 then raise exception 'You can attach only one video' using hint = 'BAD_MEDIA'; end if;
  if v_total < p_min_items then raise exception 'Please attach a photo or video as evidence' using hint = 'MEDIA_REQUIRED'; end if;
  if p_require_image and v_images = 0 then raise exception 'Please attach at least one photo' using hint = 'MEDIA_REQUIRED'; end if;
  return v_total;
end $$;

revoke execute on function owns_upload(text, uuid) from public, anon, authenticated;
