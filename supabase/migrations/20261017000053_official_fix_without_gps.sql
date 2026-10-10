-- =====================================================================
-- AmarShohor — 53. City Corporation fixes without the on-site GPS check
--
-- City Corporation officials are not volunteers: their work crews fix the
-- issue, and the official usually submits the fix from the office. So an
-- official's fix no longer needs a GPS spot within resolution_radius_m.
-- The "after" photo is still required, and the community still confirms
-- or rejects the fix before the issue closes. Volunteers are unchanged.
-- =====================================================================

set search_path = public, extensions;

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
  perform attach_media(p_issue, v_user, 'resolution', p_media, v_event, 1, true);
  perform notify_audience(p_issue, 'resolution_submitted', v_user,
    format('%s says "%s" is fixed. Is it? Please confirm.',
           case when i.route = 'authority' then coalesce((select short_name from authorities where id = i.authority_id), 'The City Corporation')
                else 'The volunteer' end, i.title));
end $$;
