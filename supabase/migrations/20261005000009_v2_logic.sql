-- =====================================================================
-- AmarShohor v2 — 9. Business logic
-- Same rules as 0002: every write goes through a SECURITY DEFINER function,
-- errors carry a machine code in HINT. Functions from 0002 that change
-- behaviour are replaced here in full.
-- =====================================================================

set search_path = public, extensions;

-- ---------- Role helpers --------------------------------------------

create or replace function is_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from user_roles where user_id = p_user and role = 'admin')
$$;

create or replace function official_authority(p_user uuid) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select authority_id from user_roles where user_id = p_user and role = 'official'
$$;

create or replace function require_admin() returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare v uuid := require_user();
begin
  if not is_admin(v) then
    raise exception 'Only admins can do this' using hint = 'NOT_ADMIN';
  end if;
  return v;
end $$;

-- Every admin decision about an issue needs a written reason.
create or replace function require_reason(p text) returns text
language plpgsql immutable as $$
begin
  if char_length(coalesce(trim(p), '')) < 5 then
    raise exception 'Please give a reason (at least 5 characters)' using hint = 'REASON_REQUIRED';
  end if;
  return trim(p);
end $$;

create or replace function log_admin(p_admin uuid, p_action text, p_issue uuid, p_target uuid, p_reason text, p_data jsonb)
returns void
language sql security definer set search_path = public, extensions as $$
  insert into admin_actions (admin_id, action, issue_id, target_user, reason, data)
  values (p_admin, p_action, p_issue, p_target, coalesce(p_reason, ''), coalesce(p_data, '{}'))
$$;

create or replace function notify_admins(p_type text, p_issue uuid, p_actor uuid, p_message text) returns void
language sql security definer set search_path = public, extensions as $$
  insert into notifications (user_id, type, issue_id, actor_id, message)
  select user_id, p_type, p_issue, p_actor, p_message
    from user_roles where role = 'admin' and user_id is distinct from p_actor
$$;

create or replace function notify_officials(p_authority uuid, p_type text, p_issue uuid, p_message text) returns void
language sql security definer set search_path = public, extensions as $$
  insert into notifications (user_id, type, issue_id, message)
  select user_id, p_type, p_issue, p_message
    from user_roles where role = 'official' and authority_id = p_authority
$$;

-- Volunteers whose saved home area is near the issue.
create or replace function notify_nearby_volunteers(p_issue uuid, p_radius_m int, p_type text, p_actor uuid, p_message text)
returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  insert into notifications (user_id, type, issue_id, actor_id, message)
  select p.id, p_type, p_issue, p_actor, p_message
    from profiles p
    join user_settings us on us.user_id = p.id
    join issues i on i.id = p_issue
   where p.is_volunteer and p.id is distinct from p_actor and p.id <> i.reporter_id
     and us.home_location is not null
     and ST_DWithin(us.home_location, i.location, p_radius_m);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- City Corporation routing --------------------------------

-- The smallest active service area that contains the point.
create or replace function find_authority(p_location geography) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select id from authorities
   where is_active and ST_Covers(area, p_location)
   order by ST_Area(area) asc
   limit 1
$$;

create or replace function due_days(a authorities, p severity_level) returns int
language sql immutable as $$
  select case p when 'critical' then a.due_days_critical when 'high' then a.due_days_high
                when 'medium' then a.due_days_medium else a.due_days_low end
$$;

create or replace function open_review(p_issue uuid, p_kind review_kind, p_by uuid, p_note text, p_data jsonb)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into review_items (issue_id, kind, requested_by, note, data)
  values (p_issue, p_kind, p_by, nullif(trim(p_note), ''), coalesce(p_data, '{}'))
  on conflict (issue_id, kind) where status = 'open' do nothing;
  if found then
    perform notify_admins('review_needed', p_issue, p_by,
      format('Needs your decision (%s): "%s"', replace(p_kind::text, '_', ' '),
             (select title from issues where id = p_issue)));
  end if;
end $$;

create or replace function resolve_reviews(p_issue uuid, p_kinds review_kind[], p_admin uuid, p_decision text, p_note text)
returns void
language sql security definer set search_path = public, extensions as $$
  update review_items
     set status = 'resolved', resolved_by = p_admin, resolved_at = now(),
         decision = p_decision, decision_note = p_note
   where issue_id = p_issue and status = 'open' and kind = any(p_kinds)
$$;

