-- =====================================================================
-- AmarShohor — 33. Loose ends after 0031/0032
--
-- 1. Votes, confirmations, flags and other resident answers that admins (and
--    officials, in their own area) gave before 0031 are removed from issues and
--    alerts that are still open, and the counts are recalculated. Closed
--    issues and ended alerts keep their history.
-- 2. Two admins deciding the same request at the same moment: the second one
--    waits for the first and is then told it was already decided, instead of
--    both decisions sending messages.
-- 3. A switched-off City Corporation stays in the public record while it still
--    has issues, and its waiting issues move to a City Corporation that covers
--    them (or to the admin queue).
-- 4. Comments by admins are labelled, like officials' comments.
-- =====================================================================

set search_path = public, extensions;

-- =====================================================================
-- 1. Remove admins' and officials' resident answers on open issues/alerts
-- =====================================================================
do $$
declare
  v_issues uuid[];
  v_alerts uuid[];
  v_issue record;
begin
  create temporary table staff_answers (issue_id uuid) on commit drop;

  -- Who must not have answered: admins anywhere, officials on issues of their area.
  create temporary view staff_open_issue_pairs as
  select i.id as issue_id, u.user_id
    from issues i
    join (select distinct user_id from user_roles) u on true
   where i.status not in ('closed', 'expired')
     and (is_admin(u.user_id) or official_covers(u.user_id, i.authority_id, i.location));

  with d as (delete from votes v using staff_open_issue_pairs s
              where v.issue_id = s.issue_id and v.user_id = s.user_id returning v.issue_id)
  insert into staff_answers select issue_id from d;
  with d as (delete from confirmations c using staff_open_issue_pairs s
              where c.issue_id = s.issue_id and c.user_id = s.user_id returning c.issue_id)
  insert into staff_answers select issue_id from d;
  with d as (delete from flags f using staff_open_issue_pairs s
              where f.issue_id = s.issue_id and f.user_id = s.user_id returning f.issue_id)
  insert into staff_answers select issue_id from d;
  with d as (delete from severity_votes x using staff_open_issue_pairs s
              where x.issue_id = s.issue_id and x.user_id = s.user_id returning x.issue_id)
  insert into staff_answers select issue_id from d;
  delete from category_suggestions x using staff_open_issue_pairs s
   where x.issue_id = s.issue_id and x.user_id = s.user_id;
  -- "Still there?" is for residents only, officials included everywhere.
  delete from still_there_answers x using issues i
   where i.id = x.issue_id and i.status not in ('closed', 'expired')
     and exists (select 1 from user_roles r where r.user_id = x.user_id);
  -- Fix reviews on a fix still waiting for confirmation.
  delete from resolution_reviews x using staff_open_issue_pairs s, issues i
   where x.issue_id = s.issue_id and x.user_id = s.user_id
     and i.id = x.issue_id and i.status = 'resolution_submitted' and x.assignment_id = i.assignment_id;

  drop view staff_open_issue_pairs;

  select array_agg(distinct issue_id) into v_issues from staff_answers;
  for v_issue in select unnest(coalesce(v_issues, '{}')) as id loop
    perform recompute_issue(v_issue.id);
  end loop;

  -- Live alerts: answers by admins and officials, then the counts again.
  with d as (delete from emergency_responses x using emergency_alerts e
              where e.id = x.alert_id and e.status = 'active'
                and exists (select 1 from user_roles r where r.user_id = x.user_id)
              returning x.alert_id)
  select array_agg(distinct alert_id) into v_alerts from d;
  update emergency_alerts a
     set confirm_count = (select count(*) from emergency_responses r where r.alert_id = a.id and r.response = 'confirm'),
         deny_count    = (select count(*) from emergency_responses r where r.alert_id = a.id and r.response = 'deny'),
         over_count    = (select count(*) from emergency_responses r where r.alert_id = a.id and r.response = 'over')
   where a.id = any(coalesce(v_alerts, '{}'));

  raise notice 'Removed staff answers on % open issues and % live alerts',
    coalesce(array_length(v_issues, 1), 0), coalesce(array_length(v_alerts, 1), 0);
end $$;

-- =====================================================================
-- 2. One decision per request, even when two admins click at once
-- =====================================================================
-- Each decision locks its request first (`for update`). The second admin waits
-- for the first; once the first has decided, the request is no longer open
-- and the second gets "already decided".

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
  select * into r from review_items where issue_id = p_issue and kind = 'escalation_request' and status = 'open' for update;
  if not found then raise exception 'No open escalation request for this issue (another admin may have decided it)' using hint = 'NOT_FOUND'; end if;
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

-- Same as 0031, with the lock.
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
  select * into r from review_items where issue_id = p_issue and kind = 'wrong_issue' and status = 'open' for update;
  if not found then raise exception 'No open report for this issue (another admin may have decided it)' using hint = 'NOT_FOUND'; end if;
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

