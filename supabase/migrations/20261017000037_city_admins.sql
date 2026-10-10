-- =====================================================================
-- AmarShohor — 37. City admins
--
-- One admin can't moderate the whole country. Each City Corporation can now
-- have its own city admins; the admins from before are the super admins.
--
-- Who does what
--   Super admin ('admin')       Everywhere. Sets up City Corporations,
--                               categories and settings, makes super admins
--                               and city admins, and decides whatever a city
--                               admin leaves waiting.
--   City admin ('city_admin')   One area (a City Corporation's map area, e.g.
--                               "Dhaka North"): the review queue,
--                               the emergency evidence check, removing fake
--                               alerts, the admin tools on an issue, and
--                               verifying that City Corporation's officials.
--   Official                    Unchanged: works on their City Corporation's issues.
--
-- A city admin is a neutral moderator, not City Corporation staff: the City
-- Corporation's area only says which places they look after. So they can't also
-- be an official (they would judge complaints about their own work). Like super admins they don't
-- vote, confirm, raise alerts or volunteer.
--
-- Where cases go
--   - A new case in the review queue goes to the city admins of the City
--     Corporation whose area contains the issue. With no city admin there, or
--     no City Corporation at all, it goes to the super admins as before.
--   - A case still open after city_admin_hours (default 24) is passed up: the
--     super admins are told and see it under "Needs you" (hourly job).
--   - Requests to be verified as an official go to that City Corporation's
--     city admins (or the super admins when it has none).
--   - Emergencies: city admins of the area are told about new and verified
--     alerts. Super admins still hear about every alert, as before.
-- =====================================================================

set search_path = public, extensions;

-- =====================================================================
-- 1. Schema
-- =====================================================================

-- A city admin belongs to one authority, like an official.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.user_roles'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%authority_id%'
  loop
    execute format('alter table user_roles drop constraint %I', c);
  end loop;
end $$;
alter table user_roles add constraint user_roles_authority_check
  check ((role in ('official', 'city_admin')) = (authority_id is not null));
create index if not exists user_roles_city_admin_idx on user_roles (authority_id) where role = 'city_admin';

alter table app_settings add column if not exists city_admin_hours int not null default 24;

-- When the super admins were asked to decide this case: at once when nobody
-- else could, or after the city admins left it for city_admin_hours.
-- Open cases from before this migration were sent to every admin. Only done
-- when the column is new, so running this file again changes nothing.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'review_items' and column_name = 'passed_up_at') then
    alter table review_items add column passed_up_at timestamptz;
    update review_items set passed_up_at = created_at where status = 'open';
  end if;
end $$;

-- =====================================================================
-- 2. Role helpers
-- =====================================================================

-- An area's name for city admins: "Dhaka North City Corporation" → "Dhaka North".
-- City admins are labelled by the area they look after, not as City Corporation staff.
create or replace function area_label(p_name text) returns text
language sql immutable as $$
  select coalesce(nullif(regexp_replace(p_name, '\s*city\s+corporation\s*$', '', 'i'), ''), p_name)
$$;

-- The City Corporation p_user is a city admin of.
create or replace function city_admin_authority(p_user uuid) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select authority_id from user_roles where user_id = p_user and role = 'city_admin'
$$;

-- Super admin or city admin: moderates, so doesn't take part as a resident.
create or replace function is_any_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from user_roles where user_id = p_user and role in ('admin', 'city_admin'))
$$;

-- May p_user act as an admin at this spot? Super admins anywhere, city admins
-- inside their City Corporation's area.
create or replace function admin_covers(p_user uuid, p_location geography) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(p_user is not null and (
           is_admin(p_user)
           or (p_location is not null and city_admin_authority(p_user) = find_authority(p_location))), false)
$$;

create or replace function require_any_admin() returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare v uuid := require_user();
begin
  if not is_any_admin(v) then
    raise exception 'Only admins can do this' using hint = 'NOT_ADMIN';
  end if;
  return v;
end $$;

create or replace function require_admin_at(p_location geography) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare v uuid := require_user();
begin
  if not admin_covers(v, p_location) then
    if city_admin_authority(v) is not null then
      raise exception 'This is outside your City Corporation. Its own city admin or a super admin decides it.'
        using hint = 'NOT_YOUR_CITY';
    end if;
    raise exception 'Only admins can do this' using hint = 'NOT_ADMIN';
  end if;
  return v;
end $$;

-- An unknown issue has no location: only a super admin gets past, and the
-- calling function then reports that the issue wasn't found.
create or replace function require_issue_admin(p_issue uuid) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  return require_admin_at((select location from issues where id = p_issue));
end $$;

