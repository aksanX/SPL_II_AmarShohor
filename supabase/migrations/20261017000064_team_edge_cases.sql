-- =====================================================================
-- AmarShohor — 64. Teams: edge cases
--
-- 1. A team's leader changes (hand-over, or the leader released as busy):
--    every member is told, not only the new leader.
-- 2. The leader can remove a member who never came. Someone who checked in
--    at the site keeps their place (and reward). Their spot opens again.
-- 3. "Ask for more volunteers" at most once every 24 hours per task, so
--    nearby volunteers aren't asked again and again.
-- 4. Teams are formed only with "Ask for more volunteers" (0063): a task is
--    always accepted alone, also by apps that still send a team size.
-- 5. Same as the final 0063 (in case an earlier copy of it was run): the
--    "team ended" message is sent at the end of the transaction, and
--    "We have enough people" with nobody joined goes back to the solo lock.
-- =====================================================================

set search_path = public, extensions;

-- ---------- 1. New leader: tell the team --------------------------------
create or replace function notify_team_new_leader() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_title text := (select title from issues where id = new.issue_id);
  v_leader text := (select coalesce(nullif(full_name, ''), username) from profiles where id = new.volunteer_id);
begin
  insert into notifications (user_id, type, issue_id, actor_id, message)
  select m.user_id, 'lead_changed', new.issue_id, new.volunteer_id,
         format('%s now leads the team for "%s".', v_leader, v_title)
    from assignment_members m
   where m.assignment_id = new.id and m.left_at is null and m.user_id <> new.volunteer_id;
  return null;
end $$;

drop trigger if exists assignments_new_leader on assignments;
create constraint trigger assignments_new_leader after update of volunteer_id on assignments
  deferrable initially deferred
  for each row when (old.volunteer_id is distinct from new.volunteer_id and new.outcome = 'active')
  execute function notify_team_new_leader();

-- ---------- 2. Remove a member who never came ---------------------------
create or replace function remove_team_member(p_issue uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  a assignments := require_task_leader(p_issue);
  m assignment_members;
  v_title text := (select title from issues where id = p_issue);
begin
  select * into m from assignment_members where assignment_id = a.id and user_id = p_user and left_at is null for update;
  if not found then raise exception 'They are not in your team' using hint = 'NOT_MEMBER'; end if;
  if m.checked_in_at is not null then
    raise exception 'They came to the site, so they keep their place in the team' using hint = 'CHECKED_IN';
  end if;
  update assignment_members set left_at = now() where assignment_id = a.id and user_id = p_user;
  perform log_event(p_issue, a.volunteer_id, 'team_removed', null, jsonb_build_object('user_id', p_user));
  perform notify(p_user, 'team_removed', p_issue, a.volunteer_id,
    format('The leader removed you from the team for "%s". No penalty.', v_title));
end $$;

-- ---------- 3 + 5. Ask (once a day) and close ---------------------------
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
  if exists (select 1 from issue_events where issue_id = p_issue and type = 'team_requested'
              and created_at > now() - interval '24 hours') then
    raise exception 'You asked nearby volunteers less than 24 hours ago. Try again later.' using hint = 'ASKED_RECENTLY';
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

drop trigger if exists assignments_team_ended on assignments;
create constraint trigger assignments_team_ended after update of outcome on assignments
  deferrable initially deferred
  for each row when (old.outcome = 'active' and new.outcome in ('released', 'expired', 'rerouted', 'reopened'))
  execute function notify_team_task_ended();

-- ---------- 4. Tasks are accepted alone ---------------------------------
create or replace function guard_accept_alone() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.role = 'volunteer' and new.team_size > 1 then
    raise exception 'Accept the task alone, then tap "Ask for more volunteers" if you need a team'
      using hint = 'ASK_AFTER_ACCEPT';
  end if;
  return new;
end $$;

drop trigger if exists assignments_accept_alone on assignments;
create trigger assignments_accept_alone before insert on assignments
  for each row execute function guard_accept_alone();

-- ---------- Who may run what (0041) -------------------------------------
revoke execute on function
  notify_team_new_leader(), remove_team_member(uuid, uuid), guard_accept_alone()
from public, anon;
revoke execute on function notify_team_new_leader(), guard_accept_alone() from authenticated;
grant execute on function remove_team_member(uuid, uuid) to authenticated;
