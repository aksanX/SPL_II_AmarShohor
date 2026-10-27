-- =====================================================================
-- AmarShohor — 71. "Send to City Corporation" needs a City Corporation
--
-- Where no City Corporation's area covers the issue, sending it to the
-- City Corporation reached nobody: escalate_issue found none, and the same
-- call then closed the open cases ("Stuck", "No City Corporation"). The
-- issue sat escalated with nobody on it and left the super admins' queue.
-- Now it is refused: draw a City Corporation that covers the place (issues
-- waiting inside it are picked up, 0031), or send it to volunteers.
-- Same as 0045 otherwise.
-- =====================================================================

set search_path = public, extensions;

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
  if p_route = 'authority' and find_authority(i.location) is null then
    raise exception 'No City Corporation covers this place. Draw one that covers it in the City Corporations tab, or send it to volunteers.'
      using hint = 'NO_AUTHORITY';
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
