-- =====================================================================
-- AmarShohor — 28. Not knowing where someone is no longer halves their vote
--
-- voter_weight (0002) treated "no GPS and no home area" the same as "far
-- away" (×0.5). Most people never set a home area, so almost every vote
-- was halved. Now:
--   within 3 km of the issue (GPS now, or home area) ... ×1.5  (locals)
--   more than 25 km away                             ... ×0.5  (outsiders)
--   location unknown, or in between                  ... ×1    (neutral)
-- Account age and reputation work as before. Applies to new votes and flags.
-- =====================================================================

set search_path = public, extensions;

create or replace function voter_weight(p_user uuid, p_issue_location geography, p_voter_location geography)
returns numeric
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s app_settings;
  v_age_hours numeric;
  v_rep int;
  v_home geography;
  v_dist double precision;
  w numeric := 1;
begin
  select * into s from app_settings where id = 1;
  select extract(epoch from now() - created_at) / 3600, reputation into v_age_hours, v_rep
    from profiles where id = p_user;
  select home_location into v_home from user_settings where user_id = p_user;

  if v_age_hours < s.new_account_hours then w := 0.25;
  elsif v_age_hours < s.established_account_hours then w := 0.5;
  end if;

  -- Nearest known place of the voter; null when neither GPS nor home area is known.
  v_dist := least(ST_Distance(p_voter_location, p_issue_location), ST_Distance(v_home, p_issue_location));
  if v_dist <= s.local_radius_m then w := w * 1.5;
  elsif v_dist > s.far_radius_m then w := w * 0.5;
  end if;

  w := w * (1 + least(greatest(coalesce(v_rep, 0), 0), 200) / 200.0);
  return round(least(w, 3), 2);
end $$;
