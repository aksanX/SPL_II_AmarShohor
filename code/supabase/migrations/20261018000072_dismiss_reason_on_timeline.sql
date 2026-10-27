-- =====================================================================
-- AmarShohor — 72. "Leave as is" shows on the issue timeline
--
-- Dismissing a review item ("Leave as is") only went to the admin log, so
-- residents and volunteers never saw that an admin looked at the issue and
-- why it stayed as it is. It now adds a 'review_dismissed' event with the
-- reason to the issue's timeline. A dismissed send-back already shows as
-- 'send_back_rejected' when it puts the issue back with the City Corporation.
-- Same as 0058 otherwise.
-- =====================================================================

set search_path = public, extensions;

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
  else
    perform log_event(r.issue_id, v_admin, 'review_dismissed', v_reason, jsonb_build_object('kind', r.kind));
  end if;
end $$;
