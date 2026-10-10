-- =====================================================================
-- AmarShohor — 44. Fixes and "I see this too" need live photos
--
-- A fix (volunteer or City Corporation) and an on-site confirmation used
-- to accept any photo, including an old one from the gallery, and browser
-- GPS can be faked with a mock-location app. So a real problem could be
-- marked fixed with a "clean road" photo from somewhere else, and vanish
-- from the heatmap.
--
-- Now both need live photos from the in-app camera, the same system
-- emergencies use (0019): the camera asks the server for a one-time code
-- at the spot, the code is stamped on the photo, and the server checks
-- that the photo reached Storage within live_capture_seconds of the code
-- and that the code was issued near the issue. Progress photos and other
-- evidence can still come from the gallery.
--
-- app_settings.live_issue_evidence (on) lets an admin relax this, e.g. to
-- demo on a laptop without a camera.
-- =====================================================================

set search_path = public, extensions;

alter table app_settings add column live_issue_evidence boolean not null default true;

-- One live photo: the code belongs to this user, is fresh and unused, the
-- file arrived in time, and the code was issued within p_radius_m of p_point.
create or replace function use_live_capture(
  p_path text, p_token text, p_user uuid, p_point geography, p_radius_m int
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  t capture_tokens;
  v_uploaded timestamptz;
begin
  select * into s from app_settings where id = 1;
  if p_token is null or p_token !~ '^[0-9a-f-]{36}$' then
    raise exception 'Take the photo with the in-app camera at the spot (gallery photos can''t be used here)'
      using hint = 'NOT_LIVE';
  end if;
  select * into t from capture_tokens where id = p_token::uuid and user_id = p_user for update;
  if not found or t.used_at is not null or t.created_at < now() - interval '30 minutes' then
    raise exception 'This live photo has expired or was already used. Take a new one.' using hint = 'NOT_LIVE';
  end if;
  select o.created_at into v_uploaded from storage.objects o where o.bucket_id = 'media' and o.name = p_path;
  if v_uploaded is null or v_uploaded < t.created_at
     or v_uploaded > t.created_at + make_interval(secs => s.live_capture_seconds) then
    raise exception 'Live photos must be taken and sent within % seconds. Take a new one.', s.live_capture_seconds
      using hint = 'NOT_LIVE';
  end if;
  if not ST_DWithin(t.location, p_point, p_radius_m + least(t.accuracy_m, 100)) then
    raise exception 'This photo was taken more than % m from the issue', p_radius_m using hint = 'TOO_FAR';
  end if;
  update capture_tokens set used_at = now() where id = t.id;
end $$;

-- Same as 0036, plus: confirmation and resolution photos must be live.
create or replace function attach_media(
  p_issue uuid, p_user uuid, p_kind media_kind, p_media jsonb, p_event bigint,
  p_min_items int, p_require_image boolean
) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  m record;
  v_live boolean;
  v_location geography;
  v_total int := 0;
  v_images int := 0;
  v_videos int := 0;
begin
  select * into s from app_settings where id = 1;
  v_live := s.live_issue_evidence and p_kind in ('confirmation', 'resolution');
  if v_live then
    select location into v_location from issues where id = p_issue;
  end if;

  for m in select * from jsonb_to_recordset(coalesce(p_media, '[]'::jsonb)) as x(path text, type text, token text) loop
    if not owns_upload(m.path, p_user) then
      raise exception 'Invalid media file' using hint = 'BAD_MEDIA';
    end if;
    if m.type not in ('image', 'video') then
      raise exception 'Media must be an image or a video' using hint = 'BAD_MEDIA';
    end if;
    if v_live then
      perform use_live_capture(m.path, m.token, p_user, v_location,
        case p_kind when 'resolution' then s.resolution_radius_m else s.confirm_radius_m end);
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

revoke execute on function use_live_capture(text, text, uuid, geography, int) from public, anon, authenticated;
