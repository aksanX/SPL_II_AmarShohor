-- =====================================================================
-- AmarShohor — 41. Area admins: fixes from testing
--
-- 1. No admin decides a case about their own report. Their report goes to
--    another admin (their area's other admins, or a super admin).
-- 2. Becoming an admin (or an official) removes the votes, confirmations and
--    other resident answers they gave as a citizen, where the new role may
--    no longer give them (as 0033 did once for everyone).
-- 3. Drawing, redrawing or switching a City Corporation moves its cases to
--    the right admins: an area admin gets the cases now inside their area
--    (fresh clock), and cases left with no area admin go to the super admins.
-- 4. Fewer notifications: one summary per area when cases pass the time
--    limit, and a reminder to the area admins city_admin_reminder_hours
--    before that.
-- 5. Switching a City Corporation off tells its area admins that they can't
--    act until it is on again.
-- =====================================================================

set search_path = public, extensions;

alter table app_settings add column if not exists city_admin_reminder_hours int not null default 6;
-- When the area admins were reminded about this case; cleared when the clock restarts.
alter table review_items add column if not exists reminded_at timestamptz;

-- =====================================================================
-- 1. Not on your own report
-- =====================================================================
-- Every admin action on an issue (0037 section 5) starts with this check.
create or replace function require_issue_admin(p_issue uuid) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v uuid := require_admin_at((select location from issues where id = p_issue));
begin
  if exists (select 1 from issues where id = p_issue and reporter_id = v) then
    raise exception 'This is your own report, so another admin has to handle it.' using hint = 'OWN_ISSUE';
  end if;
  return v;
end $$;

-- The issue page shows the admin tools only where they work.
create or replace function can_admin_issue(p_issue uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select admin_covers(auth.uid(), i.location) and i.reporter_id is distinct from auth.uid()
    from issues i where i.id = p_issue
$$;

-- =====================================================================
-- 2. A new role takes back the answers it may no longer give
-- =====================================================================
-- Admins and area admins: everywhere. Officials: on issues of their own area,
-- plus "still there?" answers everywhere. Live emergency answers: all roles.
-- Closed issues and ended alerts keep their history.
create or replace function clear_answers_for_new_role() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := new.user_id;
  v_issues uuid[];
  v_issue uuid;
begin
  with open_issues as (
    select i.id from issues i
     where i.status not in ('closed', 'expired')
       and (is_any_admin(v_user) or official_covers(v_user, i.authority_id, i.location))
  ),
  d_votes as (delete from votes x using open_issues o where x.issue_id = o.id and x.user_id = v_user returning x.issue_id),
  d_conf  as (delete from confirmations x using open_issues o where x.issue_id = o.id and x.user_id = v_user returning x.issue_id),
  d_flags as (delete from flags x using open_issues o where x.issue_id = o.id and x.user_id = v_user returning x.issue_id),
  d_sev   as (delete from severity_votes x using open_issues o where x.issue_id = o.id and x.user_id = v_user returning x.issue_id),
  d_cat   as (delete from category_suggestions x using open_issues o where x.issue_id = o.id and x.user_id = v_user returning x.issue_id),
  d_fix   as (delete from resolution_reviews x using open_issues o, issues i
               where x.issue_id = o.id and i.id = o.id and x.user_id = v_user
                 and i.status = 'resolution_submitted' and x.assignment_id = i.assignment_id returning x.issue_id),
  d_still as (delete from still_there_answers x using issues i
               where i.id = x.issue_id and x.user_id = v_user and i.status not in ('closed', 'expired') returning x.issue_id)
  select array_agg(distinct u.issue_id) into v_issues
    from (select issue_id from d_votes union all select issue_id from d_conf union all select issue_id from d_flags
          union all select issue_id from d_sev union all select issue_id from d_cat union all select issue_id from d_fix
          union all select issue_id from d_still) u;

  foreach v_issue in array coalesce(v_issues, '{}') loop
    perform recompute_issue(v_issue);
  end loop;

  -- Live alerts: residents witness, staff don't.
  with d as (delete from emergency_responses x using emergency_alerts e
              where e.id = x.alert_id and e.status = 'active' and x.user_id = v_user returning x.alert_id)
  update emergency_alerts a
     set confirm_count = (select count(*) from emergency_responses r where r.alert_id = a.id and r.response = 'confirm'),
         deny_count    = (select count(*) from emergency_responses r where r.alert_id = a.id and r.response = 'deny'),
         over_count    = (select count(*) from emergency_responses r where r.alert_id = a.id and r.response = 'over')
   where a.id in (select alert_id from d);
  return null;
end $$;

drop trigger if exists user_roles_clear_answers on user_roles;
create trigger user_roles_clear_answers after insert or update of authority_id on user_roles
  for each row execute function clear_answers_for_new_role();

-- =====================================================================
-- 3. Cases follow the areas too
-- =====================================================================
-- Puts every open case with the right admins, after City Corporation areas change:
--   - in an area that has admins, a case that was with the super admins only
--     because nobody covered it (not because the admin waited) goes to them,
--     with a fresh clock;
--   - a case in a place with no area admin goes to the super admins.
create or replace function rehome_open_cases() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
begin
  select * into s from app_settings where id = 1;
  update review_items x set passed_up_at = null, area_admin_since = now(), reminded_at = null
    from issues i
   where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is not null
     and exists (select 1 from user_roles u where u.role = 'city_admin' and u.authority_id = find_authority(i.location))
     and x.passed_up_at - coalesce(x.area_admin_since, x.created_at) < make_interval(hours => s.city_admin_hours);
  update review_items x set passed_up_at = now()
    from issues i
   where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is null
     and not exists (select 1 from user_roles u where u.role = 'city_admin' and u.authority_id = find_authority(i.location));
end $$;

create or replace function rehome_cases_after_area_change() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform rehome_open_cases();
  return null;
end $$;

drop trigger if exists authorities_rehome_cases on authorities;
create trigger authorities_rehome_cases after insert or update of area, is_active, kind on authorities
  for each statement execute function rehome_cases_after_area_change();

-- A restarted clock also restarts the reminder. Same as 0040 otherwise.
create or replace function city_admin_cases_follow() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  n int;
begin
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'city_admin'
     and (tg_op = 'INSERT' or old.authority_id is distinct from new.authority_id)
     and not exists (select 1 from user_roles
                      where role = 'city_admin' and authority_id = new.authority_id and user_id <> new.user_id) then
    update review_items x set passed_up_at = null, area_admin_since = now(), reminded_at = null
      from issues i
     where i.id = x.issue_id and x.status = 'open' and find_authority(i.location) = new.authority_id;
    get diagnostics n = row_count;
    if n > 0 then
      perform notify(new.user_id, 'review_needed', null, null,
        format('%s open case%s in %s %s now yours to decide.', n, case when n = 1 then '' else 's' end,
               (select area_label(name) from authorities where id = new.authority_id), case when n = 1 then 'is' else 'are' end));
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'city_admin'
     and (tg_op = 'DELETE' or old.authority_id is distinct from new.authority_id)
     and not exists (select 1 from user_roles where role = 'city_admin' and authority_id = old.authority_id) then
    update review_items x set passed_up_at = now()
      from issues i
     where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is null
       and find_authority(i.location) = old.authority_id;
  end if;
  return null;
end $$;

-- =====================================================================
-- 4. A reminder first, then one summary per area
-- =====================================================================
-- Run hourly. Returns how many cases were passed up.
create or replace function pass_up_waiting_reviews() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  r record;
  n int := 0;
begin
  select * into s from app_settings where id = 1;

  -- Reminder: city_admin_reminder_hours before the time is up, once per case, one message per area.
  if s.city_admin_hours > s.city_admin_reminder_hours then
    for r in
      with due as (
        update review_items x set reminded_at = now()
          from issues i
         where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is null and x.reminded_at is null
           and coalesce(x.area_admin_since, x.created_at)
                 < now() - make_interval(hours => s.city_admin_hours - s.city_admin_reminder_hours)
        returning find_authority(i.location) as area_id
      )
      select area_id, count(*)::int as cases from due where area_id is not null group by area_id
    loop
      insert into notifications (user_id, type, message)
      select u.user_id, 'review_needed',
             format('%s case%s in %s go%s to the super admins in about %s hours. Decide %s in the Review queue.',
                    r.cases, case when r.cases = 1 then '' else 's' end, (select area_label(name) from authorities where id = r.area_id),
                    case when r.cases = 1 then 'es' else '' end, s.city_admin_reminder_hours,
                    case when r.cases = 1 then 'it' else 'them' end)
        from user_roles u where u.role = 'city_admin' and u.authority_id = r.area_id;
    end loop;
  end if;

  -- Passed up: one message per area (with the issue when it is a single case).
  for r in
    with up as (
      update review_items x set passed_up_at = now()
        from issues i
       where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is null
         and coalesce(x.area_admin_since, x.created_at) < now() - make_interval(hours => s.city_admin_hours)
      returning find_authority(i.location) as area_id, x.issue_id, x.kind, i.title
    )
    select area_id, count(*)::int as cases, min(issue_id::text)::uuid as issue_id, min(kind::text) as kind, min(title) as title
      from up group by area_id
  loop
    n := n + r.cases;
    if r.cases = 1 then
      perform notify_admins('review_needed', r.issue_id, null,
        format('Waiting over %s hours for the %s admin (%s): "%s". You can decide it.',
               s.city_admin_hours, coalesce((select area_label(name) from authorities where id = r.area_id), 'area'),
               replace(r.kind, '_', ' '), r.title));
    else
      perform notify_admins('review_needed', null, null,
        format('%s admin has %s cases waiting over %s hours. See the Area admins overview in the Review queue.',
               coalesce((select area_label(name) from authorities where id = r.area_id), 'An area'), r.cases, s.city_admin_hours));
    end if;
  end loop;
  return n;
end $$;

-- =====================================================================
-- 5. Switching a City Corporation off tells its area admins
-- =====================================================================
create or replace function tell_area_admins_switched_off() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.is_active and not new.is_active then
    insert into notifications (user_id, type, message)
    select u.user_id, 'role_removed',
           format('%s was switched off in AmarShohor. You can''t act as its admin until a super admin switches it on again; its cases went to the super admins.',
                  area_label(new.name))
      from user_roles u where u.role = 'city_admin' and u.authority_id = new.id;
  elsif not old.is_active and new.is_active then
    insert into notifications (user_id, type, message)
    select u.user_id, 'role_approved', format('%s is switched on again. Its cases are back in your Review queue.', area_label(new.name))
      from user_roles u where u.role = 'city_admin' and u.authority_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists authorities_tell_area_admins on authorities;
create trigger authorities_tell_area_admins after update of is_active on authorities
  for each row execute function tell_area_admins_switched_off();

-- =====================================================================
-- Data: put today's open cases with the right admins
-- =====================================================================
do $$ begin perform rehome_open_cases(); end $$;

-- ---------- Permissions -----------------------------------------------
revoke execute on function
  require_issue_admin(uuid), clear_answers_for_new_role(), rehome_open_cases(), rehome_cases_after_area_change(),
  city_admin_cases_follow(), pass_up_waiting_reviews(), tell_area_admins_switched_off()
from public, anon, authenticated;
