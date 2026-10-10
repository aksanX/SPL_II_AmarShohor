-- End-to-end test of the v2 rules: roles, category routing, City Corporation flow,
-- teams, release reasons, admin decisions, maintenance and emergencies.
-- Run with supabase/tests/run_local.sh
\set ON_ERROR_STOP 1
\pset pager off
set search_path = public, extensions;
update app_settings set live_issue_evidence = false;  -- these tests use gallery photos (live photos: scenario_v3, 31)

insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','rahim@x.com','{"username":"rahim"}'),
 ('00000000-0000-0000-0000-000000000002','karim@x.com','{"username":"karim"}'),
 ('00000000-0000-0000-0000-000000000003','salma@x.com','{"username":"salma"}'),
 ('00000000-0000-0000-0000-000000000004','nila@x.com','{"username":"nila"}'),
 ('00000000-0000-0000-0000-000000000005','vol1@x.com','{"username":"vol1"}'),
 ('00000000-0000-0000-0000-000000000006','vol2@x.com','{"username":"vol2"}'),
 ('00000000-0000-0000-0000-000000000007','vol3@x.com','{"username":"vol3"}'),
 ('00000000-0000-0000-0000-000000000008','admin@x.com','{"username":"admin1"}'),
 ('00000000-0000-0000-0000-000000000009','officer@x.com','{"username":"dncc_officer"}');
insert into auth.users (id, email, raw_user_meta_data)
 select ('00000000-0000-0000-0000-00000000001'||n)::uuid, 'n'||n||'@x.com', jsonb_build_object('username','neighbour'||n) from generate_series(1,6) n;
update profiles set created_at = now() - interval '30 days';
-- everyone lives in Mirpur (so they count as "nearby")
update user_settings set home_location = make_point(23.8070, 90.3690);

-- The first admin is created with SQL, once.
insert into user_roles (user_id, role) values ('00000000-0000-0000-0000-000000000008', 'admin');

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text,''), false);
      execute case when p is null then 'set role anon' else 'set role authenticated' end; end $$;
create or replace function pg_temp.expect_error(p_sql text, p_hint text) returns text language plpgsql as $$
declare h text;
begin execute p_sql; return 'FAIL: no error (expected ' || p_hint || ')';
exception when others then get stacked diagnostics h = pg_exception_hint;
  return case when h = p_hint then 'ok  ' || p_hint else 'FAIL: got ' || coalesce(h,'?') || ' / ' || sqlerrm end; end $$;
create or replace function pg_temp.check(p_ok boolean, p_what text) returns text language sql as $$
  select case when p_ok then 'ok  ' || p_what else 'FAIL: ' || p_what end $$;
create or replace function pg_temp.validate(p_issue uuid) returns void language plpgsql as $$
begin  -- two on-site neighbours confirm
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000011');
  perform confirm_issue(p_issue, 23.8070, 90.3690, 5, '', '[{"path":"00000000-0000-0000-0000-000000000011/c.jpg","type":"image"}]');
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000012');
  perform confirm_issue(p_issue, 23.8070, 90.3690, 5, '', '[{"path":"00000000-0000-0000-0000-000000000012/c.jpg","type":"image"}]');
end $$;

\echo '--- 1. Roles: only admins can act as admin; an official is verified by an admin'
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select pg_temp.expect_error($$select admin_grant_admin('karim', 'I want to be admin')$$, 'NOT_ADMIN');
do $$ begin insert into user_roles (user_id, role) values ('00000000-0000-0000-0000-000000000002','admin');
  raise notice 'FAIL: could give myself a role';
exception when insufficient_privilege then raise notice 'ok  roles not writable by users'; end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select request_official_role((select id from authorities_v where short_name = 'DNCC'), 'Conservancy Inspector', 'Zone 2', 'Staff ID 4471');
select pg_temp.expect_error($$select request_official_role((select id from authorities_v where short_name = 'DNCC'), 'x', '', '')$$, 'ALREADY_REQUESTED');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select admin_decide_role_request((select id from get_role_requests()), true, 'ok')$$, 'REASON_REQUIRED');
select admin_decide_role_request((select id from get_role_requests()), true, 'Checked staff ID with Zone 2 office');
select pg_temp.check((select count(*) = 1 from roles_v where username = 'dncc_officer' and authority_short_name = 'DNCC'), 'officer verified for DNCC');
select pg_temp.expect_error($$select admin_revoke_role('admin1', 'admin', 'leaving the project')$$, 'LAST_ADMIN');

