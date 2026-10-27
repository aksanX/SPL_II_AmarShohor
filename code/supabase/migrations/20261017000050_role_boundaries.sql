-- =====================================================================
-- AmarShohor — 50. Who is who
--
--   Super admin   The app's own staff, appointed by the app owner; supervises
--                 the whole app. Never a citizen, never a City Corporation
--                 official: doesn't report issues and can't become an official.
--   Area admin    A trusted local, appointed by a super admin for one area.
--                 May report problems as a resident; another admin decides
--                 cases about their own reports.
--   Official      City Corporation staff. Not an admin.
--
-- Fixes from the second round of testing:
--   G. Super admins don't report issues (and their own-report check can't
--      leave a case with nobody to decide it).
--   H. An area admin's own report goes straight to the super admins when
--      they are the only admin of the area, instead of waiting 24 hours.
--   I. Admins' emergency evidence checks (keep / reject) are in the
--      Activity log.
--   J. A super admin can't also be an official, and the other way round.
--   K. Appointing someone admin closes their pending official request.
--   Wording: "area" and "area admin" in the error outside one's area.
-- =====================================================================

set search_path = public, extensions;

-- =====================================================================
-- G. Super admins don't report issues
-- =====================================================================
create or replace function guard_issue_reporter() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if is_admin(new.reporter_id) then
    raise exception 'Super admins supervise the app and don''t report issues. Residents report them.'
      using hint = 'ROLE_NOT_ALLOWED';
  end if;
  return new;
end $$;

drop trigger if exists issues_guard_reporter on issues;
create trigger issues_guard_reporter before insert on issues
  for each row execute function guard_issue_reporter();

-- Admin actions on an issue: an area admin never on their own report. A
-- super admin isn't a reporter, so the check doesn't apply to them (reports
-- from before they became super admin can't end up with nobody to decide them).
-- Same as 0049 otherwise.
create or replace function require_issue_admin(p_issue uuid) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v uuid := require_admin_at((select location from issues where id = p_issue));
begin
  if not is_admin(v) and exists (select 1 from issues where id = p_issue and reporter_id = v) then
    raise exception 'This is your own report, so another admin has to handle it.' using hint = 'OWN_ISSUE';
  end if;
  return v;
end $$;

create or replace function can_admin_issue(p_issue uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select admin_covers(auth.uid(), i.location) and (is_admin(auth.uid()) or i.reporter_id is distinct from auth.uid())
    from issues i where i.id = p_issue
$$;

-- Same as 0045, with "area" wording.
create or replace function require_admin_at(p_location geography) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare v uuid := require_user();
begin
  if not admin_covers(v, p_location) then
    if city_admin_authority(v) is not null then
      raise exception 'This is outside your area. Its own area admin or a super admin decides it.'
        using hint = 'NOT_YOUR_CITY';
    end if;
    raise exception 'Only admins can do this' using hint = 'NOT_ADMIN';
  end if;
  return v;
end $$;

-- =====================================================================
-- H. An area admin's own report, when nobody else in the area can decide it
-- =====================================================================
-- Can an area admin other than the reporter decide this issue's cases?
create or replace function other_area_admin_exists(p_issue uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from issues i join user_roles u on u.role = 'city_admin' and u.authority_id = find_authority(i.location)
     where i.id = p_issue and u.user_id <> i.reporter_id)
$$;

-- Same as 0045: a new case goes to the area admins who may decide it, else to
-- the super admins.
create or replace function open_review(p_issue uuid, p_kind review_kind, p_by uuid, p_note text, p_data jsonb)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id bigint;
  v_msg text;
begin
  insert into review_items (issue_id, kind, requested_by, note, data)
  values (p_issue, p_kind, p_by, nullif(trim(p_note), ''), coalesce(p_data, '{}'))
  on conflict (issue_id, kind) where status = 'open' do nothing
  returning id into v_id;
  if v_id is null then return; end if;
  v_msg := format('Needs your decision (%s): "%s"', replace(p_kind::text, '_', ' '), (select title from issues where id = p_issue));
  if other_area_admin_exists(p_issue) then
    insert into notifications (user_id, type, issue_id, actor_id, message)
    select u.user_id, 'review_needed', p_issue, p_by, v_msg
      from issues i join user_roles u on u.role = 'city_admin' and u.authority_id = find_authority(i.location)
     where i.id = p_issue and u.user_id <> i.reporter_id and u.user_id is distinct from p_by;
  else
    perform notify_admins('review_needed', p_issue, p_by, v_msg);
    update review_items set passed_up_at = now() where id = v_id;
  end if;
end $$;

-- Same as 0048, plus super_reason 'own_report': in an area whose only admin reported it.
drop function if exists get_review_queue();
create function get_review_queue()
returns table (
  id bigint, kind review_kind, note text, data jsonb, created_at timestamptz,
  requester_username text, requester_full_name text, issue jsonb, evidence jsonb,
  city_id uuid, city_short_name text, passed_up_at timestamptz, needs_super_admin boolean, city_area text,
  super_reason text, clock_from timestamptz
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_user uuid := require_any_admin();
begin
  return query
  select q.id, q.kind, q.note, q.data, q.created_at, q.username, q.full_name, q.issue, q.evidence,
         q.city_id, q.city_short_name, q.passed_up_at, q.reason is not null, q.city_area, q.reason, q.clock_from
    from (
      select r.id, r.kind, r.note, r.data, r.created_at, p.username, p.full_name, to_jsonb(v) as issue,
             coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'media_type', m.media_type, 'path', m.storage_path))
                         from issue_media m where m.event_id = (r.data ->> 'event')::bigint), '[]'::jsonb) as evidence,
             c.id as city_id, c.short_name as city_short_name, r.passed_up_at, area_label(c.name) as city_area,
             case when c.id is null then 'no_city_corporation'
                  when not exists (select 1 from user_roles u where u.role = 'city_admin' and u.authority_id = c.id) then 'no_admin'
                  when not other_area_admin_exists(r.issue_id) then 'own_report'
                  when r.passed_up_at is not null then 'waited'
             end as reason,
             coalesce(r.area_admin_since, r.created_at) as clock_from
        from review_items r
        join issues i on i.id = r.issue_id
        join issues_v v on v.id = r.issue_id
        left join profiles p on p.id = r.requested_by
        left join authorities c on c.id = find_authority(i.location)
       where r.status = 'open'
         and admin_covers(v_user, i.location)
    ) q
   order by q.created_at;