-- Hands a validated issue to the City Corporation that covers its location
-- and starts the target-time clock. If no City Corporation covers it, the
-- admin is asked to add one or send the issue to volunteers.
create or replace function escalate_issue(p_issue uuid, p_actor uuid, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  i issues;
  a authorities;
begin
  select * into i from issues where id = p_issue;
  select * into a from authorities where id = find_authority(i.location);

  update issues
     set status = 'escalated', route = 'authority', authority_id = a.id,
         escalated_at = coalesce(escalated_at, now()),
         due_at = case when a.id is null then null
                       else coalesce(due_at, now() + make_interval(days => due_days(a, i.severity))) end,
         volunteer_id = null, assignment_id = null, assigned_at = null,
         lock_expires_at = null, lock_reminder_sent = false,
         resolution_note = null, resolution_submitted_at = null, updated_at = now()
   where id = p_issue;

  if a.id is null then
    perform log_event(p_issue, p_actor, 'escalated', 'No City Corporation covers this location yet', null);
    perform open_review(p_issue, 'no_authority', null, null, null);
    return;
  end if;

  perform log_event(p_issue, p_actor, 'escalated', p_note,
    jsonb_build_object('authority', a.short_name, 'due_at', (select due_at from issues where id = p_issue)));
  perform notify_officials(a.id, 'escalated', p_issue,
    format('New issue for %s: "%s"', a.short_name, i.title));
  perform notify_audience(p_issue, 'escalated', p_actor,
    format('"%s" was sent to %s.', i.title, a.short_name));
end $$;

-- Back to whoever should pick it up next: volunteers, or the same City Corporation.
create or replace function return_to_pool(p_issue uuid) returns void
language sql security definer set search_path = public, extensions as $$
  update issues
     set status = case when route = 'authority' then 'escalated'::issue_status else 'validated'::issue_status end,
         volunteer_id = null, assignment_id = null, assigned_at = null,
         lock_expires_at = null, lock_reminder_sent = false,
         resolution_note = null, resolution_submitted_at = null, updated_at = now()
   where id = p_issue
$$;

-- ---------- The validation engine (replaces 0002) -------------------
create or replace function recompute_issue(p_issue uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  i issues;
  v_votes int; v_vote_w numeric;
  v_conf int;  v_conf_w numeric;
  v_flags int; v_flag_w numeric;
  v_sev severity_level;
  v_sev_votes int;
  v_threshold numeric;
  v_active_nearby int;
  v_score numeric;
  v_should_hide boolean;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found then return; end if;

  select count(*), coalesce(sum(weight), 0) into v_votes, v_vote_w from votes where issue_id = p_issue;
  select count(*), coalesce(sum(weight), 0) into v_conf, v_conf_w from confirmations where issue_id = p_issue;
  select count(*), coalesce(sum(weight), 0) into v_flags, v_flag_w from flags where issue_id = p_issue;

  -- Severity: category starting point until 3 people vote, then the median vote.
  select count(*) into v_sev_votes from severity_votes where issue_id = p_issue;
  if v_sev_votes >= 3 then
    select percentile_disc(0.5) within group (order by severity) into v_sev
      from severity_votes where issue_id = p_issue;
  else
    v_sev := coalesce(i.base_severity,
                      (select default_severity from categories where slug = i.category),
                      'medium');
  end if;

  v_threshold := case v_sev
    when 'critical' then s.threshold_critical
    when 'high'     then s.threshold_high
    when 'medium'   then s.threshold_medium
    else s.threshold_low end;

  select count(distinct u) into v_active_nearby from (
    select v.user_id as u from votes v join issues x on x.id = v.issue_id
     where v.created_at > now() - interval '30 days'
       and ST_DWithin(x.location, i.location, s.local_radius_m)
    union
    select x.reporter_id from issues x
     where x.created_at > now() - interval '30 days'
       and ST_DWithin(x.location, i.location, s.local_radius_m)
  ) active;
  if v_active_nearby < s.low_activity_user_count then
    v_threshold := greatest(s.min_threshold, ceil(v_threshold * s.low_activity_factor));
  end if;

  v_score := v_vote_w + v_conf_w;
  v_should_hide := v_flags >= s.hide_min_flags and v_flag_w > v_score;

  update issues
     set upvote_count = v_votes, confirmation_count = v_conf, flag_count = v_flags,
         validation_score = v_score, flag_score = v_flag_w,
         severity = v_sev, validation_threshold = v_threshold, updated_at = now()
   where id = p_issue;

  -- Hide / unhide. Only before anyone takes the issue.
  if v_should_hide and i.status in ('community_review', 'validated', 'escalated') then
    update issues set status = 'hidden', status_before_hidden = i.status where id = p_issue;
    perform log_event(p_issue, null, 'hidden',
      'Hidden automatically: more people flagged it as fake than vouched for it',
      jsonb_build_object('flags', v_flags, 'flag_score', v_flag_w, 'score', v_score));
    perform notify(i.reporter_id, 'issue_hidden', p_issue, null,
      format('Your report "%s" was hidden because many people flagged it. Support from others can bring it back.', i.title));
    return;
  elsif not v_should_hide and i.status = 'hidden' then
    i.status := coalesce(i.status_before_hidden, 'community_review');
    update issues set status = i.status, status_before_hidden = null where id = p_issue;
    perform log_event(p_issue, null, 'unhidden', 'Visible again: community support now outweighs the flags', null);
  end if;

  if i.status = 'community_review' and v_score >= v_threshold
     and v_votes + v_conf >= s.min_supporters then
    update issues set status = 'validated', validated_at = now() where id = p_issue;
    perform log_event(p_issue, null, 'validated',
      format('Validated by the community (score %s of %s needed)', v_score, v_threshold),
      jsonb_build_object('score', v_score, 'threshold', v_threshold));
    if i.route = 'authority' then
      perform escalate_issue(p_issue, null, null);
    elsif i.route = 'community' then
      perform notify_audience(p_issue, 'issue_validated', null,
        format('"%s" was validated by the community and is now open for volunteers.', i.title));
    else
      perform notify_audience(p_issue, 'issue_validated', null,
        format('"%s" was validated. An admin is deciding whether volunteers or the City Corporation should fix it.', i.title));
    end if;
  end if;
end $$;

-- ---------- Reporting (replaces 0002) -------------------------------

-- Any open issue close by. p_category null = any category.
create or replace function find_nearby_duplicates(p_lat double precision, p_lng double precision, p_category text)
returns table (
  id uuid, title text, status issue_status, distance_m double precision,
  upvote_count int, confirmation_count int, created_at timestamptz,
  thumb_path text, thumb_type media_type
)
language sql stable security definer set search_path = public, extensions as $$
  select i.id, i.title, i.status, ST_Distance(i.location, make_point(p_lat, p_lng)),
         i.upvote_count, i.confirmation_count, i.created_at, m.storage_path, m.media_type
  from issues i
  cross join app_settings s
  left join lateral (
    select storage_path, media_type from issue_media
     where issue_id = i.id and kind = 'report' order by created_at limit 1
  ) m on true
  where s.id = 1
    and (p_category is null or i.category = p_category)
    and i.status not in ('closed', 'hidden', 'expired')
    and i.created_at > now() - make_interval(days => s.duplicate_window_days)
    and ST_DWithin(i.location, make_point(p_lat, p_lng), s.duplicate_radius_m)
  order by 4
  limit 5
$$;

-- The route starts as the category's usual fixer (volunteers or the City
-- Corporation). An admin can change it later (admin_set_route).
drop function if exists create_issue(text, text, text, double precision, double precision, real, text, text, boolean, jsonb, boolean);
create function create_issue(
  p_title text,
  p_description text,
  p_category text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m real,
  p_location_source text,
  p_address text,
  p_is_anonymous boolean,
  p_media jsonb,
  p_skip_duplicate_check boolean default false,
  p_size text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  c categories;
  v_id uuid;
  v_event bigint;
begin
  select * into s from app_settings where id = 1;

  if (select count(*) from issues where reporter_id = v_user and created_at > now() - interval '24 hours')
     >= s.max_reports_per_day then
    raise exception 'You have reached the daily limit of % reports', s.max_reports_per_day using hint = 'RATE_LIMIT';
  end if;
  if p_size is not null and p_size not in ('small', 'medium', 'large') then
    raise exception 'Size must be small, medium or large' using hint = 'BAD_SIZE';
  end if;
  select * into c from categories where slug = p_category and is_active;
  if not found then
    raise exception 'Unknown category' using hint = 'BAD_CATEGORY';
  end if;

  perform assert_in_service_area(p_lat, p_lng);
  if p_location_source not in ('gps', 'manual') then
    raise exception 'Invalid location source' using hint = 'BAD_LOCATION';
  end if;
  if p_location_source = 'gps' and (p_accuracy_m is null or p_accuracy_m > s.max_gps_accuracy_m) then
    raise exception 'GPS accuracy is too low (±% m). Drag the pin to the exact spot instead.',
      coalesce(round(p_accuracy_m)::text, '?') using hint = 'LOW_GPS_ACCURACY';
  end if;

  if not p_skip_duplicate_check
     and exists (select 1 from find_nearby_duplicates(p_lat, p_lng, c.slug)) then
    raise exception 'A similar open issue already exists nearby' using hint = 'DUPLICATE_FOUND';
  end if;

  insert into issues (reporter_id, title, description, category, severity, base_severity, size,
                      location, location_accuracy_m, location_source, address, is_anonymous,
                      route, route_source)
  values (v_user, trim(p_title), coalesce(trim(p_description), ''), c.slug, c.default_severity, c.default_severity, p_size,
          make_point(p_lat, p_lng), p_accuracy_m, p_location_source,
          coalesce(trim(p_address), ''), coalesce(p_is_anonymous, false),
          c.resolver::text::issue_route, 'category')
  returning id into v_id;

  v_event := log_event(v_id, v_user, 'created', null, null);
  perform attach_media(v_id, v_user, 'report', p_media, v_event, 1, false);

  insert into follows (issue_id, user_id) values (v_id, v_user);
  update issues set follower_count = 1 where id = v_id;
  update profiles set reports_count = reports_count + 1 where id = v_user;

  perform recompute_issue(v_id);
  return v_id;
end $$;

-- Reporter may edit only while the community is still reviewing. The route
-- stays as decided; changing the category doesn't move the issue.
create or replace function update_issue(
  p_issue uuid, p_title text, p_description text, p_category text, p_address text
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue for update;
  if not found or i.reporter_id <> v_user then
    raise exception 'You can only edit your own reports' using hint = 'FORBIDDEN';
  end if;
  if i.status <> 'community_review' then
    raise exception 'Reports can only be edited before they are validated' using hint = 'LOCKED';
  end if;
  if p_category is not null and not exists (select 1 from categories where slug = p_category and is_active) then
    raise exception 'Unknown category' using hint = 'BAD_CATEGORY';
  end if;

  update issues
     set title = trim(p_title), description = coalesce(trim(p_description), ''),
         category = coalesce(p_category, category), address = coalesce(trim(p_address), ''), updated_at = now()
   where id = p_issue;
  perform log_event(p_issue, v_user, 'edited', null, null);
  perform recompute_issue(p_issue);
end $$;

create or replace function flag_issue(p_issue uuid, p_reason flag_reason, p_details text default '')
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.reporter_id = v_user then
    raise exception 'You can''t flag your own report' using hint = 'OWN_ISSUE';
  end if;
  if i.status not in ('community_review', 'validated', 'escalated', 'hidden') then
    raise exception 'This issue can no longer be flagged' using hint = 'LOCKED';
  end if;

  insert into flags (issue_id, user_id, reason, details, weight)
  values (p_issue, v_user, p_reason, coalesce(trim(p_details), ''), voter_weight(v_user, i.location, null))
  on conflict (issue_id, user_id) do update set reason = excluded.reason, details = excluded.details;

  perform notify(i.reporter_id, 'issue_flagged', p_issue, null,
    format('Someone flagged your report "%s" as %s.', i.title, replace(p_reason::text, '_', ' ')));
  perform recompute_issue(p_issue);
end $$;

-- ---------- Tasks: volunteers, teams and officials ------------------

create or replace function is_team_member(p_assignment bigint, p_user uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from assignment_members
                  where assignment_id = p_assignment and user_id = p_user and left_at is null)
$$;

create or replace function set_volunteer_mode(p_on boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  v_min int;
begin
  if p_on then
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

-- Volunteers take community issues (alone or as a team leader); officials take
-- escalated issues of their own City Corporation. The UPDATE only succeeds
-- while the issue is still free, so two people can't both win.
drop function if exists accept_task(uuid);
create function accept_task(p_issue uuid, p_team_size int default 1) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  p profiles;
  v_rows int;
  v_assignment bigint;
  v_role text;
  v_lock_until timestamptz;
  v_team int := greatest(coalesce(p_team_size, 1), 1);
  v_who text;
begin
  select * into s from app_settings where id = 1;
  select * into p from profiles where id = v_user;
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.reporter_id = v_user then
    raise exception 'You can''t take a task you reported yourself' using hint = 'OWN_ISSUE';
  end if;

  if i.route = 'authority' then
    if official_authority(v_user) is distinct from i.authority_id or i.authority_id is null then
      raise exception 'Only officials of % can take this issue',
        coalesce((select short_name from authorities where id = i.authority_id), 'the City Corporation')
        using hint = 'NOT_OFFICIAL';
    end if;
    v_role := 'official';
    v_team := 1;
    v_lock_until := null;  -- officials work to the City Corporation's target time instead
    update issues
       set volunteer_id = v_user, status = 'assigned', assigned_at = now(),
           lock_expires_at = null, lock_reminder_sent = false, updated_at = now()
     where id = p_issue and status = 'escalated' and volunteer_id is null;
  else
    if i.route = 'pending' then
      raise exception 'An admin is still deciding who should fix this' using hint = 'ROUTE_PENDING';
    end if;
    if not p.is_volunteer then
      raise exception 'Turn on volunteer mode first' using hint = 'NOT_VOLUNTEER';
    end if;
    if (select count(*) from assignments where volunteer_id = v_user and outcome = 'active') >= s.max_active_tasks then
      raise exception 'You can lead at most % active tasks', s.max_active_tasks using hint = 'TOO_MANY_TASKS';
    end if;
    if exists (select 1 from assignments where issue_id = p_issue and volunteer_id = v_user
                and outcome in ('expired', 'reopened')) then
      raise exception 'You already had this task and it was not completed; another volunteer should try' using hint = 'PREVIOUSLY_FAILED';
    end if;
    if exists (select 1 from review_items where issue_id = p_issue and kind = 'escalation_request'
                and requested_by = v_user and created_at > now() - make_interval(days => s.escalation_retake_days)) then
      raise exception 'You recently asked for this to go to the City Corporation. Let another volunteer try first.'
        using hint = 'RECENTLY_ESCALATED';
    end if;
    if v_team > 50 then
      raise exception 'A team can have at most 50 people' using hint = 'BAD_TEAM_SIZE';
    end if;
    if v_team > 1 and (p.tasks_completed < s.team_lead_min_tasks or p.reputation <= 0) then
      raise exception 'To lead a team you need at least % completed task and positive reputation. You can still join a team.',
        s.team_lead_min_tasks using hint = 'CANT_LEAD_TEAM';
    end if;
    v_role := 'volunteer';
    v_lock_until := now() + make_interval(hours => case when v_team > 1 then s.team_lock_hours else s.lock_hours end);
    update issues
       set volunteer_id = v_user, status = 'assigned', assigned_at = now(),
           lock_expires_at = v_lock_until, lock_reminder_sent = false, updated_at = now()
     where id = p_issue and status = 'validated' and route = 'community' and volunteer_id is null;
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'This task is no longer available — someone else may have taken it' using hint = 'TASK_TAKEN';
  end if;

  insert into assignments (issue_id, volunteer_id, role, team_size)
  values (p_issue, v_user, v_role, v_team) returning id into v_assignment;
  update issues set assignment_id = v_assignment where id = p_issue;
  insert into follows (issue_id, user_id) values (p_issue, v_user) on conflict do nothing;

  perform log_event(p_issue, v_user, 'assigned', null,
    jsonb_build_object('lock_expires_at', v_lock_until, 'team_size', v_team, 'role', v_role));
  v_who := case when v_role = 'official' then (select short_name from authorities where id = i.authority_id)
                else 'A volunteer' end;
  perform notify_audience(p_issue, 'task_accepted', v_user, format('%s accepted "%s".', v_who, i.title));
  if v_team > 1 then
    perform notify_nearby_volunteers(p_issue, s.request_help_radius_m, 'team_recruiting', v_user,
      format('A team near you needs %s more people for "%s".', v_team - 1, i.title));
  end if;
end $$;

create or replace function join_team(p_issue uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
  a assignments;
  v_members int;
begin
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  select * into a from assignments where id = i.assignment_id;
  if i.status not in ('assigned', 'in_progress') or a.id is null or a.team_size <= 1 then
    raise exception 'This task has no team to join' using hint = 'NO_TEAM';
  end if;
  if not (select is_volunteer from profiles where id = v_user) then
    raise exception 'Turn on volunteer mode first' using hint = 'NOT_VOLUNTEER';
  end if;
  if i.reporter_id = v_user then
    raise exception 'You can''t join a task you reported yourself' using hint = 'OWN_ISSUE';
  end if;
  if a.volunteer_id = v_user or is_team_member(a.id, v_user) then
    raise exception 'You are already in this team' using hint = 'ALREADY_IN_TEAM';
  end if;
  select count(*) into v_members from assignment_members where assignment_id = a.id and left_at is null;
  if v_members + 1 >= a.team_size then
    raise exception 'This team is full' using hint = 'TEAM_FULL';
  end if;

  insert into assignment_members (assignment_id, user_id) values (a.id, v_user)
  on conflict (assignment_id, user_id) do update set left_at = null, joined_at = now(), checked_in_at = null;
  insert into follows (issue_id, user_id) values (p_issue, v_user) on conflict do nothing;
  update issues set follower_count = (select count(*) from follows where issue_id = p_issue) where id = p_issue;

  perform log_event(p_issue, v_user, 'team_joined', null, null);
  perform notify(a.volunteer_id, 'team_joined', p_issue, v_user,
    format('Someone joined your team for "%s" (%s/%s).', i.title, v_members + 2, a.team_size));
end $$;

-- Leaving costs nothing.
create or replace function leave_team(p_issue uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue;
  update assignment_members set left_at = now()
   where assignment_id = i.assignment_id and user_id = v_user and left_at is null;
  if not found then raise exception 'You are not in this team' using hint = 'NOT_IN_TEAM'; end if;
  update assignments set lead_offer_to = null where id = i.assignment_id and lead_offer_to = v_user;
  perform log_event(p_issue, v_user, 'team_left', null, null);
end $$;

-- "I'm here": proves a member came. Only checked-in members are rewarded.
create or replace function check_in(p_issue uuid, p_lat double precision, p_lng double precision, p_accuracy_m real)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_dist double precision;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue;
  if not found or i.status not in ('assigned', 'in_progress') or not is_team_member(i.assignment_id, v_user) then
    raise exception 'You are not in this team' using hint = 'NOT_IN_TEAM';
  end if;
  if make_point(p_lat, p_lng) is null then
    raise exception 'Your location is needed to check in' using hint = 'LOCATION_REQUIRED';
  end if;
  v_dist := ST_Distance(make_point(p_lat, p_lng), i.location);
  if v_dist > s.resolution_radius_m + least(coalesce(p_accuracy_m, 0), 100) then
    raise exception 'You must be at the site (within % m) to check in. You are % m away.',
      s.resolution_radius_m, round(v_dist) using hint = 'TOO_FAR';
  end if;
  update assignment_members set checked_in_at = now(), check_in_distance_m = v_dist
   where assignment_id = i.assignment_id and user_id = v_user;
  perform log_event(p_issue, v_user, 'checked_in', null, jsonb_build_object('distance_m', round(v_dist)));
end $$;

-- Friendly hand-over: the leader offers, the member accepts.
create or replace function offer_lead(p_issue uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue;
  if not found or i.volunteer_id is distinct from v_user or i.status not in ('assigned', 'in_progress') then
    raise exception 'Only the team leader can hand over' using hint = 'FORBIDDEN';
  end if;
  if not is_team_member(i.assignment_id, p_member) then
    raise exception 'That person is not in your team' using hint = 'NOT_IN_TEAM';
  end if;
  update assignments set lead_offer_to = p_member where id = i.assignment_id;
  perform notify(p_member, 'lead_offered', p_issue, v_user,
    format('You were asked to lead the team for "%s". Open the issue to accept.', i.title));
end $$;

-- A member becomes leader: either the leader offered it, or the leader went
-- inactive (lead_offer_open). An inactive leader still gets the expired-lock penalty.
create or replace function accept_lead(p_issue uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  a assignments;
  v_friendly boolean;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found or i.status not in ('assigned', 'in_progress') then
    raise exception 'This task is not active' using hint = 'LOCKED';
  end if;
  select * into a from assignments where id = i.assignment_id for update;
  if not is_team_member(a.id, v_user) then
    raise exception 'You are not in this team' using hint = 'NOT_IN_TEAM';
  end if;
  if a.lead_offer_to = v_user then
    v_friendly := true;
  elsif a.lead_offer_open then
    v_friendly := false;
  else
    raise exception 'Nobody has offered you the lead' using hint = 'NO_LEAD_OFFER';
  end if;
  if (select count(*) from assignments where volunteer_id = v_user and outcome = 'active') >= s.max_active_tasks then
    raise exception 'You can lead at most % active tasks', s.max_active_tasks using hint = 'TOO_MANY_TASKS';
  end if;

  update assignments set volunteer_id = v_user, lead_offer_to = null, lead_offer_open = false where id = a.id;
  update assignment_members set left_at = now() where assignment_id = a.id and user_id = v_user;
  update issues
     set volunteer_id = v_user, lock_expires_at = now() + make_interval(hours => s.team_lock_hours),
         lock_reminder_sent = false, updated_at = now()
   where id = p_issue;

  if v_friendly then
    -- the old leader stays on the team as a member
    insert into assignment_members (assignment_id, user_id) values (a.id, a.volunteer_id)
    on conflict (assignment_id, user_id) do update set left_at = null;
  else
    update profiles set reputation = reputation + s.rep_task_expired, tasks_expired = tasks_expired + 1
     where id = a.volunteer_id;
    perform notify(a.volunteer_id, 'lead_taken_over', p_issue, null,
      format('You were inactive, so a team member took over "%s" (%s reputation).', i.title, s.rep_task_expired));
  end if;

  perform log_event(p_issue, v_user, 'lead_changed', null,
    jsonb_build_object('from', a.volunteer_id, 'friendly', v_friendly));
  perform notify_audience(p_issue, 'lead_changed', v_user, format('"%s" has a new team leader.', i.title));
end $$;

-- Release reasons:
--   busy             back to the pool (or to the team), no penalty
--   needs_authority  note + on-site photo, admin decides, no reward or penalty
--   wrong_issue      already fixed / fake / wrong location, note + photo, admin decides
drop function if exists release_task(uuid, text);
create function release_task(
  p_issue uuid, p_reason text default '', p_kind text default 'busy',
  p_media jsonb default '[]', p_wrong_type text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  a assignments;
  v_next uuid;
  v_event bigint;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found or i.volunteer_id is distinct from v_user or i.status not in ('assigned', 'in_progress') then
    raise exception 'This is not your active task' using hint = 'FORBIDDEN';
  end if;
  select * into a from assignments where id = i.assignment_id;
  if p_kind not in ('busy', 'needs_authority', 'wrong_issue') then
    raise exception 'Unknown release reason' using hint = 'BAD_KIND';
  end if;
  if a.role = 'official' and p_kind = 'needs_authority' then
    raise exception 'This issue is already with the City Corporation' using hint = 'BAD_KIND';
  end if;

  if p_kind <> 'busy' then
    if char_length(coalesce(trim(p_reason), '')) < 10 then
      raise exception 'Explain what you found (at least 10 characters)' using hint = 'NOTE_REQUIRED';
    end if;
    if p_kind = 'wrong_issue' and coalesce(p_wrong_type, '') not in ('already_fixed', 'fake', 'wrong_location') then
      raise exception 'Say whether it is already fixed, fake or at the wrong location' using hint = 'BAD_KIND';
    end if;
    perform end_assignment(p_issue, 'released');
    v_event := log_event(p_issue, v_user,
      case p_kind when 'needs_authority' then 'escalation_requested' else 'reported_wrong' end,
      trim(p_reason), jsonb_build_object('wrong_type', p_wrong_type));
    perform attach_media(p_issue, v_user, 'progress', p_media, v_event, 1, true);
    update issues
       set status = 'under_review', volunteer_id = null, assignment_id = null, assigned_at = null,
           lock_expires_at = null, lock_reminder_sent = false, updated_at = now()
     where id = p_issue;
    perform open_review(p_issue,
      case p_kind when 'needs_authority' then 'escalation_request' else 'wrong_issue' end::review_kind,
      v_user, p_reason, jsonb_build_object('wrong_type', p_wrong_type, 'event', v_event));
    perform notify_audience(p_issue, 'under_review', v_user,
      case p_kind when 'needs_authority'
        then format('A volunteer says "%s" needs the City Corporation. An admin will decide.', i.title)
        else format('A volunteer says "%s" may be %s. An admin will check.', i.title, replace(p_wrong_type, '_', ' ')) end);
    return;
  end if;

  -- Busy: a team keeps the task, the longest-serving member becomes leader.
  if a.team_size > 1 then
    select user_id into v_next from assignment_members
     where assignment_id = a.id and left_at is null order by joined_at limit 1;
  end if;
  if v_next is not null then
    update assignments set volunteer_id = v_next, lead_offer_to = null, lead_offer_open = false where id = a.id;
    update assignment_members set left_at = now() where assignment_id = a.id and user_id = v_next;
    update issues
       set volunteer_id = v_next, lock_expires_at = now() + make_interval(hours => s.team_lock_hours),
           lock_reminder_sent = false, updated_at = now()
     where id = p_issue;
    perform log_event(p_issue, v_user, 'released', nullif(trim(p_reason), ''), jsonb_build_object('new_leader', v_next));
    perform notify(v_next, 'lead_changed', p_issue, v_user,
      format('The leader released "%s". You now lead the team. You can release it too if you can''t continue.', i.title));
    return;
  end if;

  perform end_assignment(p_issue, 'released');
  perform return_to_pool(p_issue);
  perform log_event(p_issue, v_user, 'released', nullif(trim(p_reason), ''), null);
  perform notify_audience(p_issue, 'task_released', v_user,
    case when a.role = 'official'
      then format('The official released "%s". It is back with %s.', i.title,
                  (select short_name from authorities where id = i.authority_id))
      else format('The volunteer released "%s". It is open for other volunteers again.', i.title) end);
end $$;

-- Volunteer or official must be at the spot (GPS) with at least one "after" photo.
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
  if v_here is null then
    raise exception 'Your location is needed to submit a resolution' using hint = 'LOCATION_REQUIRED';
  end if;
  v_dist := ST_Distance(v_here, i.location);
  if v_dist > s.resolution_radius_m + least(coalesce(p_accuracy_m, 0), 100) then
    raise exception 'You must be at the issue location (within % m) to submit the fix. You are % m away.',
      s.resolution_radius_m, round(v_dist) using hint = 'TOO_FAR';
  end if;

  update issues
     set status = 'resolution_submitted', resolution_note = trim(p_note),
         resolution_submitted_at = now(), lock_expires_at = null, updated_at = now()
   where id = p_issue;

  v_event := log_event(p_issue, v_user, 'resolution_submitted', trim(p_note),
                       jsonb_build_object('distance_m', round(v_dist)));
  perform attach_media(p_issue, v_user, 'resolution', p_media, v_event, 1, true);
  perform notify_audience(p_issue, 'resolution_submitted', v_user,
    format('%s says "%s" is fixed. Is it? Please confirm.',
           case when i.route = 'authority' then coalesce((select short_name from authorities where id = i.authority_id), 'The City Corporation')
                else 'The volunteer' end, i.title));
end $$;

-- Volunteers: leader +10, every checked-in member +10. Officials: no points;
-- it shows in the City Corporation's public record instead.
create or replace function close_issue(p_issue uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  i issues;
  a assignments;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  select * into a from assignments where id = i.assignment_id;

  update issues set status = 'closed', closed_at = now(), updated_at = now() where id = p_issue;
  perform end_assignment(p_issue, 'completed');

  if coalesce(a.role, 'volunteer') = 'volunteer' then
    update profiles
       set reputation = reputation + s.rep_task_completed, tasks_completed = tasks_completed + 1
     where id = i.volunteer_id;
    perform notify(i.volunteer_id, 'task_completed', p_issue, null,
      format('"%s" is confirmed fixed. +%s reputation!', i.title, s.rep_task_completed));

    update profiles p
       set reputation = reputation + s.rep_task_completed, tasks_completed = tasks_completed + 1
      from assignment_members m
     where m.assignment_id = a.id and m.user_id = p.id and m.left_at is null and m.checked_in_at is not null;
    insert into notifications (user_id, type, issue_id, message)
    select m.user_id, 'task_completed', p_issue,
           format('"%s" is confirmed fixed. Thanks for showing up! +%s reputation.', i.title, s.rep_task_completed)
      from assignment_members m
     where m.assignment_id = a.id and m.left_at is null and m.checked_in_at is not null;

    perform notify(i.reporter_id, 'rate_volunteer', p_issue, null,
      format('"%s" is closed. Please rate the volunteer.', i.title));
  else
    perform notify(i.volunteer_id, 'task_completed', p_issue, null,
      format('"%s" is confirmed fixed by the community.', i.title));
  end if;

  perform log_event(p_issue, null, 'closed', null, jsonb_build_object('reason', p_reason));
  perform notify_audience(p_issue, 'issue_closed', i.volunteer_id,
    format('"%s" has been resolved and closed.', i.title));
end $$;

-- A rejected fix: volunteer leader −15 (members 0); officials no points, back
-- to the same City Corporation.
create or replace function reopen_issue(p_issue uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  i issues;
  a assignments;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  select * into a from assignments where id = i.assignment_id;

  perform end_assignment(p_issue, 'reopened');
  if coalesce(a.role, 'volunteer') = 'volunteer' then
    update profiles
       set reputation = reputation + s.rep_task_reopened, tasks_reopened = tasks_reopened + 1
     where id = i.volunteer_id;
    perform notify(i.volunteer_id, 'resolution_disputed', p_issue, null,
      format('Your fix for "%s" was disputed and the issue was reopened (%s reputation).', i.title, s.rep_task_reopened));
  else
    perform notify(i.volunteer_id, 'resolution_disputed', p_issue, null,
      format('Your fix for "%s" was disputed. It is back with your City Corporation.', i.title));
  end if;
  perform return_to_pool(p_issue);

  perform log_event(p_issue, null, 'reopened', null,
    jsonb_build_object('reason', p_reason, 'previous_volunteer', i.volunteer_id));
  perform notify_audience(p_issue, 'issue_reopened', i.volunteer_id,
    format('"%s" was reopened — the problem is not fixed yet.', i.title));
end $$;

-- Same rules as 0002, plus: team members and the City Corporation's own
-- officials can't judge their own fix.
create or replace function review_resolution(
  p_issue uuid, p_is_fixed boolean, p_lat double precision default null, p_lng double precision default null
) returns issue_status
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_is_reporter boolean;
  v_home geography;
  v_fixed int;
  v_not_fixed int;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.status <> 'resolution_submitted' then
    raise exception 'There is no resolution waiting for confirmation' using hint = 'LOCKED';
  end if;
  if i.volunteer_id = v_user or is_team_member(i.assignment_id, v_user) then
    raise exception 'You can''t confirm your own fix' using hint = 'OWN_TASK';
  end if;
  if i.authority_id is not null and official_authority(v_user) = i.authority_id then
    raise exception 'Officials can''t confirm their own City Corporation''s fix' using hint = 'OWN_TASK';
  end if;

  v_is_reporter := i.reporter_id = v_user;
  if not v_is_reporter
     and not exists (select 1 from confirmations where issue_id = p_issue and user_id = v_user) then
    select home_location into v_home from user_settings where user_id = v_user;
    if coalesce(ST_DWithin(make_point(p_lat, p_lng), i.location, s.reviewer_radius_m), false) = false
       and coalesce(ST_DWithin(v_home, i.location, s.reviewer_radius_m), false) = false then
      raise exception 'Only the reporter or people near this issue can confirm the fix' using hint = 'NOT_NEARBY';
    end if;
  end if;

  insert into resolution_reviews (issue_id, assignment_id, user_id, is_fixed)
  values (p_issue, i.assignment_id, v_user, p_is_fixed)
  on conflict (assignment_id, user_id) do update set is_fixed = excluded.is_fixed, created_at = now();

  perform log_event(p_issue, case when v_is_reporter and i.is_anonymous then null else v_user end,
    'resolution_review', null, jsonb_build_object('is_fixed', p_is_fixed, 'by_reporter', v_is_reporter));

  if v_is_reporter then
    if p_is_fixed then perform close_issue(p_issue, 'reporter_confirmed');
    else perform reopen_issue(p_issue, 'reporter_disputed'); end if;
  else
    select count(*) filter (where r.is_fixed), count(*) filter (where not r.is_fixed)
      into v_fixed, v_not_fixed
      from resolution_reviews r
     where r.assignment_id = i.assignment_id and r.user_id <> i.reporter_id;
    if v_fixed >= s.resolution_quorum then perform close_issue(p_issue, 'community_confirmed');
    elsif v_not_fixed >= s.resolution_quorum then perform reopen_issue(p_issue, 'community_disputed');
    end if;
  end if;

  return (select status from issues where id = p_issue);
end $$;

-- City Corporations are not rated with stars; their record is facts only.
create or replace function rate_volunteer(p_issue uuid, p_stars int, p_review text default '') returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue;
  if not found or i.reporter_id <> v_user then
    raise exception 'Only the reporter can rate the volunteer' using hint = 'FORBIDDEN';
  end if;
  if i.status <> 'closed' or i.assignment_id is null then
    raise exception 'You can rate once the issue is closed' using hint = 'LOCKED';
  end if;
  if (select role from assignments where id = i.assignment_id) = 'official' then
    raise exception 'City Corporation work is not rated with stars' using hint = 'NOT_RATEABLE';
  end if;
  if p_stars not between 1 and 5 then
    raise exception 'Rating must be 1 to 5 stars' using hint = 'BAD_RATING';
  end if;
  if exists (select 1 from ratings where assignment_id = i.assignment_id) then
    raise exception 'You already rated this volunteer' using hint = 'ALREADY_RATED';
  end if;

  insert into ratings (issue_id, assignment_id, volunteer_id, rater_id, stars, review)
  values (p_issue, i.assignment_id, i.volunteer_id, v_user, p_stars, coalesce(trim(p_review), ''));
  update profiles
     set rating_sum = rating_sum + p_stars, rating_count = rating_count + 1,
         reputation = reputation + (p_stars - 3) * s.rep_per_star
   where id = i.volunteer_id;
  perform notify(i.volunteer_id, 'rated', p_issue, case when i.is_anonymous then null else v_user end,
    format('You received %s★ for "%s".', p_stars, i.title));
end $$;

-- Hotline follow-up: the complaint reference number, visible to everyone.
create or replace function set_complaint_ref(p_issue uuid, p_ref text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue for update;
  if not found or i.route <> 'authority' or i.status not in ('escalated', 'assigned', 'in_progress', 'resolution_submitted') then
    raise exception 'Only open City Corporation issues have a complaint reference' using hint = 'LOCKED';
  end if;
  if not ((select is_volunteer from profiles where id = v_user)
          or official_authority(v_user) = i.authority_id or is_admin(v_user)) then
    raise exception 'Only volunteers can record the complaint reference' using hint = 'NOT_VOLUNTEER';
  end if;
  if char_length(coalesce(trim(p_ref), '')) not between 2 and 120 then
    raise exception 'Enter the reference number you got from the hotline' using hint = 'NOTE_REQUIRED';
  end if;
  update issues set complaint_ref = trim(p_ref), updated_at = now() where id = p_issue;
  perform log_event(p_issue, v_user, 'complaint_ref', trim(p_ref), null);
end $$;

-- An official says volunteers can handle it. The admin decides.
create or replace function request_send_back(p_issue uuid, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue;
  if not found or i.authority_id is null or official_authority(v_user) is distinct from i.authority_id then
    raise exception 'Only officials of this City Corporation can ask for this' using hint = 'NOT_OFFICIAL';
  end if;
  if i.status not in ('escalated', 'assigned', 'in_progress') then
    raise exception 'This issue can''t be sent back now' using hint = 'LOCKED';
  end if;
  if char_length(coalesce(trim(p_note), '')) < 10 then
    raise exception 'Explain why volunteers can handle it (at least 10 characters)' using hint = 'NOTE_REQUIRED';
  end if;
  perform open_review(p_issue, 'send_back', v_user, p_note, null);
  perform log_event(p_issue, v_user, 'send_back_requested', trim(p_note), null);
end $$;

-- ---------- Admin: issues -------------------------------------------

-- Move an issue between volunteers and the City Corporation. Whoever is
-- working on it stops with no penalty; their notes and photos stay.
create or replace function admin_set_route(
  p_issue uuid, p_route issue_route, p_reason text,
  p_category text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  i issues;
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

  if i.status in ('assigned', 'in_progress', 'resolution_submitted') then
    perform end_assignment(p_issue, 'rerouted');
    perform notify(i.volunteer_id, 'rerouted', p_issue, v_admin,
      format('An admin moved "%s" (%s). Your task ended with no penalty.', i.title, v_reason));
  end if;

  update issues set route = p_route, route_source = 'admin', updated_at = now() where id = p_issue;

  if i.status <> 'community_review' then
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

-- "Needs City Corporation" request. Approve → escalated. Reject → back to the
-- volunteer pool. Neutral for the volunteer, except repeated rejections.
create or replace function admin_decide_escalation(p_issue uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  s app_settings;
  r review_items;
  v_rejections int;
  v_title text;
begin
  select * into s from app_settings where id = 1;
  select * into r from review_items where issue_id = p_issue and kind = 'escalation_request' and status = 'open';
  if not found then raise exception 'No open escalation request for this issue' using hint = 'NOT_FOUND'; end if;
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

-- "Issue is wrong": close (already fixed), hide (fake / wrong location), or
-- 'lie' when the volunteer's claim was false (−5, back to the pool).
create or replace function admin_decide_wrong_report(p_issue uuid, p_outcome text, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  s app_settings;
  r review_items;
  i issues;
begin
  select * into s from app_settings where id = 1;
  select * into r from review_items where issue_id = p_issue and kind = 'wrong_issue' and status = 'open';
  if not found then raise exception 'No open report for this issue' using hint = 'NOT_FOUND'; end if;
  select * into i from issues where id = p_issue for update;

  if p_outcome = 'close' then
    update issues set status = 'closed', closed_at = now(), updated_at = now() where id = p_issue;
    perform log_event(p_issue, v_admin, 'closed', v_reason, jsonb_build_object('reason', 'admin_already_fixed'));
    perform notify_audience(p_issue, 'issue_closed', v_admin, format('"%s" was closed: %s', i.title, v_reason));
  elsif p_outcome = 'hide' then
    update issues set status = 'hidden', status_before_hidden = 'validated', updated_at = now() where id = p_issue;
    perform log_event(p_issue, v_admin, 'hidden', v_reason, null);
    perform notify(i.reporter_id, 'issue_hidden', p_issue, null,
      format('Your report "%s" was hidden after an on-site check: %s', i.title, v_reason));
  elsif p_outcome = 'lie' then
    update issues set status = 'validated', updated_at = now() where id = p_issue;
    update profiles set reputation = reputation + s.rep_wrong_issue_lie where id = r.requested_by;
    perform log_event(p_issue, v_admin, 'wrong_report_rejected', v_reason, null);
    perform notify(r.requested_by, 'wrong_report_rejected', p_issue, v_admin,
      format('Your report that "%s" was wrong turned out to be false (%s reputation).', i.title, s.rep_wrong_issue_lie));
  else
    raise exception 'Choose close, hide or lie' using hint = 'BAD_KIND';
  end if;

  perform resolve_reviews(p_issue, array['wrong_issue']::review_kind[], v_admin, p_outcome, v_reason);
  perform log_admin(v_admin, 'wrong_report_' || p_outcome, p_issue, r.requested_by, v_reason, null);
end $$;

-- Close a review item without changing the issue (e.g. a "stuck" issue the
-- admin wants to leave with volunteers, or a rejected send-back request).
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
  update review_items
     set status = 'resolved', resolved_by = v_admin, resolved_at = now(), decision = 'dismissed', decision_note = v_reason
   where id = p_review;
  perform log_admin(v_admin, 'dismiss_review', r.issue_id, r.requested_by, v_reason, jsonb_build_object('kind', r.kind));
  if r.kind = 'send_back' then
    perform notify(r.requested_by, 'send_back_rejected', r.issue_id, v_admin,
      format('Your request to send the issue to volunteers was not approved: %s', v_reason));
  end if;
end $$;

-- Remove an inactive volunteer early. Counts as an expired lock (−5).
-- Officials are simply released back to their City Corporation.
create or replace function admin_remove_assignee(p_issue uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
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

-- The admin can't assign a task; it can only ask nearby volunteers.
create or replace function admin_request_help(p_issue uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
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
  v_admin uuid := require_admin();
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

-- ---------- Roles ---------------------------------------------------

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
  select short_name into v_name from authorities where id = p_authority and is_active;
  if v_name is null then raise exception 'Unknown City Corporation' using hint = 'NOT_FOUND'; end if;
  if exists (select 1 from role_requests where user_id = v_user and status = 'pending') then
    raise exception 'You already have a pending request' using hint = 'ALREADY_REQUESTED';
  end if;
  insert into role_requests (user_id, authority_id, designation, office, message)
  values (v_user, p_authority, trim(p_designation), coalesce(trim(p_office), ''), coalesce(trim(p_message), ''));
  perform notify_admins('role_request', null, v_user, format('Someone asked to be verified as a %s official.', v_name));
end $$;

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

create or replace function admin_grant_admin(p_username text, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  v_target uuid;
begin
  select id into v_target from profiles where username = lower(trim(p_username));
  if v_target is null then raise exception 'No user with that username' using hint = 'NOT_FOUND'; end if;
  insert into user_roles (user_id, role, granted_by) values (v_target, 'admin', v_admin)
  on conflict do nothing;
  perform notify(v_target, 'role_approved', null, v_admin, 'You are now an admin of AmarShohor.');
  perform log_admin(v_admin, 'grant_admin', null, v_target, v_reason, null);
end $$;

-- Removing an official hands their open tasks back to the City Corporation.
create or replace function admin_revoke_role(p_username text, p_role app_role, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  v_target uuid;
  t record;
begin
  select id into v_target from profiles where username = lower(trim(p_username));
  if v_target is null then raise exception 'No user with that username' using hint = 'NOT_FOUND'; end if;
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
  end if;
  perform notify(v_target, 'role_removed', null, v_admin, format('Your %s role was removed: %s', p_role, v_reason));
  perform log_admin(v_admin, 'revoke_' || p_role, null, v_target, v_reason, null);
end $$;

-- ---------- Admin: setup --------------------------------------------

-- p_area: a GeoJSON Polygon or MultiPolygon drawn on the admin map.
create or replace function admin_save_authority(
  p_id uuid, p_name text, p_short_name text, p_area jsonb,
  p_hotline text, p_complaint_url text, p_emergency_contacts jsonb,
  p_due_critical int, p_due_high int, p_due_medium int, p_due_low int, p_is_active boolean
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_geom geometry;
  v_id uuid;
begin
  begin
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_area::text), 4326);
  exception when others then
    raise exception 'The service area is not a valid map shape' using hint = 'BAD_AREA';
  end;
  if GeometryType(v_geom) not in ('POLYGON', 'MULTIPOLYGON') or not ST_IsValid(v_geom) then
    raise exception 'Draw the service area as a closed shape that doesn''t cross itself' using hint = 'BAD_AREA';
  end if;
  if jsonb_typeof(coalesce(p_emergency_contacts, '[]')) <> 'array' then
    raise exception 'Emergency contacts must be a list' using hint = 'BAD_CONTACTS';
  end if;

  if p_id is null then
    insert into authorities (name, short_name, area, hotline, complaint_url, emergency_contacts,
                             due_days_critical, due_days_high, due_days_medium, due_days_low, is_active)
    values (trim(p_name), upper(trim(p_short_name)), ST_Multi(v_geom)::geography, coalesce(trim(p_hotline), ''),
            coalesce(trim(p_complaint_url), ''), coalesce(p_emergency_contacts, '[]'),
            p_due_critical, p_due_high, p_due_medium, p_due_low, coalesce(p_is_active, true))
    returning id into v_id;
  else
    update authorities
       set name = trim(p_name), short_name = upper(trim(p_short_name)), area = ST_Multi(v_geom)::geography,
           hotline = coalesce(trim(p_hotline), ''), complaint_url = coalesce(trim(p_complaint_url), ''),
           emergency_contacts = coalesce(p_emergency_contacts, '[]'),
           due_days_critical = p_due_critical, due_days_high = p_due_high,
           due_days_medium = p_due_medium, due_days_low = p_due_low, is_active = coalesce(p_is_active, true)
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'City Corporation not found' using hint = 'NOT_FOUND'; end if;
  end if;
  perform log_admin(v_admin, 'save_authority', null, null, 'Updated City Corporation setup',
    jsonb_build_object('authority', upper(trim(p_short_name))));
  return v_id;
end $$;

create or replace function slugify(p text) returns text
language sql immutable as $$
  select left(trim(both '_' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '_', 'g')), 40)
$$;

create or replace function admin_save_category(
  p_slug text, p_name text, p_name_bn text, p_icon text, p_color text,
  p_resolver resolver_type, p_default_severity severity_level, p_sort_order int, p_is_active boolean
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_slug text := coalesce(nullif(p_slug, ''), slugify(p_name));
begin
  if char_length(coalesce(trim(p_name), '')) < 2 then
    raise exception 'Give the category a name' using hint = 'BAD_CATEGORY';
  end if;
  if v_slug = '' then v_slug := 'category_' || floor(random() * 100000)::int; end if;
  if p_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Colour must look like #1a2b3c' using hint = 'BAD_COLOR';
  end if;
  insert into categories (slug, name, name_bn, icon, color, resolver, default_severity, sort_order, is_active)
  values (v_slug, trim(p_name), coalesce(trim(p_name_bn), ''), coalesce(nullif(p_icon, ''), 'circle-help'), p_color,
          p_resolver, p_default_severity, coalesce(p_sort_order, 0), coalesce(p_is_active, true))
  on conflict (slug) do update
    set name = excluded.name, name_bn = excluded.name_bn, icon = excluded.icon, color = excluded.color,
        resolver = excluded.resolver, default_severity = excluded.default_severity,
        sort_order = excluded.sort_order, is_active = excluded.is_active;
  perform log_admin(v_admin, 'save_category', null, null, 'Updated category', jsonb_build_object('slug', v_slug));
  return v_slug;
end $$;

-- p_changes: {"lock_hours": 96, "team_lock_hours": 120, ...}
create or replace function admin_update_settings(p_changes jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  k text;
  v jsonb;
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
    execute format('update app_settings set %I = $1::%s where id = 1', k, v_type) using v #>> '{}';
  end loop;
  perform log_admin(v_admin, 'update_settings', null, null, 'Changed settings', p_changes);
end $$;

-- ---------- Emergency alerts ----------------------------------------

create or replace function emergency_label(p emergency_kind) returns text
language sql immutable as $$
  select case p when 'fire' then 'Fire' when 'gas_leak' then 'Gas leak' when 'building_collapse' then 'Building collapse'
                when 'live_wire' then 'Live electric wire' when 'flood_rescue' then 'People trapped by flooding'
                else 'Emergency' end
$$;

-- Published at once (no validation wait). The reporter is shown 999 first;
-- this only warns people nearby.
create or replace function create_emergency_alert(
  p_kind emergency_kind, p_note text, p_lat double precision, p_lng double precision,
  p_address text, p_media jsonb default '[]'
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  m record;
  v_radius int;
  v_id uuid;
  v_where text;
begin
  select * into s from app_settings where id = 1;
  if (select count(*) from emergency_alerts where reporter_id = v_user and created_at > now() - interval '24 hours')
     >= s.emergency_max_per_day then
    raise exception 'You can raise at most % emergency alerts a day. Call 999.', s.emergency_max_per_day using hint = 'RATE_LIMIT';
  end if;
  perform assert_in_service_area(p_lat, p_lng);
  if jsonb_array_length(coalesce(p_media, '[]')) > 3 then
    raise exception 'You can attach up to 3 files' using hint = 'BAD_MEDIA';
  end if;
  for m in select * from jsonb_to_recordset(coalesce(p_media, '[]'::jsonb)) as x(path text, type text) loop
    if m.path is null or position(v_user::text || '/' in m.path) <> 1 or m.type not in ('image', 'video') then
      raise exception 'Invalid media file' using hint = 'BAD_MEDIA';
    end if;
  end loop;

  -- Brand-new accounts warn a smaller area until someone confirms.
  v_radius := case when (select created_at from profiles where id = v_user) > now() - make_interval(hours => s.new_account_hours)
                   then s.emergency_new_account_radius_m else s.emergency_radius_m end;

  insert into emergency_alerts (reporter_id, kind, note, location, address, media, notify_radius_m, expires_at)
  values (v_user, p_kind, coalesce(trim(p_note), ''), make_point(p_lat, p_lng), coalesce(trim(p_address), ''),
          coalesce(p_media, '[]'), v_radius, now() + make_interval(hours => s.emergency_hours))
  returning id into v_id;

  v_where := coalesce(nullif(trim(p_address), ''), 'your area');
  insert into notifications (user_id, type, alert_id, message)
  select us.user_id, 'emergency', v_id,
         format('%s reported near %s. Stay away and keep the road clear for emergency services.',
                emergency_label(p_kind), v_where)
    from user_settings us
   where us.user_id <> v_user and us.home_location is not null
     and ST_DWithin(us.home_location, make_point(p_lat, p_lng), v_radius);
  insert into notifications (user_id, type, alert_id, actor_id, message)
  select user_id, 'emergency_admin', v_id, v_user,
         format('Emergency alert raised: %s near %s.', emergency_label(p_kind), v_where)
    from user_roles where role = 'admin' and user_id <> v_user;
  return v_id;
end $$;

-- Nearby people confirm, deny or say it's over. Enough denials hide a false
-- alert and cost the reporter reputation.
create or replace function respond_emergency(
  p_alert uuid, p_response text, p_lat double precision default null, p_lng double precision default null
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  e emergency_alerts;
  v_home geography;
begin
  select * into s from app_settings where id = 1;
  select * into e from emergency_alerts where id = p_alert for update;
  if not found then raise exception 'Alert not found' using hint = 'NOT_FOUND'; end if;
  if e.status <> 'active' then raise exception 'This alert has ended' using hint = 'LOCKED'; end if;
  if p_response not in ('confirm', 'deny', 'over') then
    raise exception 'Unknown response' using hint = 'BAD_KIND';
  end if;

  if e.reporter_id = v_user then
    if p_response <> 'over' then
      raise exception 'You raised this alert. You can only mark it as over.' using hint = 'OWN_ALERT';
    end if;
    update emergency_alerts set status = 'over', ended_at = now() where id = p_alert;
    return 'over';
  end if;

  select home_location into v_home from user_settings where user_id = v_user;
  if coalesce(ST_DWithin(make_point(p_lat, p_lng), e.location, s.emergency_respond_radius_m), false) = false
     and coalesce(ST_DWithin(v_home, e.location, s.emergency_respond_radius_m), false) = false then
    raise exception 'Only people nearby can respond to this alert' using hint = 'NOT_NEARBY';
  end if;

  insert into emergency_responses (alert_id, user_id, response) values (p_alert, v_user, p_response)
  on conflict (alert_id, user_id) do update set response = excluded.response, created_at = now();

  update emergency_alerts a
     set confirm_count = x.c, deny_count = x.d, over_count = x.o
    from (select count(*) filter (where response = 'confirm') c,
                 count(*) filter (where response = 'deny') d,
                 count(*) filter (where response = 'over') o
            from emergency_responses where alert_id = p_alert) x
   where a.id = p_alert
  returning * into e;

  if e.deny_count >= s.emergency_hide_denials and e.deny_count > e.confirm_count then
    update emergency_alerts set status = 'hidden', ended_at = now() where id = p_alert;
    update profiles set reputation = reputation + s.rep_false_emergency where id = e.reporter_id;
    insert into notifications (user_id, type, alert_id, message)
    values (e.reporter_id, 'emergency_hidden', p_alert,
            format('Your emergency alert was hidden because people nearby said it wasn''t true (%s reputation).', s.rep_false_emergency));
    return 'hidden';
  elsif e.over_count >= s.emergency_end_votes then
    update emergency_alerts set status = 'over', ended_at = now() where id = p_alert;
    return 'over';
  end if;
  return 'active';
end $$;

-- ---------- Scheduled maintenance (replaces 0002) -------------------
create or replace function run_maintenance() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  r record;
  v_reminders int := 0;
  v_lead_offers int := 0;
  v_expired_locks int := 0;
  v_closed int := 0;
  v_reopened int := 0;
  v_expired_reviews int := 0;
  v_overdue int := 0;
  v_stuck int := 0;
  v_alerts int := 0;
  v_fixed int;
  v_not_fixed int;
begin
  select * into s from app_settings where id = 1;

  -- 1. Reminder before a lock runs out. A team gets the chance to take over.
  for r in
    select i.id, i.volunteer_id, i.title, i.assignment_id, a.team_size from issues i
      join assignments a on a.id = i.assignment_id
     where i.status in ('assigned', 'in_progress') and not i.lock_reminder_sent
       and i.lock_expires_at > now()
       and i.lock_expires_at <= now() + make_interval(hours => s.lock_reminder_hours)
  loop
    perform notify(r.volunteer_id, 'lock_reminder', r.id, null,
      format('Less than %s hours left on "%s". Post a progress update or release the task.', s.lock_reminder_hours, r.title));
    update issues set lock_reminder_sent = true where id = r.id;
    v_reminders := v_reminders + 1;
    if r.team_size > 1 and exists (select 1 from assignment_members where assignment_id = r.assignment_id and left_at is null) then
      update assignments set lead_offer_open = true where id = r.assignment_id;
      insert into notifications (user_id, type, issue_id, message)
      select user_id, 'lead_offered', r.id,
             format('Your team leader for "%s" has been inactive. Do you want to lead this task?', r.title)
        from assignment_members where assignment_id = r.assignment_id and left_at is null;
      v_lead_offers := v_lead_offers + 1;
    end if;
  end loop;

  -- 2. Expired locks: back to the pool, the leader loses reputation (members don't).
  for r in
    select id, volunteer_id, title from issues
     where status in ('assigned', 'in_progress') and lock_expires_at <= now()
     for update skip locked
  loop
    perform end_assignment(r.id, 'expired');
    update profiles set reputation = reputation + s.rep_task_expired, tasks_expired = tasks_expired + 1
     where id = r.volunteer_id;
    perform return_to_pool(r.id);
    perform log_event(r.id, null, 'lock_expired', null, jsonb_build_object('previous_volunteer', r.volunteer_id));
    perform notify(r.volunteer_id, 'lock_expired', r.id, null,
      format('Your task "%s" expired without progress (%s reputation).', r.title, s.rep_task_expired));
    perform notify_audience(r.id, 'task_released', r.volunteer_id,
      format('"%s" is open for volunteers again.', r.title));
    v_expired_locks := v_expired_locks + 1;
  end loop;

  -- 3. Resolutions nobody decided on: majority of reviews wins; no disputes → close
  for r in
    select id, assignment_id, reporter_id from issues
     where status = 'resolution_submitted'
       and resolution_submitted_at <= now() - make_interval(days => s.auto_close_days)
     for update skip locked
  loop
    select count(*) filter (where is_fixed), count(*) filter (where not is_fixed)
      into v_fixed, v_not_fixed
      from resolution_reviews where assignment_id = r.assignment_id;
    if v_not_fixed = 0 or v_fixed > v_not_fixed then
      perform close_issue(r.id, 'auto_closed');
      v_closed := v_closed + 1;
    else
      perform reopen_issue(r.id, 'auto_reopened');
      v_reopened := v_reopened + 1;
    end if;
  end loop;

  -- 4. Reports the community never validated
  for r in
    select id, reporter_id, title from issues
     where status = 'community_review'
       and created_at <= now() - make_interval(days => s.review_expiry_days)
     for update skip locked
  loop
    update issues set status = 'expired', updated_at = now() where id = r.id;
    perform log_event(r.id, null, 'expired', null, null);
    perform notify(r.reporter_id, 'issue_expired', r.id, null,
      format('"%s" expired because it did not get enough community support in %s days.', r.title, s.review_expiry_days));
    v_expired_reviews := v_expired_reviews + 1;
  end loop;

  -- 5. City Corporation past its target time: shown as Overdue, followers told once.
  for r in
    select i.id, i.title, i.authority_id, a.short_name from issues i
      join authorities a on a.id = i.authority_id
     where i.route = 'authority' and i.due_at < now() and not i.overdue_notified
       and i.status in ('escalated', 'assigned', 'in_progress', 'resolution_submitted')
  loop
    update issues set overdue_notified = true where id = r.id;
    perform log_event(r.id, null, 'overdue', null, jsonb_build_object('authority', r.short_name));
    perform notify_officials(r.authority_id, 'overdue', r.id, format('"%s" is past its target time.', r.title));
    perform notify_audience(r.id, 'overdue', null,
      format('%s is overdue on "%s". Volunteers can follow up through the hotline.', r.short_name, r.title));
    v_overdue := v_overdue + 1;
  end loop;

  -- 6. Stuck with volunteers: released too often, or nobody took it for too long.
  for r in
    select i.id from issues i
     where i.status = 'validated' and i.route = 'community'
       and not exists (select 1 from review_items x where x.issue_id = i.id and x.kind = 'stuck' and x.status = 'open')
       and ((select count(*) from assignments a where a.issue_id = i.id and a.outcome in ('released', 'expired', 'reopened'))
              >= s.stuck_release_count
            or coalesce((select max(ended_at) from assignments a where a.issue_id = i.id), i.validated_at)
               < now() - make_interval(days => s.stuck_days))
  loop
    perform open_review(r.id, 'stuck', null, null, null);
    v_stuck := v_stuck + 1;
  end loop;

  -- 7. Emergency alerts end on their own.
  update emergency_alerts set status = 'expired', ended_at = now()
   where status = 'active' and expires_at <= now();
  get diagnostics v_alerts = row_count;

  return jsonb_build_object(
    'reminders', v_reminders, 'lead_offers', v_lead_offers, 'expired_locks', v_expired_locks,
    'auto_closed', v_closed, 'auto_reopened', v_reopened, 'expired_reviews', v_expired_reviews,
    'overdue', v_overdue, 'stuck', v_stuck, 'expired_alerts', v_alerts);
end $$;