\echo '--- 2. Pothole in DNCC goes to the City Corporation (its category) after validation'
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select create_issue('Deep pothole at Mirpur 10','Big hole','pothole', 23.80700, 90.36900, 5, 'gps','',false,
  '[{"path":"00000000-0000-0000-0000-000000000001/a.jpg","type":"image"}]', false, 'large') as pothole \gset
select pg_temp.check((select route = 'authority' and route_source = 'category' and status = 'community_review' from issues_v where id = :'pothole'), 'routed to City Corporation by its category');
select pg_temp.expect_error($$select create_issue('No category','','', 23.75, 90.39, 5,'gps','',false,'[{"path":"00000000-0000-0000-0000-000000000001/b.jpg","type":"image"}]', true)$$, 'BAD_CATEGORY');
select pg_temp.validate(:'pothole');
reset role;
select pg_temp.check((select status = 'escalated' and authority_short_name = 'DNCC' and due_at > now() + interval '6 days' from issues_v where id = :'pothole'), 'escalated to DNCC with a 7-day target (high)');
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select set_volunteer_mode(true);
select pg_temp.expect_error($$select accept_task('$$||:'pothole'||$$')$$, 'NOT_OFFICIAL');
select pg_temp.check((select count(*) = 0 from get_open_tasks() where id = :'pothole'), 'not on the volunteer board');
select set_complaint_ref(:'pothole', 'DNCC-16106-8812');

\echo '--- 3. Official takes it, fix rejected (back to DNCC, no points), then fixed and confirmed'
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select pg_temp.check((select count(*) = 1 from get_authority_tasks('new') where id = :'pothole'), 'on the DNCC dashboard');
select accept_task(:'pothole');
select pg_temp.check((select lock_expires_at is null and assignee_role = 'official' from issues_v where id = :'pothole'), 'officials have no lock, only the target time');
select submit_resolution(:'pothole', 'Patched by DNCC road team', 23.80700, 90.36900, 5, '[{"path":"00000000-0000-0000-0000-000000000009/after.jpg","type":"image"}]');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select review_resolution(:'pothole', false) as after_reporter_rejects;
reset role;
select pg_temp.check((select status = 'escalated' and authority_id is not null from issues where id = :'pothole'), 'back with the same City Corporation');
select pg_temp.check((select reputation = 0 from profiles where username = 'dncc_officer'), 'official has no reputation points');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select accept_task(:'pothole');
select submit_resolution(:'pothole', 'Properly re-done', 23.80700, 90.36900, 5, '[{"path":"00000000-0000-0000-0000-000000000009/after2.jpg","type":"image"}]');
select pg_temp.expect_error($$select review_resolution('$$||:'pothole'||$$', true)$$, 'OWN_TASK');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select review_resolution(:'pothole', true) as after_reporter_confirms;
select pg_temp.expect_error($$select rate_volunteer('$$||:'pothole'||$$', 5, 'thanks')$$, 'NOT_RATEABLE');
select pg_temp.as_user(null);
select short_name, escalated, resolved, open, overdue from authority_record_v where short_name = 'DNCC';

\echo '--- 4. Downed power line: its category sends a live wire to the City Corporation'
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select create_issue('Live wire hanging over footpath','','downed_power_line', 23.8100, 90.3700, 5,'gps','',false,
  '[{"path":"00000000-0000-0000-0000-000000000002/w.jpg","type":"image"}]', true, 'small') as wire \gset
select pg_temp.check((select route = 'authority' and severity = 'critical' from issues_v where id = :'wire'), 'goes to the City Corporation, critical');

\echo '--- 5. Garbage: its category sends it to volunteers'
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select create_issue('Garbage pile behind the market','','garbage', 23.8075, 90.3695, 5,'gps','',false,
  '[{"path":"00000000-0000-0000-0000-000000000003/g.jpg","type":"image"}]', true) as garbage \gset
select pg_temp.check((select route = 'community' and route_source = 'category' from issues_v where id = :'garbage'), 'routed to volunteers by its category');
select pg_temp.validate(:'garbage');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select admin_set_route('$$||:'garbage'||$$', 'authority', '')$$, 'REASON_REQUIRED');
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select pg_temp.check((select count(*) = 1 from get_open_tasks() where id = :'garbage'), 'now on the volunteer board');

