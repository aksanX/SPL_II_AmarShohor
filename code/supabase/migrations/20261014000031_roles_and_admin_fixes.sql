-- =====================================================================
-- AmarShohor — 31. Role rules, and fixes to the admin / City Corporation flow
--
-- 1. Citizen actions stay with citizens. Admins can't vote, confirm on site,
--    flag, vote on severity or category, answer "still there?", confirm a fix,
--    raise an emergency alert or volunteer. City Corporation officials can't do
--    the same on issues of their own area (their own work must be judged by
--    residents), and can't raise alerts, answer "still there?" or volunteer.
--    Checked on the tables, so every function that writes them is covered.
-- 2. An admin deciding "the report is real" on a City Corporation issue sends it
--    back to the City Corporation (it used to land in the volunteer status,
--    where nobody could take it). Same for a hidden one restored on appeal.
-- 3. An admin keeping an issue on the same route no longer removes whoever is
--    working on it.
-- 4. Requests in the admin queue are cleared when the issue is closed, expires
--    or is taken.
-- 5. Adding or redrawing a City Corporation picks up issues waiting with none;
--    "No City Corporation" items can't be dismissed while nobody covers them.
-- 6. The public record counts only fixes a City Corporation submitted and
--    residents confirmed.
-- 7. Complaint reference, inactive City Corporations, self-approval, settings.
-- =====================================================================

set search_path = public, extensions;

-- =====================================================================
-- 1. Role rules
-- =====================================================================

-- True when p_user is an official of the authority the issue is with, or of a
-- City Corporation whose area contains it (before it is escalated).
create or replace function official_covers(p_user uuid, p_authority uuid, p_location geography) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from user_roles r join authorities a on a.id = r.authority_id
     where r.user_id = p_user and r.role = 'official'
       and (a.id = p_authority or ST_Covers(a.area, p_location)))
$$;

-- TG_ARGV[0]: 'own_area' (officials blocked on issues of their area) or
-- 'everywhere' (officials always blocked). Admins are always blocked.
create or replace function guard_citizen_action() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_issue issues;
begin
  if is_admin(new.user_id) then
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

drop trigger if exists votes_guard_role on votes;
create trigger votes_guard_role before insert on votes
  for each row execute function guard_citizen_action('own_area');
drop trigger if exists confirmations_guard_role on confirmations;
create trigger confirmations_guard_role before insert on confirmations
  for each row execute function guard_citizen_action('own_area');
drop trigger if exists flags_guard_role on flags;
create trigger flags_guard_role before insert on flags
  for each row execute function guard_citizen_action('own_area');
drop trigger if exists severity_votes_guard_role on severity_votes;
create trigger severity_votes_guard_role before insert on severity_votes
  for each row execute function guard_citizen_action('own_area');
drop trigger if exists category_suggestions_guard_role on category_suggestions;
create trigger category_suggestions_guard_role before insert on category_suggestions
  for each row execute function guard_citizen_action('own_area');
drop trigger if exists resolution_reviews_guard_role on resolution_reviews;
create trigger resolution_reviews_guard_role before insert on resolution_reviews
  for each row execute function guard_citizen_action('own_area');
drop trigger if exists still_there_answers_guard_role on still_there_answers;
create trigger still_there_answers_guard_role before insert on still_there_answers
  for each row execute function guard_citizen_action('everywhere');

-- Emergency alerts come from residents on site. Admins and officials review them.
create or replace function guard_alert_reporter() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if is_admin(new.reporter_id) or official_authority(new.reporter_id) is not null then
    raise exception 'Admins and officials review alerts; residents on site raise them. Call 999 first.'
      using hint = 'ROLE_NOT_ALLOWED';
  end if;
  return new;
end $$;

drop trigger if exists emergency_alerts_guard_role on emergency_alerts;
create trigger emergency_alerts_guard_role before insert on emergency_alerts
  for each row execute function guard_alert_reporter();

