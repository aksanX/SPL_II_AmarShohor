-- =====================================================================
-- AmarShohor — 75. Ask for volunteers again when someone leaves
--
-- "Ask for more volunteers" works once every 24 hours per task (0067), so
-- nearby volunteers aren't asked again and again. But when a member who
-- answered leaves the team, or the leader removes a no-show, the leader
-- needs help again and had to wait out the 24 hours. Now the team losing a
-- person after the last ask lets the leader ask once more:
--   - a member leaves, or the leader removes a no-show;
--   - the leader releases it as busy and a member takes over, or a member
--     takes over from an inactive leader (a closed team shrinks, 0074).
-- A friendly hand-over keeps the old leader as a member, so it doesn't count.
-- Asking twice with nobody leaving in between is still refused.
--
-- Also: "needs help, join the team" no longer goes to people already in the
-- team, or to no-shows the leader removed (they can't rejoin, 0068).
-- Same as 0074 (ask_for_volunteers) and 0009 (notify_nearby_volunteers)
-- otherwise.
-- =====================================================================

set search_path = public, extensions;

create or replace function ask_for_volunteers(p_issue uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  a assignments := require_task_leader(p_issue);
  s app_settings;
  v_title text := (select title from issues where id = p_issue);
  v_members int;
  v_last_ask timestamptz;
  n int;
begin
  select * into s from app_settings where id = 1;
  select count(*) into v_members from assignment_members where assignment_id = a.id and left_at is null;
  if v_members + 1 >= s.team_max_size then
    raise exception 'Your team is full (% people)', s.team_max_size using hint = 'TEAM_FULL';
  end if;
  if a.recruiting then
    raise exception 'Nearby volunteers were already asked. Wait for them to join.' using hint = 'ALREADY_ASKED';
  end if;
  select max(created_at) into v_last_ask from issue_events where issue_id = p_issue and type = 'team_requested';
  if v_last_ask > now() - interval '24 hours'
     and not exists (select 1 from issue_events
                      where issue_id = p_issue and created_at > v_last_ask
                        and (type in ('team_left', 'team_removed')
                             or (type = 'released' and data ? 'new_leader')
                             or (type = 'lead_changed' and data->>'friendly' = 'false'))) then
    raise exception 'You asked nearby volunteers less than 24 hours ago. Try again later.' using hint = 'ASKED_RECENTLY';
  end if;

  update assignments set team_size = s.team_max_size, recruiting = true where id = a.id;
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

-- Not the issue's own team: its members are already in it, and a removed no-show can't rejoin.
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
     and ST_DWithin(us.home_location, i.location, p_radius_m)
     and not exists (select 1 from assignment_members m
                      where m.assignment_id = i.assignment_id and m.user_id = p.id
                        and (m.left_at is null or m.removed_at is not null));
  get diagnostics n = row_count;
  return n;
end $$;