\echo '--- 6. Team task: leader + 2 members, only the member who checked in is rewarded'
select pg_temp.expect_error($$select accept_task('$$||:'garbage'||$$', 3)$$, 'CANT_LEAD_TEAM');
reset role; update profiles set tasks_completed = 1, reputation = 10 where username = 'vol1';
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select accept_task(:'garbage', 3);
select pg_temp.as_user('00000000-0000-0000-0000-000000000006'); select set_volunteer_mode(true); select join_team(:'garbage');
select pg_temp.as_user('00000000-0000-0000-0000-000000000007'); select set_volunteer_mode(true); select join_team(:'garbage');
select pg_temp.expect_error($$select join_team('$$||:'garbage'||$$')$$, 'ALREADY_IN_TEAM');
select pg_temp.as_user('00000000-0000-0000-0000-000000000004'); select set_volunteer_mode(true);
select pg_temp.expect_error($$select join_team('$$||:'garbage'||$$')$$, 'TEAM_FULL');
select pg_temp.as_user('00000000-0000-0000-0000-000000000006');
select pg_temp.expect_error($$select check_in('$$||:'garbage'||$$', 23.75, 90.39, 5)$$, 'TOO_FAR');
select check_in(:'garbage', 23.8075, 90.3695, 5);
select pg_temp.as_user(null);
select username, is_leader, checked_in_at is not null as checked_in from get_team(:'garbage');
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select submit_resolution(:'garbage', 'Cleared with the team', 23.8075, 90.3695, 5, '[{"path":"00000000-0000-0000-0000-000000000005/after.jpg","type":"image"}]');
select pg_temp.as_user('00000000-0000-0000-0000-000000000006');
select pg_temp.expect_error($$select review_resolution('$$||:'garbage'||$$', true)$$, 'OWN_TASK');
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select review_resolution(:'garbage', true);
reset role;
select pg_temp.check((select reputation = 20 from profiles where username = 'vol1'), 'leader +10');
select pg_temp.check((select reputation = 10 from profiles where username = 'vol2'), 'checked-in member +10');
select pg_temp.check((select reputation = 0 from profiles where username = 'vol3'), 'member who never came gets 0');

\echo '--- 7. "Needs City Corporation": rejected, then approved'
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
select create_issue('Construction debris dumped on the lane','','illegal_dumping', 23.8072, 90.3692, 5,'gps','',false,
  '[{"path":"00000000-0000-0000-0000-000000000004/d.jpg","type":"image"}]', true, 'large') as dump \gset
select pg_temp.validate(:'dump');
select pg_temp.as_user('00000000-0000-0000-0000-000000000006');
select accept_task(:'dump');
select pg_temp.expect_error($$select release_task('$$||:'dump'||$$', 'too big', 'needs_authority', '[{"path":"00000000-0000-0000-0000-000000000006/x.jpg","type":"image"}]')$$, 'NOTE_REQUIRED');
select pg_temp.expect_error($$select release_task('$$||:'dump'||$$', 'About 5 tonnes, needs a truck', 'needs_authority', '[]')$$, 'MEDIA_REQUIRED');
select release_task(:'dump', 'About 5 tonnes, needs a truck', 'needs_authority', '[{"path":"00000000-0000-0000-0000-000000000006/x.jpg","type":"image"}]');
select pg_temp.check((select status = 'under_review' from issues_v where id = :'dump'), 'waiting for the admin, not back in the pool');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_decide_escalation(:'dump', false, 'Photo shows a small pile, two people can clear it');
select pg_temp.as_user('00000000-0000-0000-0000-000000000006');
select pg_temp.expect_error($$select accept_task('$$||:'dump'||$$')$$, 'RECENTLY_ESCALATED');
select pg_temp.check((select reputation = 10 from profiles where username = 'vol2'), 'one rejected request costs nothing');
select pg_temp.as_user('00000000-0000-0000-0000-000000000007');
select accept_task(:'dump');
select release_task(:'dump', 'Pile is taller than me, needs machinery', 'needs_authority', '[{"path":"00000000-0000-0000-0000-000000000007/y.jpg","type":"image"}]');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_decide_escalation(:'dump', true, 'Second volunteer confirms, needs a truck');
select pg_temp.check((select status = 'escalated' and authority_short_name = 'DNCC' from issues_v where id = :'dump'), 'escalated to DNCC');

\echo '--- 8. Admin moves it back to volunteers; the official working on it ends with no penalty'
select pg_temp.as_user('00000000-0000-0000-0000-000000000009'); select accept_task(:'dump');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_set_route(:'dump', 'community', 'DNCC says a local cleanup drive is enough');
reset role;
select pg_temp.check((select status = 'validated' and route = 'community' and authority_id is null from issues where id = :'dump'), 'open for volunteers again');
select pg_temp.check((select outcome = 'rerouted' from assignments where issue_id = :'dump' order by id desc limit 1), 'official''s task ended as re-routed');

