-- =====================================================================
-- AmarShohor — 54. Officials release a task: busy, or volunteers can do it
--
-- An official who releases a City Corporation task now picks one of:
--   busy          back to the same City Corporation (escalated). The target
--                 date keeps running.
--   send_back     "volunteers can handle this": needs a note (photo
--                 optional). The official is released, the issue waits
--                 under_review and goes to that area's admin.
--                   approve -> volunteers (admin_set_route to community)
--                   reject  -> back to the same City Corporation (escalated)
--   wrong_issue   unchanged: already fixed / fake / wrong place.
-- Volunteers keep busy / needs_authority / wrong_issue.
-- =====================================================================

set search_path = public, extensions;

create or replace function release_task(
  p_issue uuid, p_reason text default '', p_kind text default 'busy',
  p_media jsonb default '[]', p_wrong_type text default null
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

-- Same as 0045, plus: rejecting an official's "volunteers can handle this"
-- puts the issue back with the same City Corporation.
create or replace function admin_dismiss_review(p_review bigint, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_issue_admin((select issue_id from review_items where id = p_review));
  v_reason text := require_reason(p_reason);
  r review_items;
  i issues;
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
    select * into i from issues where id = r.issue_id for update;
    if i.status = 'under_review' and i.route = 'authority' then
      update issues set status = 'escalated', updated_at = now() where id = i.id;
      perform log_event(i.id, v_admin, 'send_back_rejected', v_reason, null);
      perform notify_officials(i.authority_id, 'escalated', i.id,
        format('Not sent to volunteers, "%s" is back with you: %s', i.title, v_reason));
      perform notify_audience(i.id, 'task_released', v_admin,
        format('"%s" stays with %s.', i.title,
               coalesce((select short_name from authorities where id = i.authority_id), 'the City Corporation')));
    end if;
    perform notify(r.requested_by, 'send_back_rejected', r.issue_id, v_admin,
      format('Your request to send the issue to volunteers was not approved: %s', v_reason));
  end if;
end $$;