end $$;

-- Same as 0049, but no reminder to an area admin about a case they may not decide.
create or replace function pass_up_waiting_reviews() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  r record;
  n int := 0;
begin
  select * into s from app_settings where id = 1;

  if s.city_admin_hours > s.city_admin_reminder_hours then
    for r in
      with due as (
        update review_items x set reminded_at = now()
          from issues i
         where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is null and x.reminded_at is null
           and coalesce(x.area_admin_since, x.created_at)
                 < now() - make_interval(hours => s.city_admin_hours - s.city_admin_reminder_hours)
        returning find_authority(i.location) as area_id, i.reporter_id
      )
      select d.area_id, u.user_id, count(*)::int as cases
        from due d join user_roles u on u.role = 'city_admin' and u.authority_id = d.area_id and u.user_id <> d.reporter_id
       group by d.area_id, u.user_id
    loop
      perform notify(r.user_id, 'review_needed', null, null,
        format('%s case%s in %s go%s to the super admins in about %s hours. Decide %s in the Review queue.',
               r.cases, case when r.cases = 1 then '' else 's' end, (select area_label(name) from authorities where id = r.area_id),
               case when r.cases = 1 then 'es' else '' end, s.city_admin_reminder_hours,
               case when r.cases = 1 then 'it' else 'them' end));
    end loop;
  end if;

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
-- I. Emergency evidence checks by admins go in the Activity log
-- =====================================================================
create or replace function log_emergency_review() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.review_status in ('kept', 'rejected') and old.review_status is distinct from new.review_status
     and is_any_admin(new.reviewed_by) then
    perform log_admin(new.reviewed_by,
      case when new.review_status = 'kept' then 'keep_emergency' else 'reject_emergency' end,
      new.issue_id, new.reporter_id, coalesce(new.review_note, 'Evidence checked and kept'),
      jsonb_build_object('alert_id', new.id, 'kind', new.kind));
  end if;
  return null;
end $$;

drop trigger if exists emergency_alerts_log_review on emergency_alerts;
create trigger emergency_alerts_log_review after update of review_status on emergency_alerts
  for each row execute function log_emergency_review();

-- =====================================================================
-- J. Super admin or official, never both.  K. Admin role closes official requests.
-- =====================================================================
-- Same as 0045, plus the super admin / official rule.
create or replace function guard_role_mix() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.role = 'city_admin' then
    if exists (select 1 from user_roles where user_id = new.user_id and role = 'official') then
      raise exception 'Officials can''t be area admins: an area admin judges complaints about the officials'' work. Remove their official role first.'
        using hint = 'ROLE_CONFLICT';
    end if;
    if exists (select 1 from user_roles where user_id = new.user_id and role = 'admin') then
      raise exception 'This person is a super admin, which already covers every area' using hint = 'ALREADY_ADMIN';
    end if;
    if not exists (select 1 from authorities where id = new.authority_id and kind = 'city_corporation' and is_active) then
      raise exception 'Area admins are for active City Corporation areas, not other agencies' using hint = 'BAD_AUTHORITY';
    end if;
  elsif new.role = 'official' then
    if exists (select 1 from user_roles where user_id = new.user_id and role in ('city_admin', 'admin')) then
      raise exception 'Admins can''t be City Corporation officials: officials'' work is judged by the admins.'
        using hint = 'ROLE_CONFLICT';
    end if;
  elsif new.role = 'admin' then
    if exists (select 1 from user_roles where user_id = new.user_id and role = 'official') then
      raise exception 'City Corporation officials can''t be super admins. Remove their official role first.'
        using hint = 'ROLE_CONFLICT';
    end if;
  end if;
  return new;
end $$;

-- Asking to be an official is for people who aren't admins.
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
  if is_any_admin(v_user) then
    raise exception 'Admins can''t be City Corporation officials: officials'' work is judged by the admins.'
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

-- Someone made an admin no longer waits for an official role they can't have.
create or replace function close_requests_for_admin() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  update role_requests
     set status = 'rejected', decided_by = new.granted_by, decided_at = now(),
         decision_note = case when new.role = 'admin' then 'Appointed as a super admin' else 'Appointed as an area admin' end
   where user_id = new.user_id and status = 'pending';
  return null;
end $$;

drop trigger if exists user_roles_close_requests on user_roles;
create trigger user_roles_close_requests after insert on user_roles
  for each row when (new.role in ('admin', 'city_admin')) execute function close_requests_for_admin();

-- Today's data
update role_requests r set status = 'rejected', decided_at = now(), decision_note = 'Appointed as an admin'
 where r.status = 'pending' and exists (select 1 from user_roles u where u.user_id = r.user_id and u.role in ('admin', 'city_admin'));

-- ---------- Permissions -----------------------------------------------
revoke execute on function
  guard_issue_reporter(), require_issue_admin(uuid), require_admin_at(geography), other_area_admin_exists(uuid),
  log_emergency_review(), guard_role_mix(), close_requests_for_admin()
from public, anon, authenticated;
