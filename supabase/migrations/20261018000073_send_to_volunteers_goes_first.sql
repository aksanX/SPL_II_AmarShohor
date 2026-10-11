-- =====================================================================
-- AmarShohor — 73. "Send to volunteers" puts the task first in the feed
--
-- A task nobody took for long is "Stuck". An admin who sends it to
-- volunteers (again) wants them to see it: it now counts like asking
-- nearby volunteers for help (0066), so the volunteer feed lists it first
-- with "Help needed". "Leave as is" doesn't: the task stays where it was.
-- Same as 0066 otherwise.
-- =====================================================================

set search_path = public, extensions;

create or replace function get_help_requests()
returns table (issue_id uuid, requested_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select l.issue_id, max(l.created_at)
    from admin_actions l join issues i on i.id = l.issue_id
   where (l.action = 'request_help' or (l.action = 'set_route' and l.data->>'to' = 'community'))
     and l.created_at > now() - interval '30 days'
     and i.status = 'validated' and i.route = 'community' and i.volunteer_id is null
   group by l.issue_id
$$;
