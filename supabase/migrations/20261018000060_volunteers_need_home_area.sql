-- =====================================================================
-- AmarShohor — 60. Volunteers need a home area
--
-- "Ask nearby volunteers" and team recruiting reach volunteers by their
-- home area (notify_nearby_volunteers). A volunteer without one never got
-- those requests, so:
--   - turning on volunteer mode needs a home area,
--   - a volunteer can move their home area but not clear it.
-- Volunteers from before this keep volunteer mode; the volunteer page asks
-- them to set one.
-- =====================================================================

set search_path = public, extensions;

-- Same as 0045, plus the home area check.
create or replace function set_volunteer_mode(p_on boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  v_min int;
begin
  if p_on then
    if is_any_admin(v_user) or official_authority(v_user) is not null then
      raise exception 'Admins and City Corporation officials can''t volunteer. Use a citizen account.'
        using hint = 'ROLE_NOT_ALLOWED';
    end if;
    select volunteer_min_account_hours into v_min from app_settings where id = 1;
    if (select created_at from profiles where id = v_user) > now() - make_interval(hours => v_min) then
      raise exception 'Your account must be at least % hours old to volunteer', v_min using hint = 'ACCOUNT_TOO_NEW';
    end if;
    if (select home_location from user_settings where user_id = v_user) is null then
      raise exception 'Set your home area first, so you hear about tasks near you' using hint = 'HOME_REQUIRED';
    end if;
    update profiles set is_volunteer = true, volunteer_since = coalesce(volunteer_since, now()) where id = v_user;
  else
    if exists (select 1 from assignments where volunteer_id = v_user and outcome = 'active' and role = 'volunteer')
       or exists (select 1 from assignment_members m join assignments a on a.id = m.assignment_id
                   where m.user_id = v_user and m.left_at is null and a.outcome = 'active') then
      raise exception 'Finish, release or leave your active tasks first' using hint = 'HAS_ACTIVE_TASKS';
    end if;
    update profiles set is_volunteer = false where id = v_user;
  end if;
end $$;

-- Same as 0002, plus: volunteers can't clear their home area.
create or replace function update_my_settings(
  p_home_lat double precision, p_home_lng double precision,
  p_default_anonymous boolean, p_show_on_leaderboard boolean
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_user uuid := require_user();
begin
  if p_home_lat is not null then perform assert_in_service_area(p_home_lat, p_home_lng); end if;
  if p_home_lat is null and (select is_volunteer from profiles where id = v_user) then
    raise exception 'Volunteers need a home area. Move it instead, or turn off volunteer mode first.'
      using hint = 'HOME_REQUIRED';
  end if;
  update user_settings
     set home_location = make_point(p_home_lat, p_home_lng),
         default_anonymous = coalesce(p_default_anonymous, default_anonymous),
         show_on_leaderboard = coalesce(p_show_on_leaderboard, show_on_leaderboard),
         updated_at = now()
   where user_id = v_user;
end $$;