\echo '--- 9. "Issue is wrong" that turns out to be a lie costs 5'
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select accept_task(:'dump');
select release_task(:'dump', 'Nothing here any more, it is gone', 'wrong_issue', '[{"path":"00000000-0000-0000-0000-000000000005/z.jpg","type":"image"}]', 'already_fixed');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_decide_wrong_report(:'dump', 'lie', 'Neighbours sent photos from today, it is still there');
reset role;
select pg_temp.check((select reputation = 15 from profiles where username = 'vol1'), 'false "already fixed" claim −5');

\echo '--- 10. Maintenance: overdue City Corporation issue and a stuck volunteer issue'
update issues set due_at = now() - interval '1 day' where id = :'wire';
update issues set status = 'escalated', authority_id = (select id from authorities where short_name = 'DNCC') where id = :'wire';
update issues set validated_at = now() - interval '20 days' where id = :'dump';
update assignments set ended_at = now() - interval '20 days' where issue_id = :'dump';
select run_maintenance() as maintenance;
select pg_temp.check((select is_overdue from issues_v where id = :'wire'), 'shown as overdue');
select pg_temp.check((select count(*) = 1 from issue_events where issue_id = :'wire' and type = 'overdue'), 'overdue logged once');
select run_maintenance() as maintenance_again;
select pg_temp.check((select count(*) = 1 from issue_events where issue_id = :'wire' and type = 'overdue'), 'not repeated');
select pg_temp.check((select count(*) = 1 from review_items where issue_id = :'dump' and kind = 'stuck' and status = 'open'), 'stuck issue sent to the admin');

\echo '--- 11. Emergency: published at once, false alert hidden by neighbours (who must be on site)'
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select create_emergency_alert('fire', 'Smoke from the 3rd floor', 23.8071, 90.3691, 'Mirpur 10 market') as fire \gset
reset role;
select pg_temp.check((select count(*) = 14 from notifications n where n.alert_id = :'fire' and n.type = 'emergency'), 'everyone nearby notified (not the reporter)');
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select create_emergency_alert('gas_leak', '', 23.8071, 90.3691, 'Mirpur 10');
select pg_temp.expect_error($$select create_emergency_alert('fire', '', 23.8071, 90.3691, '')$$, 'RATE_LIMIT');
select pg_temp.expect_error($$select respond_emergency('$$||:'fire'||$$', 'confirm', p_seen => 'fire')$$, 'OWN_ALERT');
select pg_temp.as_user('00000000-0000-0000-0000-000000000013'); select respond_emergency(:'fire', 'deny', 23.8071, 90.3691, 10);
select pg_temp.as_user('00000000-0000-0000-0000-000000000014'); select respond_emergency(:'fire', 'deny', 23.8071, 90.3691, 10);
select pg_temp.as_user('00000000-0000-0000-0000-000000000016');
select pg_temp.expect_error($$select respond_emergency('$$||:'fire'||$$', 'deny')$$, 'NOT_NEARBY');
select pg_temp.as_user('00000000-0000-0000-0000-000000000015'); select respond_emergency(:'fire', 'deny', 23.8071, 90.3691, 10) as status_after_3_denials;
reset role;
select pg_temp.check((select reputation = -10 from profiles where username = 'salma'), 'false alert costs the reporter 10');
select pg_temp.as_user(null);
select pg_temp.check((select count(*) = 1 from get_active_alerts()), 'only the real alert stays active');

\echo '--- 12. Security: views work for visitors, private tables stay closed'
select pg_temp.as_user(null);
select pg_temp.check((select count(*) > 0 from get_feed()), 'visitors can read the feed');
select pg_temp.check((select (area_heat_summary(23.8100, 90.3700, 500)->>'active')::int >= 1), 'map area summary works for visitors and counts City Corporation issues');
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin perform 1 from review_items; raise notice 'FAIL: could read the review queue';
exception when insufficient_privilege then raise notice 'ok  review queue not readable'; end $$;
select pg_temp.expect_error($$select get_review_queue()$$, 'NOT_ADMIN');

\echo '--- Admin log'
reset role;
select a.username, l.action, l.reason from admin_actions l join profiles a on a.id = l.admin_id order by l.id;
