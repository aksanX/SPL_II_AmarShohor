-- =====================================================================
-- AmarShohor — 38. Profile pictures count as files in use
--
-- media_in_use decides which uploads may be deleted. It knew about report
-- photos and emergency photos, but not profile pictures, so a cleanup could
-- have removed someone's current avatar. Same as 0019 plus avatars.
-- =====================================================================

set search_path = public, extensions;

create or replace function media_in_use(p_path text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from issue_media where storage_path = p_path)
      or exists (select 1 from emergency_alerts where media @> jsonb_build_array(jsonb_build_object('path', p_path)))
      or exists (select 1 from emergency_responses where media @> jsonb_build_array(jsonb_build_object('path', p_path)))
      -- avatar_url is the public link, which ends with the file's path
      or exists (select 1 from profiles where avatar_url like '%/' || p_path)
$$;
