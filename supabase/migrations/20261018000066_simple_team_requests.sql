-- =====================================================================
-- AmarShohor — 66. Asking for more volunteers: one button
--
-- Before: the team size was chosen only when accepting a task. Now:
--   - Volunteers accept a task alone (no team size to choose). Working on
--     it, they tap "Ask for more volunteers": the team opens up to
--     team_max_size people (default 10) and nearby volunteers are told.
--   - Anyone working on a task may ask; no completed tasks are needed.
--   - "We have enough people" closes the open spots.
--   - When a team task ends without a fix (released, sent to an admin,
--     lock expired, moved by an admin), the members are told too.
--   - Volunteers see which open tasks an admin asked them to help with.
-- =====================================================================

set search_path = public, extensions;

alter table app_settings
  add column team_max_size int not null default 10 check (team_max_size between 2 and 50);

-- The volunteer working on the task, still leading it.
create or replace function require_task_leader(p_issue uuid) returns assignments
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
  a assignments;
begin
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  select * into a from assignments where id = i.assignment_id and outcome = 'active';
  if i.volunteer_id is distinct from v_user or i.status not in ('assigned', 'in_progress')
     or a.id is null or a.role <> 'volunteer' then
    raise exception 'Only the volunteer leading this task can do this' using hint = 'NOT_LEADER';
  end if;
  return a;
end $$;

-- Returns how many nearby volunteers were told.
create or replace function ask_for_volunteers(p_issue uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  a assignments := require_task_leader(p_issue);
  s app_settings;
  v_title text := (select title from issues where id = p_issue);
  v_members int;
  n int;
begin
  select * into s from app_settings where id = 1;
  select count(*) into v_members from assignment_members where assignment_id = a.id and left_at is null;
  if v_members + 1 >= s.team_max_size then
    raise exception 'Your team is full (% people)', s.team_max_size using hint = 'TEAM_FULL';
  end if;
  if a.team_size > v_members + 1 then
    raise exception 'Nearby volunteers were already asked. Wait for them to join.' using hint = 'ALREADY_ASKED';
  end if;

  update assignments set team_size = s.team_max_size where id = a.id;
  if a.team_size = 1 then  -- a solo task becomes a team task: team lock
    update issues
       set lock_expires_at = greatest(lock_expires_at, now() + make_interval(hours => s.team_lock_hours)),
           lock_reminder_sent = false, updated_at = now()
     where id = p_issue;
  end if;
  perform log_event(p_issue, a.volunteer_id, 'team_requested', null, jsonb_build_object('team_size', s.team_max_size));
  n := notify_nearby_volunteers(p_issue, s.request_help_radius_m, 'team_recruiting', a.volunteer_id,
    format('A volunteer near you needs help with "%s". Join the team from the task page.', v_title));
  return coalesce(n, 0);
end $$;

-- "We have enough people": no more open spots.
create or replace function close_team_recruiting(p_issue uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  a assignments := require_task_leader(p_issue);
  s app_settings;
  v_members int;
begin
  select * into s from app_settings where id = 1;
  select count(*) into v_members from assignment_members where assignment_id = a.id and left_at is null;
  if a.team_size <= v_members + 1 then
    raise exception 'The team isn''t looking for people' using hint = 'NOT_RECRUITING';
  end if;
  update assignments set team_size = v_members + 1 where id = a.id;
  if v_members = 0 then  -- nobody joined: back to a solo task, so no longer the longer team lock
    update issues
       set lock_expires_at = least(lock_expires_at, now() + make_interval(hours => s.lock_hours)), updated_at = now()
     where id = p_issue;
  end if;
  perform log_event(p_issue, a.volunteer_id, 'team_closed', null, jsonb_build_object('team_size', v_members + 1));
end $$;

-- A team task ended without a fix: tell the members, not only the leader.
create or replace function notify_team_task_ended() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  i issues;
  v_msg text;
begin
  select * into i from issues where id = new.issue_id;
  v_msg := case
    when new.outcome = 'released' and i.status = 'under_review'
      then format('The leader sent "%s" to an admin, who decides whether volunteers or the City Corporation fix it. Your team has ended.', i.title)
    when new.outcome = 'released' then format('The leader released "%s". Your team has ended.', i.title)
    when new.outcome = 'expired' then format('"%s" went back to the pool: no progress update in time. Your team has ended.', i.title)
    when new.outcome = 'rerouted' then format('An admin moved "%s" to someone else. Your team has ended.', i.title)
    else format('"%s" is no longer with your team. Your team has ended.', i.title) end;
  insert into notifications (user_id, type, issue_id, actor_id, message)
  select m.user_id, 'team_ended', new.issue_id, null, v_msg
    from assignment_members m
   where m.assignment_id = new.id and m.left_at is null;
  return null;
end $$;

-- Deferred to the end of the transaction: release_task ends the assignment
-- before it sets the issue under_review, and the message needs the final state.
drop trigger if exists assignments_team_ended on assignments;
create constraint trigger assignments_team_ended after update of outcome on assignments
  deferrable initially deferred
  for each row when (old.outcome = 'active' and new.outcome in ('released', 'expired', 'rerouted', 'reopened'))
  execute function notify_team_task_ended();

-- Open tasks an admin asked nearby volunteers to help with (last 30 days).
create or replace function get_help_requests()
returns table (issue_id uuid, requested_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select l.issue_id, max(l.created_at)
    from admin_actions l join issues i on i.id = l.issue_id
   where l.action = 'request_help' and l.created_at > now() - interval '30 days'
     and i.status = 'validated' and i.route = 'community' and i.volunteer_id is null
   group by l.issue_id
$$;

-- ---------- Who may run what (0041) -------------------------------------
revoke execute on function
  require_task_leader(uuid), ask_for_volunteers(uuid), close_team_recruiting(uuid),
  notify_team_task_ended(), get_help_requests()
from public, anon;
revoke execute on function require_task_leader(uuid), notify_team_task_ended() from authenticated;
grant execute on function ask_for_volunteers(uuid), close_team_recruiting(uuid), get_help_requests() to authenticated;
