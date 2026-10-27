-- =====================================================================
-- AmarShohor — 74. Edge cases found in review
--
-- 1. An appeal ends when the report comes back on its own (support now
--    outweighs the flags). Before, it stayed open, and accepting it later
--    put a live task back to "unverified" while a volunteer worked on it.
-- 2. A report hidden in the spam window can't be deleted: deleting it
--    lifted the posting pause. The reporter can appeal instead.
-- 3. Nobody who was in a task's team can vote on its fix: not after
--    leaving the team, and not a leader who handed it over as busy.
-- 4. A progress update ends the "leader inactive" offer, so a member
--    can't take over (and penalise) a leader who just posted progress.
-- 5. Editing a report's category also changes who fixes it and its
--    starting severity (change_issue_category), as for everyone else.
-- 6. "We have enough people" stays: someone leaving the team, or taking
--    over the lead, no longer opens a spot for strangers. A removed
--    no-show's spot still opens again (0067).
-- 7. A progress update on a team task extends the team lock, not the
--    shorter solo lock.
-- 8. Changing only the category of an issue already with the City
--    Corporation keeps it there: no second "New issue" message, and no
--    "No City Corporation covers this place" when its area was redrawn.
-- 9. "Help needed" is for tasks sent to volunteers again, not for every
--    new issue an admin sends to volunteers the first time.
-- Same as before otherwise (0013, 0018, 0031, 0033, 0057, 0066, 0067,
-- 0070, 0071, 0073).
-- =====================================================================

set search_path = public, extensions;

-- ---------- 1. Appeals end when the report comes back on its own -------
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
  if old.status = 'hidden' then
    update review_items
       set status = 'resolved', resolved_at = now(), decision = 'auto:visible',
           decision_note = 'The report is visible again'
     where issue_id = new.id and status = 'open' and kind = 'appeal';
  end if;
  return null;
end $$;

-- The appeal is decided before the report comes back, so the trigger above leaves it alone.
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
  if i.status <> 'hidden' then
    raise exception 'This report is visible again, so there is nothing to decide' using hint = 'NOT_HIDDEN';
  end if;
  perform resolve_reviews(p_issue, array['appeal']::review_kind[], v_admin,
    case when p_restore then 'restored' else 'kept_hidden' end, v_reason);

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

  perform log_admin(v_admin, case when p_restore then 'appeal_restore' else 'appeal_reject' end,
    p_issue, i.reporter_id, v_reason, null);
end $$;

-- ---------- 2. Recently hidden reports can't be deleted ----------------
create or replace function delete_issue(p_issue uuid) returns setof text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue for update;
  if not found or i.reporter_id <> v_user then
    raise exception 'You can only delete your own reports' using hint = 'FORBIDDEN';
  end if;
  if i.status not in ('community_review', 'hidden', 'expired') then
    raise exception 'Validated reports can no longer be deleted' using hint = 'LOCKED';
  end if;
  -- It counts towards the posting pause (posting_paused_until) for spam_pause_window_days.
  if i.status = 'hidden' and i.hidden_at > now() - make_interval(days => (select spam_pause_window_days from app_settings where id = 1)) then
    raise exception 'A report hidden in the last % days can''t be deleted. You can appeal instead.',
      (select spam_pause_window_days from app_settings where id = 1) using hint = 'LOCKED';
  end if;

  return query select storage_path from issue_media where issue_id = p_issue;
  delete from issues where id = p_issue;
  update profiles set reports_count = greatest(reports_count - 1, 0) where id = v_user;
end $$;

-- ---------- 3. Nobody from the team votes on its own fix ---------------
create or replace function review_resolution(
  p_issue uuid, p_is_fixed boolean, p_lat double precision default null, p_lng double precision default null
) returns issue_status
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_is_reporter boolean;
  v_reporter_decides boolean;
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
  -- The leader, anyone who was ever in the team (also after leaving), or an earlier leader of
  -- this task (handed it over as busy, or a member took over).
  if i.volunteer_id = v_user
     or exists (select 1 from assignment_members where assignment_id = i.assignment_id and user_id = v_user)
     or exists (select 1 from issue_events e join assignments a on a.id = i.assignment_id
                 where e.issue_id = p_issue and e.created_at >= a.accepted_at
                   and ((e.type = 'released' and e.actor_id = v_user and e.data ? 'new_leader')
                        or (e.type = 'lead_changed' and e.data->>'from' = v_user::text))) then
    raise exception 'You can''t confirm your own fix' using hint = 'OWN_TASK';
  end if;
  if i.authority_id is not null and official_authority(v_user) = i.authority_id then
    raise exception 'Officials can''t confirm their own City Corporation''s fix' using hint = 'OWN_TASK';
  end if;

  v_is_reporter := i.reporter_id = v_user;
  -- The reporter can always accept a fix, but can reopen it alone only once.
  v_reporter_decides := v_is_reporter
    and (p_is_fixed or not exists (select 1 from assignments where issue_id = p_issue and outcome = 'reopened'));
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
    'resolution_review', null,
    jsonb_build_object('is_fixed', p_is_fixed, 'by_reporter', v_is_reporter, 'reporter_decides', v_reporter_decides));

  if v_reporter_decides then
    if p_is_fixed then perform close_issue(p_issue, 'reporter_confirmed');
    else perform reopen_issue(p_issue, 'reporter_disputed'); end if;
  else
    select count(*) filter (where r.is_fixed), count(*) filter (where not r.is_fixed)
      into v_fixed, v_not_fixed
      from resolution_reviews r
     where r.assignment_id = i.assignment_id
       and (r.user_id <> i.reporter_id or not v_reporter_decides);
    if v_fixed >= s.resolution_quorum then perform close_issue(p_issue, 'community_confirmed');
    elsif v_not_fixed >= s.resolution_quorum then perform reopen_issue(p_issue, 'community_disputed');
    end if;
  end if;

  return (select status from issues where id = p_issue);
