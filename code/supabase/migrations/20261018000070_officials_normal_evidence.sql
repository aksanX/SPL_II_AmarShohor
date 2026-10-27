-- =====================================================================
-- AmarShohor — 70. City Corporation officials use normal, optional evidence
--
-- 0053 made fix and "I see this too" photos live (in-app camera, at the
-- spot) for everyone. That is for volunteers and residents, who could fake
-- them. City Corporation officials are trusted government staff who submit
-- the fix for their crews, usually from the office (0057: no on-site GPS
-- check). So for an official's fix:
--   - the "after" photo is normal evidence: any photo, no live code, no
--     distance check (attach_media, same as 0053 otherwise);
--   - the photo is optional: they are busy (submit_resolution, same as
--     0057 otherwise).
-- Residents still decide: "fixed" (it's gone) closes the issue, "still
-- there" sends it back to the same City Corporation's dashboard.
-- =====================================================================

set search_path = public, extensions;

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
  v_live := s.live_issue_evidence and p_kind in ('confirmation', 'resolution')
    -- the official working on a City Corporation task: normal evidence
    and not (p_kind = 'resolution' and exists (
      select 1 from issues i join assignments a on a.id = i.assignment_id
       where i.id = p_issue and a.role = 'official' and a.volunteer_id = p_user and a.outcome = 'active'));
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

create or replace function submit_resolution(
  p_issue uuid, p_note text, p_lat double precision, p_lng double precision,
  p_accuracy_m real, p_media jsonb
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_here geography := make_point(p_lat, p_lng);
  v_dist double precision;
  v_official boolean;
  v_event bigint;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found or i.volunteer_id is distinct from v_user or i.status not in ('assigned', 'in_progress') then
    raise exception 'This is not your active task' using hint = 'FORBIDDEN';
  end if;
  if char_length(coalesce(trim(p_note), '')) < 3 then
    raise exception 'Please describe what was done' using hint = 'NOTE_REQUIRED';
  end if;
  v_official := coalesce((select role = 'official' from assignments where id = i.assignment_id), false);

  if not v_official then
    if v_here is null then
      raise exception 'Your location is needed to submit a resolution' using hint = 'LOCATION_REQUIRED';
    end if;
    v_dist := ST_Distance(v_here, i.location);
    if v_dist > s.resolution_radius_m + least(coalesce(p_accuracy_m, 0), 100) then
      raise exception 'You must be at the issue location (within % m) to submit the fix. You are % m away.',
        s.resolution_radius_m, round(v_dist) using hint = 'TOO_FAR';
    end if;
  end if;

  update issues
     set status = 'resolution_submitted', resolution_note = trim(p_note),
         resolution_submitted_at = now(), lock_expires_at = null, updated_at = now()
   where id = p_issue;

  v_event := log_event(p_issue, v_user, 'resolution_submitted', trim(p_note),
                       case when v_dist is not null then jsonb_build_object('distance_m', round(v_dist)) end);
  -- Officials: the "after" photo is optional (they're busy; residents confirm it's gone or still there).
  perform attach_media(p_issue, v_user, 'resolution', p_media, v_event,
                       case when v_official then 0 else 1 end, not v_official);
  perform notify_audience(p_issue, 'resolution_submitted', v_user,
    format('%s says "%s" is fixed. Is it? Please confirm.',
           case when i.route = 'authority' then coalesce((select short_name from authorities where id = i.authority_id), 'The City Corporation')
                else 'The volunteer' end, i.title));
end $$;