-- For the issue page: may the viewer use the admin tools on this issue?
create or replace function can_admin_issue(p_issue uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select admin_covers(auth.uid(), (select location from issues where id = p_issue))
$$;

-- Officials can't be city admins and the other way round; a super admin
-- already covers every city.
create or replace function guard_role_mix() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.role = 'city_admin' then
    if exists (select 1 from user_roles where user_id = new.user_id and role = 'official') then
      raise exception 'Officials can''t be city admins: a city admin judges complaints about the officials'' work. Remove their official role first.'
        using hint = 'ROLE_CONFLICT';
    end if;
    if exists (select 1 from user_roles where user_id = new.user_id and role = 'admin') then
      raise exception 'This person is a super admin, which already covers every City Corporation' using hint = 'ALREADY_ADMIN';
    end if;
    if not exists (select 1 from authorities where id = new.authority_id and kind = 'city_corporation' and is_active) then
      raise exception 'City admins are for active City Corporations, not other agencies' using hint = 'BAD_AUTHORITY';
    end if;
  elsif new.role = 'official' and exists (select 1 from user_roles where user_id = new.user_id and role = 'city_admin') then
    raise exception 'City admins can''t be officials: they judge complaints about the officials'' work.'
      using hint = 'ROLE_CONFLICT';
  end if;
  return new;
end $$;

drop trigger if exists user_roles_guard_mix on user_roles;
create trigger user_roles_guard_mix before insert or update on user_roles
  for each row execute function guard_role_mix();

-- A city admin who becomes a super admin doesn't need the city role any more.
create or replace function admin_replaces_city_admin() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from user_roles where user_id = new.user_id and role = 'city_admin';
  return null;
end $$;

drop trigger if exists user_roles_admin_replaces_city_admin on user_roles;
create trigger user_roles_admin_replaces_city_admin after insert on user_roles
  for each row when (new.role = 'admin') execute function admin_replaces_city_admin();

-- =====================================================================
-- 3. Telling the right admins
-- =====================================================================

-- The city admins of p_authority, or the super admins when it has none.
-- Returns true when city admins were told.
create or replace function notify_city_or_super_admins(
  p_authority uuid, p_type text, p_issue uuid, p_actor uuid, p_message text
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_authority is not null
     and exists (select 1 from user_roles where role = 'city_admin' and authority_id = p_authority) then
    insert into notifications (user_id, type, issue_id, actor_id, message)
    select user_id, p_type, p_issue, p_actor, p_message
      from user_roles where role = 'city_admin' and authority_id = p_authority and user_id is distinct from p_actor;
    return true;
  end if;
  perform notify_admins(p_type, p_issue, p_actor, p_message);
  return false;
end $$;

-- Same as 0009, but a new case goes to the city admins of the issue's area.
create or replace function open_review(p_issue uuid, p_kind review_kind, p_by uuid, p_note text, p_data jsonb)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id bigint;
  v_city uuid;
begin
  insert into review_items (issue_id, kind, requested_by, note, data)
  values (p_issue, p_kind, p_by, nullif(trim(p_note), ''), coalesce(p_data, '{}'))
  on conflict (issue_id, kind) where status = 'open' do nothing
  returning id into v_id;
  if v_id is not null then
    v_city := find_authority((select location from issues where id = p_issue));
    if not notify_city_or_super_admins(v_city, 'review_needed', p_issue, p_by,
         format('Needs your decision (%s): "%s"', replace(p_kind::text, '_', ' '),
                (select title from issues where id = p_issue))) then
      update review_items set passed_up_at = now() where id = v_id;
    end if;
  end if;
end $$;

-- Cases a city admin left open for city_admin_hours go to the super admins.
-- Run hourly.
create or replace function pass_up_waiting_reviews() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  r record;
  n int := 0;
begin
  select * into s from app_settings where id = 1;
  for r in
    select x.id, x.issue_id, x.kind, i.title, area_label(a.name) as area
      from review_items x
      join issues i on i.id = x.issue_id
      left join authorities a on a.id = find_authority(i.location)
     where x.status = 'open' and x.passed_up_at is null
       and x.created_at < now() - make_interval(hours => s.city_admin_hours)
     order by x.created_at
       for update of x skip locked
  loop
    update review_items set passed_up_at = now() where id = r.id;
    perform notify_admins('review_needed', r.issue_id, null,
      format('Waiting over %s hours for the %s admin (%s): "%s". You can decide it.',
             s.city_admin_hours, coalesce(r.area, 'area'), replace(r.kind::text, '_', ' '), r.title));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Official requests: that City Corporation's city admins decide them.
-- Same as 0009 otherwise.
create or replace function request_official_role(
  p_authority uuid, p_designation text, p_office text, p_message text
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  v_name text;
begin
  if official_authority(v_user) is not null then
    raise exception 'You are already an official' using hint = 'ALREADY_OFFICIAL';
  end if;
  if city_admin_authority(v_user) is not null then
    raise exception 'City admins can''t be officials: they judge complaints about the officials'' work.'
      using hint = 'ROLE_CONFLICT';
  end if;
  select short_name into v_name from authorities where id = p_authority and is_active;
  if v_name is null then raise exception 'Unknown City Corporation' using hint = 'NOT_FOUND'; end if;
  if exists (select 1 from role_requests where user_id = v_user and status = 'pending') then
    raise exception 'You already have a pending request' using hint = 'ALREADY_REQUESTED';
  end if;
  insert into role_requests (user_id, authority_id, designation, office, message)
  values (v_user, p_authority, trim(p_designation), coalesce(trim(p_office), ''), coalesce(trim(p_message), ''));
  perform notify_city_or_super_admins(p_authority, 'role_request', null, v_user,
    format('Someone asked to be verified as a %s official.', v_name));
end $$;

-- Emergencies: the city admins of the area hear about a new alert, and about
-- a verified one waiting for the evidence check.
create or replace function notify_city_admins_of_alert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_where text := coalesce(nullif(new.address, ''), 'an unnamed spot');
begin
  if tg_op = 'INSERT' then
    insert into notifications (user_id, type, alert_id, actor_id, message)
    select r.user_id, 'emergency_admin', new.id, new.reporter_id,
           format('Emergency alert raised in your city: %s near %s.', emergency_label(new.kind), v_where)
      from user_roles r
     where r.role = 'city_admin' and r.authority_id = find_authority(new.location);
  elsif new.review_status = 'pending' and old.review_status is distinct from 'pending' then
    insert into notifications (user_id, type, alert_id, message)
    select r.user_id, 'emergency_review', new.id,
           format('Verified emergency to check: %s near %s. Look at the live evidence and keep or reject it.',
                  emergency_label(new.kind), v_where)
      from user_roles r
     where r.role = 'city_admin' and r.authority_id = find_authority(new.location)
       and r.user_id <> new.reporter_id;
  end if;
  return null;
end $$;

drop trigger if exists emergency_alerts_notify_city_admins on emergency_alerts;
create trigger emergency_alerts_notify_city_admins after insert or update of review_status on emergency_alerts
  for each row execute function notify_city_admins_of_alert();

-- =====================================================================
-- 4. City admins don't take part as residents
-- =====================================================================
-- Same as 0031/0032, with is_any_admin in place of is_admin.

create or replace function guard_citizen_action() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_issue issues;
begin
  if is_any_admin(new.user_id) then
    raise exception 'Admins don''t vote or confirm. Residents decide; use a citizen account for your own neighbourhood.'
      using hint = 'ROLE_NOT_ALLOWED';
  end if;
  if official_authority(new.user_id) is not null then
    if tg_argv[0] = 'everywhere' then
      raise exception 'City Corporation officials can''t do this. Residents decide.' using hint = 'ROLE_NOT_ALLOWED';
    end if;
    select * into v_issue from issues where id = new.issue_id;
    if official_covers(new.user_id, v_issue.authority_id, v_issue.location) then
      raise exception 'This issue is in your City Corporation''s area, so residents decide.' using hint = 'ROLE_NOT_ALLOWED';
    end if;
  end if;
  return new;
end $$;

create or replace function guard_alert_reporter() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if is_any_admin(new.reporter_id) or official_authority(new.reporter_id) is not null then
    raise exception 'Admins and officials review alerts; residents on site raise them. Call 999 first.'
      using hint = 'ROLE_NOT_ALLOWED';
  end if;
  return new;
end $$;

create or replace function guard_alert_response() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if is_any_admin(new.user_id) or official_authority(new.user_id) is not null then
    raise exception 'Residents on site confirm or deny alerts. Admins and officials review the evidence.'
      using hint = 'ROLE_NOT_ALLOWED';
  end if;
  return new;
end $$;

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

-- =====================================================================
-- 5. Admin actions on an issue: city admins inside their own city
-- =====================================================================
-- The latest version of each (0009, 0011, 0031, 0033) with only the first
-- check changed: require_admin() → require_issue_admin(...).

create or replace function admin_set_route(
  p_issue uuid, p_route issue_route, p_reason text,
  p_category text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_issue_admin(p_issue);
  v_reason text := require_reason(p_reason);
  i issues;
  v_keep boolean;  -- same route and someone is on it: they carry on
begin
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.status in ('closed', 'hidden', 'expired') then
    raise exception 'Closed, hidden or expired issues can''t be re-routed' using hint = 'LOCKED';
  end if;
  if p_route not in ('community', 'authority') then
    raise exception 'Choose volunteers or the City Corporation' using hint = 'BAD_ROUTE';
  end if;
  if p_category is not null then
    if not exists (select 1 from categories where slug = p_category and is_active) then
      raise exception 'Unknown category' using hint = 'BAD_CATEGORY';
    end if;
    update issues set category = p_category where id = p_issue;
  end if;
  v_keep := p_route = i.route and i.status in ('assigned', 'in_progress', 'resolution_submitted');

  if i.status in ('assigned', 'in_progress', 'resolution_submitted') and not v_keep then
    perform end_assignment(p_issue, 'rerouted');
    perform notify(i.volunteer_id, 'rerouted', p_issue, v_admin,
      format('An admin moved "%s" (%s). Your task ended with no penalty.', i.title, v_reason));
  end if;

  update issues set route = p_route, route_source = 'admin', updated_at = now() where id = p_issue;

  if not v_keep and i.status <> 'community_review' then
    if p_route = 'authority' then
      perform escalate_issue(p_issue, v_admin, v_reason);
    else
      update issues
         set status = 'validated', authority_id = null, escalated_at = null, due_at = null,
             overdue_notified = false, volunteer_id = null, assignment_id = null, assigned_at = null,
             lock_expires_at = null, lock_reminder_sent = false,
             resolution_note = null, resolution_submitted_at = null
       where id = p_issue;
      perform notify_audience(p_issue, 'rerouted', v_admin,
        format('"%s" is now open for volunteers.', i.title));
    end if;
  end if;

  perform log_event(p_issue, v_admin, 'rerouted', v_reason,
    jsonb_build_object('from', i.route, 'to', p_route, 'category', p_category));
  perform log_admin(v_admin, 'set_route', p_issue, null, v_reason,
    jsonb_build_object('from', i.route, 'to', p_route, 'category', p_category));
  perform resolve_reviews(p_issue,
    array['escalation_request', 'stuck', 'no_authority', 'send_back']::review_kind[],
    v_admin, 'route:' || p_route, v_reason);
end $$;

create or replace function admin_decide_escalation(p_issue uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_issue_admin(p_issue);
  v_reason text := require_reason(p_reason);
  s app_settings;
  r review_items;
  v_rejections int;
  v_title text;
begin
  select * into s from app_settings where id = 1;
  select * into r from review_items where issue_id = p_issue and kind = 'escalation_request' and status = 'open' for update;
  if not found then raise exception 'No open escalation request for this issue (another admin may have decided it)' using hint = 'NOT_FOUND'; end if;
  select title into v_title from issues where id = p_issue;

  if p_approve then
    perform admin_set_route(p_issue, 'authority', v_reason);
    perform notify(r.requested_by, 'escalation_approved', p_issue, v_admin,
      format('Your request was approved: "%s" went to the City Corporation.', v_title));
    return;
  end if;

  update issues set status = 'validated', updated_at = now() where id = p_issue and status = 'under_review';
  perform resolve_reviews(p_issue, array['escalation_request']::review_kind[], v_admin, 'rejected', v_reason);
  perform log_event(p_issue, v_admin, 'escalation_rejected', v_reason, null);
  perform log_admin(v_admin, 'reject_escalation', p_issue, r.requested_by, v_reason, null);
  perform notify(r.requested_by, 'escalation_rejected', p_issue, v_admin,
    format('Your request for "%s" was not approved: %s', v_title, v_reason));
  perform notify_audience(p_issue, 'task_released', v_admin,
    format('"%s" stays with volunteers and is open again.', v_title));

  select count(*) into v_rejections from review_items
   where kind = 'escalation_request' and requested_by = r.requested_by and decision = 'rejected'
     and resolved_at > now() - make_interval(days => s.escalation_abuse_window_days);
  if v_rejections > 0 and v_rejections % s.escalation_abuse_rejections = 0 then
    update profiles set reputation = reputation + s.rep_escalation_abuse where id = r.requested_by;
    perform notify(r.requested_by, 'escalation_abuse', p_issue, null,
      format('%s of your City Corporation requests were rejected in %s days (%s reputation).',
             v_rejections, s.escalation_abuse_window_days, s.rep_escalation_abuse));
  end if;
end $$;

create or replace function admin_decide_wrong_report(p_issue uuid, p_outcome text, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_issue_admin(p_issue);
  v_reason text := require_reason(p_reason);
  s app_settings;
  r review_items;
  i issues;
  v_open issue_status;  -- where the issue waits for its next fixer
begin
  select * into s from app_settings where id = 1;
  select * into r from review_items where issue_id = p_issue and kind = 'wrong_issue' and status = 'open' for update;
  if not found then raise exception 'No open report for this issue (another admin may have decided it)' using hint = 'NOT_FOUND'; end if;
  select * into i from issues where id = p_issue for update;
  v_open := case when i.route = 'authority' then 'escalated' else 'validated' end;

  if p_outcome = 'close' then
    update issues set status = 'closed', closed_at = now(), updated_at = now() where id = p_issue;
    perform log_event(p_issue, v_admin, 'closed', v_reason, jsonb_build_object('reason', 'admin_already_fixed'));
    perform notify_audience(p_issue, 'issue_closed', v_admin, format('"%s" was closed: %s', i.title, v_reason));
  elsif p_outcome = 'hide' then
    update issues set status = 'hidden', status_before_hidden = v_open, hidden_by_admin = true, updated_at = now()
     where id = p_issue;
    perform log_event(p_issue, v_admin, 'hidden', v_reason, null);
    perform notify(i.reporter_id, 'issue_hidden', p_issue, null,
      format('Your report "%s" was hidden after an on-site check: %s', i.title, v_reason));
  elsif p_outcome = 'lie' then
    update issues set status = v_open, updated_at = now() where id = p_issue;
    if i.route = 'authority' and i.authority_id is null then
      perform escalate_issue(p_issue, v_admin, v_reason);
    end if;
    update profiles set reputation = reputation + s.rep_wrong_issue_lie where id = r.requested_by;
    perform log_event(p_issue, v_admin, 'wrong_report_rejected', v_reason, null);
    perform notify(r.requested_by, 'wrong_report_rejected', p_issue, v_admin,
      format('Your report that "%s" was wrong turned out to be false (%s reputation).', i.title, s.rep_wrong_issue_lie));
    if i.route = 'authority' and i.authority_id is not null then
      perform notify_officials(i.authority_id, 'escalated', p_issue,
        format('"%s" is real after all and is back in your queue.', i.title));
    end if;
  else
    raise exception 'Choose close, hide or lie' using hint = 'BAD_KIND';
  end if;

  perform resolve_reviews(p_issue, array['wrong_issue']::review_kind[], v_admin, p_outcome, v_reason);
  perform log_admin(v_admin, 'wrong_report_' || p_outcome, p_issue, r.requested_by, v_reason, null);
end $$;

create or replace function admin_decide_appeal(p_issue uuid, p_restore boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_issue_admin(p_issue);
  v_reason text := require_reason(p_reason);
  i issues;
  v_flags int;
begin
  perform 1 from review_items where issue_id = p_issue and kind = 'appeal' and status = 'open' for update;
  if not found then
    raise exception 'No open appeal for this issue (another admin may have decided it)' using hint = 'NOT_FOUND';
  end if;
  select * into i from issues where id = p_issue for update;

  if p_restore then
    -- The flags were judged wrong: set them aside (and remember them for the flaggers' accuracy).
    insert into dismissed_flags (issue_id, user_id, reason, flagged_at)
    select issue_id, user_id, reason, created_at from flags where issue_id = p_issue
    on conflict do nothing;
    delete from flags where issue_id = p_issue;
    get diagnostics v_flags = row_count;
    update issues
       set status = coalesce(status_before_hidden, 'community_review'), status_before_hidden = null, updated_at = now()
     where id = p_issue;
    perform log_event(p_issue, v_admin, 'appeal_accepted', v_reason, jsonb_build_object('flags_set_aside', v_flags));
    perform notify(i.reporter_id, 'appeal_accepted', p_issue, v_admin,
      format('Your appeal was accepted: "%s" is visible again. %s', i.title, v_reason));
    perform recompute_issue(p_issue);
  else
    perform log_event(p_issue, v_admin, 'appeal_rejected', v_reason, null);
    perform notify(i.reporter_id, 'appeal_rejected', p_issue, v_admin,
      format('Your appeal for "%s" was not accepted: %s', i.title, v_reason));
  end if;

  perform resolve_reviews(p_issue, array['appeal']::review_kind[], v_admin,
    case when p_restore then 'restored' else 'kept_hidden' end, v_reason);
  perform log_admin(v_admin, case when p_restore then 'appeal_restore' else 'appeal_reject' end,
    p_issue, i.reporter_id, v_reason, null);
end $$;

create or replace function admin_decide_category(p_issue uuid, p_category text, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_issue_admin(p_issue);
  v_reason text := require_reason(p_reason);
  i issues;
begin
  perform 1 from review_items where issue_id = p_issue and kind = 'category_mismatch' and status = 'open' for update;
  if not found then
    raise exception 'No open category question for this issue (another admin may have decided it)' using hint = 'NOT_FOUND';
  end if;
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if p_category is not null and p_category <> coalesce(i.category, '') then
    perform change_issue_category(p_issue, p_category, v_admin, v_reason);
  else
    perform log_event(p_issue, v_admin, 'category_kept', v_reason, jsonb_build_object('category', i.category));
  end if;
  update issues set category_decided_at = now() where id = p_issue;
  perform resolve_reviews(p_issue, array['category_mismatch']::review_kind[], v_admin,
    case when p_category is null then 'kept' else 'category:' || p_category end, v_reason);
  perform log_admin(v_admin, 'decide_category', p_issue, null, v_reason,
    jsonb_build_object('from', i.category, 'to', coalesce(p_category, i.category)));
end $$;

create or replace function admin_dismiss_review(p_review bigint, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_issue_admin((select issue_id from review_items where id = p_review));
  v_reason text := require_reason(p_reason);
  r review_items;
begin
  select * into r from review_items where id = p_review and status = 'open' for update;
  if not found then raise exception 'Review item not found (another admin may have decided it)' using hint = 'NOT_FOUND'; end if;
  if r.kind in ('escalation_request', 'wrong_issue') then
    raise exception 'Approve or reject this request instead' using hint = 'USE_DECISION';
  end if;
  if (select route from issues where id = r.issue_id) = 'pending' then
    raise exception 'Choose volunteers or the City Corporation first' using hint = 'ROUTE_REQUIRED';
  end if;
  if r.kind = 'no_authority'
     and exists (select 1 from issues where id = r.issue_id and route = 'authority' and authority_id is null
                  and status not in ('closed', 'hidden', 'expired')) then
    raise exception 'Nobody would fix this issue. Draw a City Corporation that covers it, or send it to volunteers.'
      using hint = 'USE_DECISION';
  end if;
  update review_items
     set status = 'resolved', resolved_by = v_admin, resolved_at = now(), decision = 'dismissed', decision_note = v_reason
   where id = p_review;
  perform log_admin(v_admin, 'dismiss_review', r.issue_id, r.requested_by, v_reason, jsonb_build_object('kind', r.kind));
  if r.kind = 'send_back' then
    perform notify(r.requested_by, 'send_back_rejected', r.issue_id, v_admin,
      format('Your request to send the issue to volunteers was not approved: %s', v_reason));
  end if;
end $$;

create or replace function admin_remove_assignee(p_issue uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_issue_admin(p_issue);
  v_reason text := require_reason(p_reason);
  s app_settings;
  i issues;
  a assignments;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found or i.status not in ('assigned', 'in_progress') then
    raise exception 'Nobody is working on this issue' using hint = 'LOCKED';
  end if;
  select * into a from assignments where id = i.assignment_id;

  if a.role = 'volunteer' then
    perform end_assignment(p_issue, 'expired');
    update profiles set reputation = reputation + s.rep_task_expired, tasks_expired = tasks_expired + 1
     where id = i.volunteer_id;
  else
    perform end_assignment(p_issue, 'released');
  end if;
  perform return_to_pool(p_issue);
  perform log_event(p_issue, v_admin, 'assignee_removed', v_reason, jsonb_build_object('previous_volunteer', i.volunteer_id));
  perform log_admin(v_admin, 'remove_assignee', p_issue, i.volunteer_id, v_reason, null);
  perform notify(i.volunteer_id, 'assignee_removed', p_issue, v_admin,
    format('An admin removed you from "%s": %s%s', i.title, v_reason,
           case when a.role = 'volunteer' then format(' (%s reputation)', s.rep_task_expired) else '' end));
end $$;

create or replace function admin_request_help(p_issue uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_issue_admin(p_issue);
  s app_settings;
  i issues;
  n int;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue;
  if not found or i.status <> 'validated' or i.route <> 'community' then
    raise exception 'Only issues waiting for volunteers can get a help request' using hint = 'LOCKED';
  end if;
  n := notify_nearby_volunteers(p_issue, s.request_help_radius_m, 'help_requested', v_admin,
    format('"%s" near you needs a volunteer. The first to accept gets it.', i.title));
  perform log_admin(v_admin, 'request_help', p_issue, null, 'Asked nearby volunteers for help',
    jsonb_build_object('notified', n));
  return n;
end $$;

create or replace function admin_invite_volunteer(p_issue uuid, p_username text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_issue_admin(p_issue);
  i issues;
  v_target uuid;
begin
  select * into i from issues where id = p_issue;
  if not found or i.status <> 'validated' or i.route <> 'community' then
    raise exception 'Only issues waiting for volunteers can get an invitation' using hint = 'LOCKED';
  end if;
  select id into v_target from profiles where username = lower(trim(p_username)) and is_volunteer;
  if v_target is null then raise exception 'No volunteer with that username' using hint = 'NOT_FOUND'; end if;
  perform notify(v_target, 'invited', p_issue, v_admin,
    format('An admin invited you to take "%s". Accept it or ignore this, there is no penalty.', i.title));
  perform log_admin(v_admin, 'invite_volunteer', p_issue, v_target, 'Invited a volunteer', null);
end $$;

create or replace function admin_refer_issue(p_issue uuid, p_authority uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_issue_admin(p_issue);
  v_reason text := require_reason(p_reason);
  i issues;
  a authorities;
  v_from text;
begin
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.route <> 'authority' or i.status not in ('escalated', 'assigned', 'in_progress', 'under_review') then
    raise exception 'Only issues waiting for an authority can be referred' using hint = 'LOCKED';
  end if;
  select * into a from authorities where id = p_authority and is_active;
  if not found then raise exception 'Choose an active authority' using hint = 'NOT_FOUND'; end if;
  if a.id = i.authority_id then
    raise exception 'The issue is already with %', a.short_name using hint = 'SAME_AUTHORITY';
  end if;
  select short_name into v_from from authorities where id = i.authority_id;

  if i.status in ('assigned', 'in_progress') then
    perform end_assignment(p_issue, 'rerouted');
    perform notify(i.volunteer_id, 'rerouted', p_issue, v_admin,
      format('An admin referred "%s" to %s (%s). Your task ended.', i.title, a.short_name, v_reason));
  end if;

  update issues
     set status = 'escalated', authority_id = a.id, route_source = 'admin',
         escalated_at = now(), due_at = now() + make_interval(days => due_days(a, i.severity)),
         overdue_notified = false, volunteer_id = null, assignment_id = null, assigned_at = null,
         lock_expires_at = null, lock_reminder_sent = false,
         resolution_note = null, resolution_submitted_at = null, updated_at = now()
   where id = p_issue;

  perform log_event(p_issue, v_admin, 'referred', v_reason,
    jsonb_build_object('from', v_from, 'to', a.short_name, 'due_at', (select due_at from issues where id = p_issue)));
  perform log_admin(v_admin, 'refer_issue', p_issue, null, v_reason, jsonb_build_object('from', v_from, 'to', a.short_name));
  perform resolve_reviews(p_issue, array['send_back', 'no_authority', 'stuck']::review_kind[], v_admin, 'referred:' || a.short_name, v_reason);
  perform notify_officials(a.id, 'escalated', p_issue, format('New issue for %s: "%s"', a.short_name, i.title));
  perform notify_audience(p_issue, 'escalated', v_admin, format('"%s" was referred to %s.', i.title, a.short_name));
end $$;

-- =====================================================================
-- 6. Roles
-- =====================================================================

-- Super admins make city admins. Giving someone another City Corporation
-- moves them there.
create or replace function admin_grant_city_admin(p_username text, p_authority uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  v_target uuid;
  v_name text;
  v_area text;
begin
  select id into v_target from profiles where username = lower(trim(p_username));
  if v_target is null then raise exception 'No user with that username' using hint = 'NOT_FOUND'; end if;
  select short_name, area_label(name) into v_name, v_area from authorities where id = p_authority;
  if v_name is null then raise exception 'Unknown area' using hint = 'NOT_FOUND'; end if;
  insert into user_roles (user_id, role, authority_id, granted_by)
  values (v_target, 'city_admin', p_authority, v_admin)
  on conflict (user_id, role) do update set authority_id = excluded.authority_id, granted_by = v_admin, granted_at = now();
  perform notify(v_target, 'role_approved', null, v_admin,
    format('You are now the %s admin. Your dashboard is under "Admin".', v_area));
  perform log_admin(v_admin, 'grant_city_admin', null, v_target, v_reason, jsonb_build_object('authority', v_name));
end $$;

-- Same as 0031, but a city admin decides only requests for their own City Corporation.
create or replace function admin_decide_role_request(p_request bigint, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_any_admin();
  v_reason text := require_reason(p_reason);
  r role_requests;
  v_name text;
begin
  select * into r from role_requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'Request not found' using hint = 'NOT_FOUND'; end if;
  if not is_admin(v_admin) and r.authority_id is distinct from city_admin_authority(v_admin) then
    raise exception 'This request is for another City Corporation' using hint = 'NOT_YOUR_CITY';
  end if;
  if r.user_id = v_admin then
    raise exception 'You can''t decide your own request. Another admin has to.' using hint = 'OWN_REQUEST';
  end if;
  select short_name into v_name from authorities where id = r.authority_id;

  update role_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_admin, decision_note = v_reason, decided_at = now()
   where id = p_request;
  if p_approve then
    insert into user_roles (user_id, role, authority_id, granted_by)
    values (r.user_id, 'official', r.authority_id, v_admin)
    on conflict (user_id, role) do update set authority_id = excluded.authority_id, granted_by = v_admin, granted_at = now();
    perform notify(r.user_id, 'role_approved', null, v_admin,
      format('You are now a verified %s official. Your dashboard is under "City Corporation".', v_name));
  else
    perform notify(r.user_id, 'role_rejected', null, v_admin,
      format('Your request to be a %s official was not approved: %s', v_name, v_reason));
  end if;
  perform log_admin(v_admin, case when p_approve then 'approve_official' else 'reject_official' end,
    null, r.user_id, v_reason, jsonb_build_object('authority', v_name));
end $$;

-- Same as 0009, plus: a city admin can remove only officials of their own City
-- Corporation; removing a city's last city admin sends its open cases to the
-- super admins.
create or replace function admin_revoke_role(p_username text, p_role app_role, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_any_admin();
  v_reason text := require_reason(p_reason);
  v_target uuid;
  v_authority uuid;
  t record;
begin
  select id into v_target from profiles where username = lower(trim(p_username));
  if v_target is null then raise exception 'No user with that username' using hint = 'NOT_FOUND'; end if;
  select authority_id into v_authority from user_roles where user_id = v_target and role = p_role;
  if not is_admin(v_admin) then
    if p_role <> 'official' then
      raise exception 'Only super admins can remove admins and city admins' using hint = 'NOT_ADMIN';
    end if;
    if v_authority is distinct from city_admin_authority(v_admin) then
      raise exception 'This official works for another City Corporation' using hint = 'NOT_YOUR_CITY';
    end if;
  end if;
  if p_role = 'admin' and (select count(*) from user_roles where role = 'admin') <= 1 then
    raise exception 'There must always be at least one admin' using hint = 'LAST_ADMIN';
  end if;
  delete from user_roles where user_id = v_target and role = p_role;
  if not found then raise exception 'That user doesn''t have this role' using hint = 'NOT_FOUND'; end if;

  if p_role = 'official' then
    for t in select id from issues where volunteer_id = v_target and status in ('assigned', 'in_progress') loop
      perform end_assignment(t.id, 'released');
      perform return_to_pool(t.id);
      perform log_event(t.id, v_admin, 'released', 'The official''s role was removed', null);
    end loop;
  elsif p_role = 'city_admin'
        and not exists (select 1 from user_roles where role = 'city_admin' and authority_id = v_authority) then
    update review_items x set passed_up_at = now()
      from issues i
     where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is null
       and find_authority(i.location) = v_authority;
  end if;
  perform notify(v_target, 'role_removed', null, v_admin,
    format('Your %s role was removed: %s', replace(p_role::text, '_', ' '), v_reason));
  perform log_admin(v_admin, 'revoke_' || p_role, null, v_target, v_reason,
    case when v_authority is null then null
         else jsonb_build_object('authority', (select short_name from authorities where id = v_authority)) end);
end $$;

-- =====================================================================
-- 7. Reads
-- =====================================================================

-- Super admins: every open case. City admins: the cases in their area.
-- New at the end: the City Corporation whose area contains the issue, when
-- the case was passed to the super admins, and whether it needs them now.
drop function if exists get_review_queue();
create function get_review_queue()
returns table (
  id bigint, kind review_kind, note text, data jsonb, created_at timestamptz,
  requester_username text, requester_full_name text, issue jsonb, evidence jsonb,
  city_id uuid, city_short_name text, passed_up_at timestamptz, needs_super_admin boolean, city_area text
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_user uuid := require_any_admin();
begin
  return query
  select r.id, r.kind, r.note, r.data, r.created_at, p.username, p.full_name, to_jsonb(v),
         coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'media_type', m.media_type, 'path', m.storage_path))
                     from issue_media m where m.event_id = (r.data ->> 'event')::bigint), '[]'::jsonb),
         c.id, c.short_name, r.passed_up_at,
         r.passed_up_at is not null
           or c.id is null
           or not exists (select 1 from user_roles u where u.role = 'city_admin' and u.authority_id = c.id),
         area_label(c.name)
    from review_items r
    join issues i on i.id = r.issue_id
    join issues_v v on v.id = r.issue_id
    left join profiles p on p.id = r.requested_by
    left join authorities c on c.id = find_authority(i.location)
   where r.status = 'open'
     and admin_covers(v_user, i.location)
   order by r.created_at;
end $$;

-- Same as 0010; city admins see only requests for their City Corporation.
create or replace function get_role_requests(p_status text default 'pending')
returns table (
  id bigint, user_id uuid, username text, full_name text, account_created_at timestamptz,
  authority_short_name text, designation text, office text, message text, status text,
  created_at timestamptz, decision_note text
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_user uuid := require_any_admin();
begin
  return query
  select r.id, r.user_id, p.username, p.full_name, p.created_at, a.short_name, r.designation, r.office,
         r.message, r.status, r.created_at, r.decision_note
    from role_requests r join profiles p on p.id = r.user_id join authorities a on a.id = r.authority_id
   where r.status = p_status
     and (is_admin(v_user) or r.authority_id = city_admin_authority(v_user))
   order by r.created_at desc
   limit 200;
end $$;

-- Super admins: everything. City admins: their own actions and those about
-- their City Corporation's issues, alerts and officials.
-- New at the end: the area of the admin who acted ("Dhaka North"), when they are a city admin.
drop function if exists get_admin_log(int);
create function get_admin_log(p_limit int default 100)
returns table (id bigint, admin_username text, action text, issue_id uuid, issue_title text,
               target_username text, reason text, data jsonb, created_at timestamptz, admin_city text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_any_admin();
  v_city uuid := city_admin_authority(v_user);
begin
  return query
  select l.id, a.username, l.action, l.issue_id, i.title, t.username, l.reason, l.data, l.created_at,
         (select area_label(au.name) from user_roles ur join authorities au on au.id = ur.authority_id
           where ur.user_id = l.admin_id and ur.role = 'city_admin')
    from admin_actions l
    left join profiles a on a.id = l.admin_id
    left join profiles t on t.id = l.target_user
    left join issues i on i.id = l.issue_id
   where is_admin(v_user)
      or l.admin_id = v_user
      or find_authority(i.location) = v_city
      or find_authority((select e.location from emergency_alerts e where e.id = (l.data ->> 'alert_id')::uuid)) = v_city
      or l.data ->> 'authority' = (select x.short_name from authorities x where x.id = v_city)
   order by l.created_at desc
   limit least(greatest(p_limit, 1), 500);
end $$;

-- Timeline, comments and roles: city admins are labelled with their area ("Dhaka North").
-- Same views as 0010 / 0033, plus that at the end.
create or replace view roles_v as
select r.user_id, p.username, p.full_name, p.avatar_url, r.role, r.authority_id, a.short_name as authority_short_name, r.granted_at,
       area_label(a.name) as authority_area
from user_roles r
join profiles p on p.id = r.user_id
left join authorities a on a.id = r.authority_id;

create or replace view issue_events_v as
select e.id, e.issue_id, e.type, e.note, e.data, e.created_at,
       case when i.is_anonymous and e.actor_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else e.actor_id end as actor_id,
       case when i.is_anonymous and e.actor_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else p.username end as actor_username,
       case when i.is_anonymous and e.actor_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else p.full_name end as actor_full_name,
       case when i.is_anonymous and e.actor_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else p.avatar_url end as actor_avatar_url,
       coalesce((
         select json_agg(json_build_object('id', m.id, 'kind', m.kind, 'media_type', m.media_type, 'path', m.storage_path)
                         order by m.created_at)
           from issue_media m where m.event_id = e.id
       ), '[]'::json) as media,
       (select a.short_name from user_roles r join authorities a on a.id = r.authority_id
         where r.user_id = e.actor_id and r.role = 'official') as actor_official_of,
       coalesce(is_admin(e.actor_id), false) as actor_is_admin,
       (select area_label(a.name) from user_roles r join authorities a on a.id = r.authority_id
         where r.user_id = e.actor_id and r.role = 'city_admin') as actor_city_admin_of
from issue_events e
join issues i on i.id = e.issue_id
left join profiles p on p.id = e.actor_id;

create or replace view comments_v as
select c.id, c.issue_id, c.parent_id, c.author_id,
       p.username as author_username, p.full_name as author_full_name, p.avatar_url as author_avatar_url,
       case when c.deleted_at is not null or c.is_hidden then null else c.body end as body,
       c.deleted_at is not null as is_deleted, c.is_hidden, c.is_update, c.edited_at, c.created_at,
       coalesce(c.author_id = i.volunteer_id and i.route <> 'authority', false) as is_volunteer,
       (c.author_id = i.reporter_id and not i.is_anonymous) as is_reporter,
       exists (select 1 from comment_flags f where f.comment_id = c.id and f.user_id = auth.uid()) as my_flagged,
       (select a.short_name from user_roles r join authorities a on a.id = r.authority_id
         where r.user_id = c.author_id and r.role = 'official') as author_official_of,
       exists (select 1 from user_roles r where r.user_id = c.author_id and r.role = 'admin') as author_is_admin,
       (select area_label(a.name) from user_roles r join authorities a on a.id = r.authority_id
         where r.user_id = c.author_id and r.role = 'city_admin') as author_city_admin_of
from comments c
join profiles p on p.id = c.author_id
join issues i on i.id = c.issue_id;

-- =====================================================================
-- 8. Emergencies: city admins of the area
-- =====================================================================

-- Same as 0019: city admins of the area check the evidence too. Now never
-- null: for a resident the old version gave null, and review_emergency's
-- "if not can_review_alert(...)" let null through.
create or replace function can_review_alert(p_user uuid, p_location geography) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(p_user is not null
     and (admin_covers(p_user, p_location) or official_authority(p_user) = find_authority(p_location)), false)
$$;

-- Same as 0032, for the city admins of the area too.
create or replace function admin_hide_alert(p_alert uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin_at((select location from emergency_alerts where id = p_alert));
  v_reason text := require_reason(p_reason);
  s app_settings;
  e emergency_alerts;
begin
  select * into s from app_settings where id = 1;
  select * into e from emergency_alerts where id = p_alert for update;
  if not found then raise exception 'Alert not found' using hint = 'NOT_FOUND'; end if;
  if e.status <> 'active' then raise exception 'This alert has already ended' using hint = 'LOCKED'; end if;
  if e.verified_at is not null then
    raise exception 'People on site verified this alert. Use Keep or Reject in the evidence check.' using hint = 'USE_REVIEW';
  end if;

  update emergency_alerts set status = 'hidden', ended_at = now() where id = p_alert;
  update profiles set reputation = reputation + s.rep_false_emergency where id = e.reporter_id;
  insert into alert_updates (alert_id, author_id, kind, note)
  values (p_alert, v_admin, 'removed', left('Removed by an admin: ' || v_reason, 500));
  insert into notifications (user_id, type, alert_id, actor_id, message)
  values (e.reporter_id, 'emergency_hidden', p_alert, v_admin,
          format('Your emergency alert was removed by an admin (%s reputation): %s', s.rep_false_emergency, v_reason));
  perform log_admin(v_admin, 'hide_alert', e.issue_id, e.reporter_id, v_reason, jsonb_build_object('alert_id', p_alert));
end $$;

-- Same as 0032: city admins see the live alerts of their area.
create or replace function get_live_alerts()
returns table (
  id uuid, kind emergency_kind, address text, lat double precision, lng double precision, status text,
  created_at timestamptz, ended_at timestamptz, verified_at timestamptz, review_status text,
  confirm_count int, deny_count int, on_site_confirms int, issue_id uuid, issue_title text,
  authority_short_name text, last_update text, last_update_at timestamptz, followup_issue_id uuid
)
language sql stable security definer set search_path = public, extensions as $$
  select e.id, e.kind, e.address, ST_Y(e.location::geometry), ST_X(e.location::geometry), e.status,
         e.created_at, e.ended_at, e.verified_at, e.review_status, e.confirm_count, e.deny_count,
         (select count(*)::int from emergency_responses r
           where r.alert_id = e.id and r.response = 'confirm' and r.on_site and r.trusted
             and (r.seen_kind = e.kind or e.kind = 'other')),
         i.id, i.title, a.short_name, u.note, u.created_at, e.followup_issue_id
    from emergency_alerts e
    left join issues i on i.id = e.issue_id and i.status <> 'hidden'
    left join authorities a on a.id = find_authority(e.location)
    left join lateral (select x.note, x.created_at from alert_updates x where x.alert_id = e.id
                        order by x.created_at desc limit 1) u on true
   where (e.status = 'active' or (e.status in ('over', 'expired') and e.ended_at > now() - interval '24 hours'))
     and (admin_covers(auth.uid(), e.location) or is_area_official(auth.uid(), e.location))
   order by e.status = 'active' desc, e.verified_at is null, e.created_at desc
   limit 100
$$;

-- Same as 0032: a city admin may remove a fake from their own area.
create or replace function get_alert(p_alert uuid)
returns table (
  id uuid, kind emergency_kind, note text, lat double precision, lng double precision, address text,
  media jsonb, status text, confirm_count int, deny_count int, over_count int,
  created_at timestamptz, expires_at timestamptz, ended_at timestamptz, is_mine boolean, my_response text,
  emergency_contacts jsonb, authority_short_name text, issue_id uuid, issue_title text,
  verified_at timestamptz, live_evidence boolean, on_site_confirms int, witness_media jsonb,
  my_seen emergency_kind, review_status text, review_note text, can_review boolean,
  updates jsonb, can_update boolean, can_end boolean, can_log_damage boolean, can_hide boolean,
  followup_issue_id uuid, followup_issue_title text
)
language sql stable security definer set search_path = public, extensions as $$
  select e.id, e.kind, e.note, ST_Y(e.location::geometry), ST_X(e.location::geometry), e.address,
         case when e.status = 'hidden' and e.reporter_id is distinct from auth.uid() then '[]'::jsonb else e.media end,
         e.status, e.confirm_count, e.deny_count, e.over_count, e.created_at, e.expires_at, e.ended_at,
         coalesce(e.reporter_id = auth.uid(), false),
         (select r.response from emergency_responses r where r.alert_id = e.id and r.user_id = auth.uid()),
         coalesce(a.emergency_contacts, '[]'::jsonb), a.short_name,
         i.id, i.title,
         e.verified_at, e.live_evidence,
         (select count(*)::int from emergency_responses r
           where r.alert_id = e.id and r.response = 'confirm' and r.on_site and r.trusted
             and (r.seen_kind = e.kind or e.kind = 'other')),
         case when e.status = 'hidden' then '[]'::jsonb else coalesce(
           (select jsonb_agg(m order by r.created_at)
              from emergency_responses r, jsonb_array_elements(r.media) m
             where r.alert_id = e.id and r.response = 'confirm'), '[]'::jsonb) end,
         (select r.seen_kind from emergency_responses r where r.alert_id = e.id and r.user_id = auth.uid()),
         e.review_status, e.review_note,
         e.review_status = 'pending' and e.reporter_id is distinct from auth.uid() and can_review_alert(auth.uid(), e.location),
         coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'note', x.note, 'created_at', x.created_at,
                                                       'authority', ua.short_name, 'by_admin', x.authority_id is null)
                                    order by x.created_at)
                     from alert_updates x left join authorities ua on ua.id = x.authority_id
                    where x.alert_id = e.id), '[]'::jsonb),
         is_area_official(auth.uid(), e.location) and e.status <> 'hidden'
           and (e.status = 'active' or e.ended_at > now() - interval '24 hours'),
         is_area_official(auth.uid(), e.location) and e.status = 'active',
         is_area_official(auth.uid(), e.location) and e.status <> 'hidden' and e.followup_issue_id is null
           and (e.verified_at is not null or e.status in ('over', 'expired')),
         admin_covers(auth.uid(), e.location) and e.status = 'active' and e.verified_at is null,
         e.followup_issue_id, fi.title
    from emergency_alerts e
    left join authorities a on a.id = find_authority(e.location)
    left join issues i on i.id = e.issue_id and i.status <> 'hidden'
    left join issues fi on fi.id = e.followup_issue_id
   where e.id = p_alert
$$;

-- =====================================================================
-- 9. Permissions and the hourly job
-- =====================================================================
revoke execute on function
  city_admin_authority(uuid), is_any_admin(uuid), admin_covers(uuid, geography),
  require_any_admin(), require_admin_at(geography), require_issue_admin(uuid),
  guard_role_mix(), admin_replaces_city_admin(),
  notify_city_or_super_admins(uuid, text, uuid, uuid, text), pass_up_waiting_reviews(),
  notify_city_admins_of_alert(),
  can_admin_issue(uuid), admin_grant_city_admin(text, uuid, text),
  get_review_queue(), get_admin_log(int)
from public, anon, authenticated;
grant execute on function area_label(text) to anon, authenticated;  -- used inside views
grant execute on function
  can_admin_issue(uuid), admin_grant_city_admin(text, uuid, text),
  get_review_queue(), get_admin_log(int)
to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('amarshohor-pass-up-reviews', '23 * * * *', 'select public.pass_up_waiting_reviews()');
  else
    raise notice 'pg_cron is not enabled: schedule public.pass_up_waiting_reviews() to run hourly.';
  end if;
end $$;