end $$;

-- ---------- 4 + 7. Progress: ends the lead offer, keeps the team lock --
create or replace function post_progress(p_issue uuid, p_note text, p_media jsonb default '[]') returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_team boolean;
  v_event bigint;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found or i.volunteer_id is distinct from v_user or i.status not in ('assigned', 'in_progress') then
    raise exception 'This is not your active task' using hint = 'FORBIDDEN';
  end if;
  if char_length(coalesce(trim(p_note), '')) < 3 then
    raise exception 'Please describe your progress' using hint = 'NOTE_REQUIRED';
  end if;
  v_team := coalesce((select team_size > 1 from assignments where id = i.assignment_id), false);

  update issues
     set status = 'in_progress',
         lock_expires_at = now() + make_interval(hours => case when v_team then s.team_lock_hours else s.lock_hours end),
         lock_reminder_sent = false, updated_at = now()
   where id = p_issue;
  -- The leader is active again: members can no longer take over (run_maintenance opened it).
  update assignments set lead_offer_open = false where id = i.assignment_id and lead_offer_open;

  v_event := log_event(p_issue, v_user, 'progress', trim(p_note), null);
  perform attach_media(p_issue, v_user, 'progress', p_media, v_event, 0, false);
  perform notify_audience(p_issue, 'task_progress', v_user,
    format('Progress update on "%s": %s', i.title, left(trim(p_note), 80)));
end $$;

-- ---------- 5. Editing the category changes the route too --------------
create or replace function update_issue(p_issue uuid, p_title text, p_description text, p_category text, p_address text)
returns void
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
         address = coalesce(trim(p_address), ''), updated_at = now()
   where id = p_issue;
  if p_category is not null and p_category is distinct from i.category then
    perform change_issue_category(p_issue, p_category, v_user, 'The reporter changed it.');
  end if;
  perform log_event(p_issue, v_user, 'edited', null, null);
  perform recompute_issue(p_issue);
end $$;

-- ---------- 6. "We have enough people" stays --------------------------
-- Whether the leader is still asking for people. Before, it was read from team_size alone.
alter table assignments add column if not exists recruiting boolean not null default false;
update assignments a set recruiting = true
 where a.outcome = 'active' and a.team_size >
       (select count(*) from assignment_members m where m.assignment_id = a.id and m.left_at is null) + 1;

-- A closed team loses a spot with the person: nobody new can join in their place.
create or replace function shrink_closed_team(p_assignment bigint) returns void
language sql security definer set search_path = public, extensions as $$
  update assignments set team_size = greatest(team_size - 1, 1)
   where id = p_assignment and not recruiting and team_size > 1
$$;

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
  if a.recruiting then
    raise exception 'Nearby volunteers were already asked. Wait for them to join.' using hint = 'ALREADY_ASKED';
  end if;
  if exists (select 1 from issue_events where issue_id = p_issue and type = 'team_requested'
              and created_at > now() - interval '24 hours') then
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
  update assignments set team_size = v_members + 1, recruiting = false where id = a.id;
  if v_members = 0 then  -- nobody joined: back to a solo task, so no longer the longer team lock
    update issues
       set lock_expires_at = least(lock_expires_at, now() + make_interval(hours => s.lock_hours)), updated_at = now()
     where id = p_issue;
  end if;
  perform log_event(p_issue, a.volunteer_id, 'team_closed', null, jsonb_build_object('team_size', v_members + 1));
end $$;

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
  perform shrink_closed_team(i.assignment_id);
  perform log_event(p_issue, v_user, 'team_left', null, null);
end $$;

-- Taking over from an inactive leader: the leader leaves the team, so a closed team shrinks.
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
    perform shrink_closed_team(a.id);
    update profiles set reputation = reputation + s.rep_task_expired, tasks_expired = tasks_expired + 1
     where id = a.volunteer_id;
    perform notify(a.volunteer_id, 'lead_taken_over', p_issue, null,
      format('You were inactive, so a team member took over "%s" (%s reputation).', i.title, s.rep_task_expired));
  end if;

  perform log_event(p_issue, v_user, 'lead_changed', null,
    jsonb_build_object('from', a.volunteer_id, 'friendly', v_friendly));
  perform notify_audience(p_issue, 'lead_changed', v_user, format('"%s" has a new team leader.', i.title));