-- Same as 0025, with the lock.
create or replace function admin_decide_appeal(p_issue uuid, p_restore boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  i issues;
  v_flags int;
begin
  perform 1 from review_items where issue_id = p_issue and kind = 'appeal' and status = 'open' for update;
  if not found then
    raise exception 'No open appeal for this issue (another admin may have decided it)' using hint = 'NOT_FOUND';
  end if;
  select * into i from issues where id = p_issue for update;

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

  perform resolve_reviews(p_issue, array['appeal']::review_kind[], v_admin,
    case when p_restore then 'restored' else 'kept_hidden' end, v_reason);
  perform log_admin(v_admin, case when p_restore then 'appeal_restore' else 'appeal_reject' end,
    p_issue, i.reporter_id, v_reason, null);
end $$;

-- Same as 0020, with the lock: decides the open "Wrong category?" request.
create or replace function admin_decide_category(p_issue uuid, p_category text, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  i issues;
begin
  perform 1 from review_items where issue_id = p_issue and kind = 'category_mismatch' and status = 'open' for update;
  if not found then
    raise exception 'No open category question for this issue (another admin may have decided it)' using hint = 'NOT_FOUND';
  end if;
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if p_category is not null and p_category <> coalesce(i.category, '') then
    perform change_issue_category(p_issue, p_category, v_admin, v_reason);
  else
    perform log_event(p_issue, v_admin, 'category_kept', v_reason, jsonb_build_object('category', i.category));
  end if;
  update issues set category_decided_at = now() where id = p_issue;
  perform resolve_reviews(p_issue, array['category_mismatch']::review_kind[], v_admin,
    case when p_category is null then 'kept' else 'category:' || p_category end, v_reason);
  perform log_admin(v_admin, 'decide_category', p_issue, null, v_reason,
    jsonb_build_object('from', i.category, 'to', coalesce(p_category, i.category)));
end $$;

-- Same as 0031, with the lock.
create or replace function admin_dismiss_review(p_review bigint, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  r review_items;
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
    perform notify(r.requested_by, 'send_back_rejected', r.issue_id, v_admin,
      format('Your request to send the issue to volunteers was not approved: %s', v_reason));
  end if;
end $$;

-- =====================================================================
-- 3. Switched-off City Corporations
-- =====================================================================

-- Its waiting issues go to another City Corporation that covers them, or, if
-- none does, wait in the admin queue ("No City Corporation"). Issues an
-- official already took stay with that official to finish.
create or replace function move_issues_off_inactive_authority() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  if not (old.is_active and not new.is_active) then return null; end if;
  for r in select id from issues where authority_id = new.id and status = 'escalated' and route = 'authority' loop
    update issues set authority_id = null, due_at = null, overdue_notified = false where id = r.id;
    perform escalate_issue(r.id, null, format('%s was switched off in AmarShohor', new.short_name));
  end loop;
  return null;
end $$;

drop trigger if exists authorities_move_issues_off on authorities;
create trigger authorities_move_issues_off
  after update of is_active on authorities
  for each row execute function move_issues_off_inactive_authority();

-- Same columns as 0031 plus `is_active`. A switched-off authority stays listed
-- while it still has issues, so its record doesn't vanish.
create or replace view authority_record_v as
select a.id, a.name, a.short_name, a.hotline, a.complaint_url,
       count(i.id) filter (where i.escalated_at is not null)::int as escalated,
       count(i.id) filter (where i.status = 'closed' and i.escalated_at is not null and fx.fixed)::int as resolved,
       count(i.id) filter (where i.status in ('escalated', 'assigned', 'in_progress', 'resolution_submitted'))::int as open,
       count(i.id) filter (where i.due_at < now()
                             and i.status in ('escalated', 'assigned', 'in_progress', 'resolution_submitted'))::int as overdue,
       round((avg(extract(epoch from i.closed_at - i.escalated_at) / 86400)
                filter (where i.status = 'closed' and i.escalated_at is not null and fx.fixed))::numeric, 1) as avg_days_to_resolve,
       a.is_active
from authorities a
left join issues i on i.authority_id = a.id and i.route = 'authority'
left join lateral (
  select exists (select 1 from assignments x where x.issue_id = i.id and x.role = 'official' and x.outcome = 'completed') as fixed
) fx on true
group by a.id
having a.is_active or count(i.id) > 0;

-- =====================================================================
-- 4. Admins' comments are labelled
-- =====================================================================
-- Same as 0010 plus `author_is_admin` at the end.
create or replace view comments_v as
select c.id, c.issue_id, c.parent_id, c.author_id,
       p.username as author_username, p.full_name as author_full_name, p.avatar_url as author_avatar_url,
       case when c.deleted_at is not null or c.is_hidden then null else c.body end as body,
       c.deleted_at is not null as is_deleted, c.is_hidden, c.is_update, c.edited_at, c.created_at,
       coalesce(c.author_id = i.volunteer_id and i.route <> 'authority', false) as is_volunteer,
       (c.author_id = i.reporter_id and not i.is_anonymous) as is_reporter,
       exists (select 1 from comment_flags f where f.comment_id = c.id and f.user_id = auth.uid()) as my_flagged,
       (select a.short_name from user_roles r join authorities a on a.id = r.authority_id
         where r.user_id = c.author_id and r.role = 'official') as author_official_of,
       exists (select 1 from user_roles r where r.user_id = c.author_id and r.role = 'admin') as author_is_admin
from comments c
join profiles p on p.id = c.author_id
join issues i on i.id = c.issue_id;

-- ---------- Permissions -------------------------------------------
revoke execute on function move_issues_off_inactive_authority() from public, anon, authenticated;