-- Volunteering is for citizens.
create or replace function set_volunteer_mode(p_on boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  v_min int;
begin
  if p_on then
    if is_admin(v_user) or official_authority(v_user) is not null then
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

-- Becoming an admin or official ends volunteer mode. Tasks already taken can
-- still be finished; new ones can't be taken.
create or replace function end_volunteer_mode_on_role() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  update profiles set is_volunteer = false where id = new.user_id and is_volunteer;
  return null;
end $$;

drop trigger if exists user_roles_end_volunteer_mode on user_roles;
create trigger user_roles_end_volunteer_mode after insert on user_roles
  for each row execute function end_volunteer_mode_on_role();

update profiles p set is_volunteer = false
 where p.is_volunteer and exists (select 1 from user_roles r where r.user_id = p.id);

-- The page needs to know when the viewer is an official of the issue's area.
-- Same view as 0010, plus `my_authority_covers` at the end.
create or replace view issues_v as
select
  i.id, i.title, i.description, i.category,
  coalesce(c.name, 'Uncategorised') as category_name, coalesce(c.name_bn, '') as category_name_bn,
  coalesce(c.icon, 'circle-help') as category_icon, coalesce(c.color, '#64748b') as category_color,
  c.resolver,
  i.severity,
  ST_Y(i.location::geometry) as lat,
  ST_X(i.location::geometry) as lng,
  i.location_accuracy_m, i.location_source, i.address,
  i.status, i.is_anonymous,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else i.reporter_id end as reporter_id,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else rp.username end as reporter_username,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else rp.full_name end as reporter_full_name,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else rp.avatar_url end as reporter_avatar_url,
  coalesce(i.reporter_id = auth.uid(), false) as is_mine,
  i.upvote_count, i.confirmation_count, i.comment_count, i.follower_count, i.flag_count,
  i.validation_score, i.validation_threshold,
  i.volunteer_id, vp.username as volunteer_username, vp.full_name as volunteer_full_name,
  vp.avatar_url as volunteer_avatar_url,
  i.assigned_at, i.lock_expires_at, i.resolution_note, i.resolution_submitted_at,
  i.validated_at, i.closed_at, i.created_at, i.updated_at, i.last_activity_at,
  exists (select 1 from votes v where v.issue_id = i.id and v.user_id = auth.uid()) as my_vote,
  exists (select 1 from confirmations x where x.issue_id = i.id and x.user_id = auth.uid()) as my_confirmed,
  exists (select 1 from flags f where f.issue_id = i.id and f.user_id = auth.uid()) as my_flagged,
  exists (select 1 from follows f where f.issue_id = i.id and f.user_id = auth.uid()) as my_following,
  (select s.severity from severity_votes s where s.issue_id = i.id and s.user_id = auth.uid()) as my_severity_vote,
  (select r.is_fixed from resolution_reviews r where r.assignment_id = i.assignment_id and r.user_id = auth.uid()) as my_resolution_review,
  exists (select 1 from ratings r where r.assignment_id = i.assignment_id) as is_rated,
  coalesce((
    select json_agg(json_build_object('id', m.id, 'kind', m.kind, 'media_type', m.media_type, 'path', m.storage_path)
                    order by (m.kind = 'report') desc, m.created_at)
      from (select * from issue_media m2
             where m2.issue_id = i.id and m2.kind in ('report', 'confirmation')
             order by (m2.kind = 'report') desc, m2.created_at limit 6) m
  ), '[]'::json) as media,
  -- v2: routing
  i.size, i.route, i.route_source,
  -- v2: City Corporation
  i.authority_id, au.name as authority_name, au.short_name as authority_short_name,
  au.hotline as authority_hotline, au.complaint_url as authority_complaint_url,
  i.escalated_at, i.due_at,
  coalesce(i.due_at < now() and i.status in ('escalated', 'assigned', 'in_progress', 'resolution_submitted'), false) as is_overdue,
  i.complaint_ref,
  coalesce(a.role, 'volunteer') as assignee_role,
  coalesce(official_authority(auth.uid()) = i.authority_id, false) as i_am_official_here,
  -- v2: teams
  coalesce(a.team_size, 1) as team_size,
  (select count(*)::int from assignment_members m where m.assignment_id = a.id and m.left_at is null) as team_count,
  coalesce(is_team_member(a.id, auth.uid()), false) as my_team_member,
  exists (select 1 from assignment_members m where m.assignment_id = a.id and m.user_id = auth.uid()
           and m.left_at is null and m.checked_in_at is not null) as my_checked_in,
  coalesce(a.lead_offer_open, false) as lead_offer_open,
  coalesce(a.lead_offer_to = auth.uid(), false) as lead_offer_to_me,
  -- v2: waiting for an admin
  exists (select 1 from review_items r where r.issue_id = i.id and r.status = 'open') as pending_review,
  -- 0031: the viewer is an official of this issue's City Corporation or area
  coalesce(official_covers(auth.uid(), i.authority_id, i.location), false) as my_authority_covers
from issues i
left join categories c on c.slug = i.category
join profiles rp on rp.id = i.reporter_id
left join profiles vp on vp.id = i.volunteer_id
left join authorities au on au.id = i.authority_id
left join assignments a on a.id = i.assignment_id;

-- =====================================================================
-- 2. "The report is real" sends the issue back to whoever should fix it
-- =====================================================================
create or replace function admin_decide_wrong_report(p_issue uuid, p_outcome text, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  s app_settings;
  r review_items;
  i issues;
  v_open issue_status;  -- where the issue waits for its next fixer
begin
  select * into s from app_settings where id = 1;
  select * into r from review_items where issue_id = p_issue and kind = 'wrong_issue' and status = 'open';
  if not found then raise exception 'No open report for this issue' using hint = 'NOT_FOUND'; end if;
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

-- Issues already caught in that state: City Corporation issues waiting in the
-- volunteer status, and hidden ones that would be restored into it.
update issues set status = 'escalated', updated_at = now()
 where route = 'authority' and status = 'validated';
update issues set status_before_hidden = 'escalated'
 where route = 'authority' and status = 'hidden' and status_before_hidden = 'validated';

-- =====================================================================
-- 3. Keeping the same route doesn't take the task away from whoever has it
-- =====================================================================
create or replace function admin_set_route(
  p_issue uuid, p_route issue_route, p_reason text,
  p_category text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
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

-- =====================================================================
-- 4. Requests the issue no longer needs leave the admin queue
-- =====================================================================
-- Requests the admin answers with a decision (escalation, "report is wrong",
-- appeal) are left to that decision.
create or replace function clear_finished_reviews() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.status in ('closed', 'expired') then
    update review_items
       set status = 'resolved', resolved_at = now(), decision = 'auto:' || new.status,
           decision_note = 'The issue was ' || new.status || ' before a decision'
     where issue_id = new.id and status = 'open'
       and kind not in ('escalation_request', 'wrong_issue', 'appeal');
  elsif new.status = 'assigned' then
    update review_items
       set status = 'resolved', resolved_at = now(), decision = 'auto:taken',
           decision_note = 'Someone took the task'
     where issue_id = new.id and status = 'open' and kind in ('stuck', 'no_authority');
  end if;
  return null;
end $$;

drop trigger if exists issues_clear_finished_reviews on issues;
create trigger issues_clear_finished_reviews
  after update of status on issues
  for each row when (old.status is distinct from new.status)
  execute function clear_finished_reviews();

update review_items r
   set status = 'resolved', resolved_at = now(), decision = 'auto:' || i.status,
       decision_note = 'The issue was ' || i.status || ' before a decision'
  from issues i
 where i.id = r.issue_id and r.status = 'open' and i.status in ('closed', 'expired')
   and r.kind not in ('escalation_request', 'wrong_issue', 'appeal');
update review_items r
   set status = 'resolved', resolved_at = now(), decision = 'auto:taken', decision_note = 'Someone took the task'
  from issues i
 where i.id = r.issue_id and r.status = 'open' and r.kind in ('stuck', 'no_authority')
   and i.status in ('assigned', 'in_progress', 'resolution_submitted');

-- =====================================================================
-- 5. Issues waiting with no City Corporation
-- =====================================================================
-- A City Corporation added, redrawn or switched on picks up the issues inside it.
create or replace function pick_up_uncovered_issues() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  if not new.is_active or new.kind <> 'city_corporation' then return null; end if;
  for r in
    select i.id from issues i
     where i.route = 'authority' and i.status = 'escalated' and i.authority_id is null
       and ST_Covers(new.area, i.location)
  loop
    perform escalate_issue(r.id, null, format('%s now covers this location', new.short_name));
    perform resolve_reviews(r.id, array['no_authority']::review_kind[], null, 'auto:' || new.short_name,
      format('%s now covers this location', new.short_name));
  end loop;
  return null;
end $$;

drop trigger if exists authorities_pick_up_issues on authorities;
create trigger authorities_pick_up_issues
  after insert or update of area, is_active, kind on authorities
  for each row execute function pick_up_uncovered_issues();

-- "No City Corporation" can't be left as is while nobody covers the issue.
create or replace function admin_dismiss_review(p_review bigint, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  r review_items;
begin
  select * into r from review_items where id = p_review and status = 'open';
  if not found then raise exception 'Review item not found' using hint = 'NOT_FOUND'; end if;
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

-- =====================================================================
-- 6. Public record: only fixes the City Corporation made count as resolved
-- =====================================================================
-- Same columns as 0010. "Resolved" and "Avg. days to fix" no longer include
-- issues neighbours closed as gone or an admin closed as already fixed.
create or replace view authority_record_v as
select a.id, a.name, a.short_name, a.hotline, a.complaint_url,
       count(i.id) filter (where i.escalated_at is not null)::int as escalated,
       count(i.id) filter (where i.status = 'closed' and i.escalated_at is not null and fx.fixed)::int as resolved,
       count(i.id) filter (where i.status in ('escalated', 'assigned', 'in_progress', 'resolution_submitted'))::int as open,
       count(i.id) filter (where i.due_at < now()
                             and i.status in ('escalated', 'assigned', 'in_progress', 'resolution_submitted'))::int as overdue,
       round((avg(extract(epoch from i.closed_at - i.escalated_at) / 86400)
                filter (where i.status = 'closed' and i.escalated_at is not null and fx.fixed))::numeric, 1) as avg_days_to_resolve
from authorities a
left join issues i on i.authority_id = a.id and i.route = 'authority'
left join lateral (
  select exists (select 1 from assignments x where x.issue_id = i.id and x.role = 'official' and x.outcome = 'completed') as fixed
) fx on true
where a.is_active
group by a.id;

-- =====================================================================
-- 7. Smaller rules
-- =====================================================================

-- Complaint reference: the City Corporation's officials and admins can change
-- it; a volunteer can only add one when none is recorded yet.
create or replace function set_complaint_ref(p_issue uuid, p_ref text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
  v_staff boolean;
begin
  select * into i from issues where id = p_issue for update;
  if not found or i.route <> 'authority' or i.status not in ('escalated', 'assigned', 'in_progress', 'resolution_submitted') then
    raise exception 'Only open City Corporation issues have a complaint reference' using hint = 'LOCKED';
  end if;
  v_staff := official_authority(v_user) = i.authority_id or is_admin(v_user);
  if not (v_staff or (select is_volunteer from profiles where id = v_user)) then
    raise exception 'Only volunteers can record the complaint reference' using hint = 'NOT_VOLUNTEER';
  end if;
  if not coalesce(v_staff, false) and coalesce(i.complaint_ref, '') <> '' then
    raise exception 'A complaint reference is already recorded. Only the City Corporation or an admin can change it.'
      using hint = 'ALREADY_SET';
  end if;
  if char_length(coalesce(trim(p_ref), '')) not between 2 and 120 then
    raise exception 'Enter the reference number you got from the hotline' using hint = 'NOTE_REQUIRED';
  end if;
  update issues set complaint_ref = trim(p_ref), updated_at = now() where id = p_issue;
  perform log_event(p_issue, v_user, 'complaint_ref', trim(p_ref), null);
end $$;

-- Officials of a switched-off City Corporation or agency can't take new tasks.
create or replace function guard_official_assignment() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.role = 'official' and not exists (
       select 1 from issues i join authorities a on a.id = i.authority_id
        where i.id = new.issue_id and a.is_active) then
    raise exception 'This City Corporation is switched off in AmarShohor. Ask an admin to switch it on or refer the issue.'
      using hint = 'AUTHORITY_INACTIVE';
  end if;
  return new;
end $$;

drop trigger if exists assignments_guard_official on assignments;
create trigger assignments_guard_official before insert on assignments
  for each row execute function guard_official_assignment();

-- Another admin decides an admin's own official request.
create or replace function admin_decide_role_request(p_request bigint, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  r role_requests;
  v_name text;
begin
  select * into r from role_requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'Request not found' using hint = 'NOT_FOUND'; end if;
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

-- Settings: refuse values that would break the rules.
--   rep_*                   any whole number (rewards and penalties)
--   min_/max_lat, _lng      any number (the country's bounding box)
--   heat_min_decay, low_activity_factor   above 0, at most 1
--   may be 0                waiting times that can be switched off (demo mode)
--   everything else         at least 1
create or replace function admin_update_settings(p_changes jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  k text;
  v jsonb;
  n numeric;
  v_type text;
begin
  for k, v in select * from jsonb_each(p_changes) loop
    select format_type(atttypid, atttypmod) into v_type
      from pg_attribute where attrelid = 'public.app_settings'::regclass and attname = k and attnum > 0 and not attisdropped;
    if v_type is null or k = 'id' then
      raise exception 'Unknown setting: %', k using hint = 'BAD_SETTING';
    end if;
    if jsonb_typeof(v) <> 'number' then
      raise exception 'Setting % must be a number', k using hint = 'BAD_SETTING';
    end if;
    n := (v #>> '{}')::numeric;
    if v_type = 'integer' and n <> trunc(n) then
      raise exception 'Setting % must be a whole number', k using hint = 'BAD_SETTING';
    end if;
    if k like 'rep\_%' or k in ('min_lat', 'max_lat', 'min_lng', 'max_lng') then
      null;
    elsif k in ('heat_min_decay', 'low_activity_factor') then
      if n <= 0 or n > 1 then
        raise exception 'Setting % must be above 0 and at most 1', k using hint = 'BAD_SETTING';
      end if;
    elsif k in ('new_account_hours', 'established_account_hours', 'volunteer_min_account_hours',
                'escalation_retake_days', 'route_lock_days', 'lock_reminder_hours', 'low_activity_user_count',
                'max_reopens', 'team_lead_min_tasks', 'flag_accuracy_min') then
      if n < 0 then
        raise exception 'Setting % can''t be negative', k using hint = 'BAD_SETTING';
      end if;
    elsif n < 1 then
      raise exception 'Setting % must be at least 1', k using hint = 'BAD_SETTING';
    end if;
    execute format('update app_settings set %I = $1::%s where id = 1', k, v_type) using v #>> '{}';
  end loop;
  perform log_admin(v_admin, 'update_settings', null, null, 'Changed settings', p_changes);
end $$;

-- ---------- Permissions -------------------------------------------
-- official_covers is called inside issues_v, which checks function
-- permissions as the viewer (see 0010).
grant execute on function official_covers(uuid, uuid, geography) to anon, authenticated;
revoke execute on function
  guard_citizen_action(), guard_alert_reporter(), end_volunteer_mode_on_role(), clear_finished_reviews(),
  pick_up_uncovered_issues(), guard_official_assignment()
from public, anon, authenticated;