end $$;

-- Released as busy: the next member leads, and a closed team shrinks by the old leader.
create or replace function release_task(
  p_issue uuid, p_reason text default '', p_kind text default 'busy', p_media jsonb default '[]',
  p_wrong_type text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  a assignments;
  v_official boolean;
  v_who text;
  v_next uuid;
  v_event bigint;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found or i.volunteer_id is distinct from v_user or i.status not in ('assigned', 'in_progress') then
    raise exception 'This is not your active task' using hint = 'FORBIDDEN';
  end if;
  select * into a from assignments where id = i.assignment_id;
  v_official := a.role = 'official';
  v_who := case when v_official
                then coalesce((select short_name from authorities where id = i.authority_id), 'The City Corporation')
                else 'A volunteer' end;
  if p_kind not in ('busy', 'needs_authority', 'wrong_issue', 'send_back') then
    raise exception 'Unknown release reason' using hint = 'BAD_KIND';
  end if;
  if v_official and p_kind = 'needs_authority' then
    raise exception 'This issue is already with the City Corporation' using hint = 'BAD_KIND';
  end if;
  if not v_official and p_kind = 'send_back' then
    raise exception 'Only City Corporation officials can send an issue to volunteers' using hint = 'BAD_KIND';
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
      case p_kind when 'needs_authority' then 'escalation_requested'
                  when 'send_back' then 'send_back_requested'
                  else 'reported_wrong' end,
      trim(p_reason), jsonb_build_object('wrong_type', p_wrong_type));
    -- Officials asking for volunteers don't have to be on site, so the photo is optional.
    if p_kind = 'send_back' then
      perform attach_media(p_issue, v_user, 'progress', p_media, v_event, 0, false);
    else
      perform attach_media(p_issue, v_user, 'progress', p_media, v_event, 1, true);
    end if;
    update issues
       set status = 'under_review', volunteer_id = null, assignment_id = null, assigned_at = null,
           lock_expires_at = null, lock_reminder_sent = false, updated_at = now()
     where id = p_issue;
    perform open_review(p_issue,
      case p_kind when 'needs_authority' then 'escalation_request'
                  when 'send_back' then 'send_back'
                  else 'wrong_issue' end::review_kind,
      v_user, p_reason, jsonb_build_object('wrong_type', p_wrong_type, 'event', v_event));
    perform notify_audience(p_issue, 'under_review', v_user,
      case p_kind
        when 'needs_authority' then format('A volunteer says "%s" needs the City Corporation. An admin will decide.', i.title)
        when 'send_back' then format('%s says volunteers can handle "%s". An admin will decide.', v_who, i.title)
        else format('%s says "%s" may be %s. An admin will check.', v_who, i.title, replace(p_wrong_type, '_', ' ')) end);
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
    perform shrink_closed_team(a.id);
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
    case when v_official
      then format('The official released "%s". It is back with %s.', i.title, v_who)
      else format('The volunteer released "%s". It is open for other volunteers again.', i.title) end);
end $$;

-- ---------- 8. Category only: the City Corporation keeps it -----------
create or replace function admin_set_route(
  p_issue uuid, p_route issue_route, p_reason text,
  p_category text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_issue_admin(p_issue);
  v_reason text := require_reason(p_reason);
  i issues;
  v_keep boolean;  -- same route and someone has it: they carry on
begin
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.status in ('closed', 'hidden', 'expired') then
    raise exception 'Closed, hidden or expired issues can''t be re-routed' using hint = 'LOCKED';
  end if;
  if p_route not in ('community', 'authority') then
    raise exception 'Choose volunteers or the City Corporation' using hint = 'BAD_ROUTE';
  end if;
  -- Someone works on it, or it already waits with a City Corporation.
  v_keep := p_route = i.route
            and (i.status in ('assigned', 'in_progress', 'resolution_submitted')
                 or (i.status = 'escalated' and i.authority_id is not null));
  if p_route = 'authority' and not v_keep and find_authority(i.location) is null then
    raise exception 'No City Corporation covers this place. Draw one that covers it in the City Corporations tab, or send it to volunteers.'
      using hint = 'NO_AUTHORITY';
  end if;
  if p_category is not null then
    if not exists (select 1 from categories where slug = p_category and is_active) then
      raise exception 'Unknown category' using hint = 'BAD_CATEGORY';
    end if;
    update issues set category = p_category where id = p_issue;
  end if;

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

-- ---------- 9. "Help needed": sent to volunteers again ----------------
create or replace function get_help_requests()
returns table (issue_id uuid, requested_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select l.issue_id, max(l.created_at)
    from admin_actions l join issues i on i.id = l.issue_id
   where (l.action = 'request_help'
          or (l.action = 'set_route' and l.data->>'to' = 'community' and l.data->>'from' <> 'pending'))
     and l.created_at > now() - interval '30 days'
     and i.status = 'validated' and i.route = 'community' and i.volunteer_id is null
   group by l.issue_id
$$;

-- ---------- Who may run what (0041) -------------------------------------
revoke execute on function shrink_closed_team(bigint) from public, anon, authenticated;
