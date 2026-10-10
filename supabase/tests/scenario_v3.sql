-- End-to-end test of migration 0011: "still there?" check, never-volunteer
-- categories, bounded reopen loop, route lock, other agencies, related
-- duplicate categories. Run with supabase/tests/run_local.sh
\set ON_ERROR_STOP 1
\pset pager off
set search_path = public, extensions;

insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','rahim@x.com','{"username":"rahim"}'),
 ('00000000-0000-0000-0000-000000000005','vol1@x.com','{"username":"vol1"}'),
 ('00000000-0000-0000-0000-000000000006','vol2@x.com','{"username":"vol2"}'),
 ('00000000-0000-0000-0000-000000000007','vol3@x.com','{"username":"vol3"}'),
 ('00000000-0000-0000-0000-000000000008','admin@x.com','{"username":"admin1"}'),
 ('00000000-0000-0000-0000-000000000009','officer@x.com','{"username":"dncc_officer"}'),
 ('00000000-0000-0000-0000-000000000020','far@x.com','{"username":"far_away"}');
insert into auth.users (id, email, raw_user_meta_data)
 select ('00000000-0000-0000-0000-00000000001'||n)::uuid, 'n'||n||'@x.com', jsonb_build_object('username','neighbour'||n) from generate_series(1,6) n;
update profiles set created_at = now() - interval '30 days';
update user_settings set home_location = make_point(23.8070, 90.3690);              -- everyone lives in Mirpur…
update user_settings set home_location = make_point(22.3569, 91.7832)               -- …except one person in Chattogram
 where user_id = '00000000-0000-0000-0000-000000000020';
update app_settings set max_reports_per_day = 100;  -- one test user files every report
insert into user_roles (user_id, role) values ('00000000-0000-0000-0000-000000000008', 'admin');
insert into user_roles (user_id, role, authority_id)
  select '00000000-0000-0000-0000-000000000009', 'official', id from authorities where short_name = 'DNCC';

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text,''), false);
      execute case when p is null then 'set role anon' else 'set role authenticated' end; end $$;
-- An official request as the sign-up page makes it (0057: citizens can't ask from Settings any more).
create or replace function pg_temp.request_official(p_user uuid, p_authority uuid, p_designation text, p_office text) returns void language plpgsql as $$
begin insert into role_requests (user_id, authority_id, designation, office) values (p_user, p_authority, p_designation, p_office);
      perform notify_city_or_super_admins(p_authority, 'role_request', null, p_user, 'Test request'); end $$;
create or replace function pg_temp.expect_error(p_sql text, p_hint text) returns text language plpgsql as $$
declare h text;
begin execute p_sql; return 'FAIL: no error (expected ' || p_hint || ')';
exception when others then get stacked diagnostics h = pg_exception_hint;
  return case when h = p_hint then 'ok  ' || p_hint else 'FAIL: got ' || coalesce(h,'?') || ' / ' || sqlerrm end; end $$;
create or replace function pg_temp.check(p_ok boolean, p_what text) returns text language sql as $$
  select case when p_ok then 'ok  ' || p_what else 'FAIL: ' || p_what end $$;
create or replace function pg_temp.validate(p_issue uuid) returns void language plpgsql as $$
declare v issues_v;
begin  -- two neighbours confirm, standing at the issue
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000011');
  select * into v from issues_v where id = p_issue;
  perform confirm_issue(p_issue, v.lat, v.lng, 5, '', '[{"path":"00000000-0000-0000-0000-000000000011/c.jpg","type":"image"}]');
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000012');
  perform confirm_issue(p_issue, v.lat, v.lng, 5, '', '[{"path":"00000000-0000-0000-0000-000000000012/c.jpg","type":"image"}]');
end $$;
create or replace function pg_temp.report(p_title text, p_category text, p_lat double precision, p_lng double precision)
returns uuid language plpgsql as $$
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000001');
  return create_issue(p_title, '', p_category, p_lat, p_lng, 5, 'gps', '', false,
    '[{"path":"00000000-0000-0000-0000-000000000001/x.jpg","type":"image"}]', true, 'medium');
end $$;
create or replace function pg_temp.fix(p_volunteer uuid, p_issue uuid) returns void language plpgsql as $$
declare v issues_v;
begin  -- accept and submit a fix on the spot
  perform pg_temp.as_user(p_volunteer);
  select * into v from issues_v where id = p_issue;
  perform accept_task(p_issue);
  perform submit_resolution(p_issue, 'Cleaned it up', v.lat, v.lng, 5,
    format('[{"path":"%s/after.jpg","type":"image"}]', p_volunteer)::jsonb);
end $$;

select pg_temp.as_user('00000000-0000-0000-0000-000000000005'); select set_volunteer_mode(true);
select pg_temp.as_user('00000000-0000-0000-0000-000000000006'); select set_volunteer_mode(true);
select pg_temp.as_user('00000000-0000-0000-0000-000000000007'); select set_volunteer_mode(true);

\echo '--- 1. "Still there?": a quiet issue is asked about, two neighbours say it is gone, it closes'
select pg_temp.report('Garbage pile near the school', 'garbage', 23.8070, 90.3690) as stale \gset
select pg_temp.validate(:'stale');
reset role;
update issues set last_activity_at = now() - interval '20 days' where id = :'stale';
select pg_temp.check(run_stale_checks() = 1, 'quiet issue asked about');
select pg_temp.check(run_stale_checks() = 0, 'not asked twice');
select pg_temp.check((select count(*) >= 1 from notifications where issue_id = :'stale' and type = 'still_there_check'), 'followers notified');
select pg_temp.as_user('00000000-0000-0000-0000-000000000020');
select pg_temp.expect_error($$select answer_still_there('$$||:'stale'||$$', false)$$, 'NOT_NEARBY');
select pg_temp.as_user('00000000-0000-0000-0000-000000000011');
select pg_temp.check(answer_still_there(:'stale', false) = 'recorded', 'one "gone" is not enough');
select pg_temp.check((get_still_there(:'stale')->>'gone')::int = 1 and (get_still_there(:'stale')->>'my_answer')::boolean = false, 'answer shown back');
select pg_temp.as_user('00000000-0000-0000-0000-000000000012');
select pg_temp.check(answer_still_there(:'stale', false) = 'closed', 'second "gone" closes it');
reset role;
select pg_temp.check((select status = 'closed' from issues where id = :'stale'), 'closed');
select pg_temp.check((select data->>'reason' = 'confirmed_gone' from issue_events where issue_id = :'stale' and type = 'closed'), 'timeline says neighbours confirmed it is gone');
select pg_temp.check((select count(*) = 0 from heatmap_points(90.30, 23.70, 90.50, 23.90, null) p where p.lat between 23.8069 and 23.8071), 'off the heatmap');
select pg_temp.check((select sum(reputation) = 0 from profiles), 'nobody earns reputation for it');

\echo '--- 1b. "Still there" refreshes the issue instead'
select pg_temp.report('Overflowing bin at the bus stop', 'garbage', 23.8090, 90.3700) as stale2 \gset
select pg_temp.validate(:'stale2');
reset role;
update issues set last_activity_at = now() - interval '20 days' where id = :'stale2';
select run_stale_checks();
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select pg_temp.check(answer_still_there(:'stale2', true) = 'still_there', '"still there" recorded');
reset role;
select pg_temp.check((select stale_asked_at is null and last_activity_at > now() - interval '1 minute' and status = 'validated'
                      from issues where id = :'stale2'), 'refreshed and still open');

\echo '--- 2. Never-volunteer: dangerous categories always go to an authority'
select pg_temp.report('Live wire hanging over the footpath', 'downed_power_line', 23.8100, 90.3710) as wire \gset
reset role;
select pg_temp.check((select route = 'authority' from issues where id = :'wire'), 'dangerous report starts with the authority');
select pg_temp.report('Garbage beside the canal', 'garbage', 23.8110, 90.3720) as canal \gset
select pg_temp.validate(:'canal');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select admin_set_route('$$||:'canal'||$$', 'community', 'It is really a live wire', 'exposed_wiring')$$, 'UNSAFE_FOR_VOLUNTEERS');
select admin_set_route(:'canal', 'authority', 'It is really a live wire', 'exposed_wiring');
reset role;
select pg_temp.check((select route = 'authority' and status = 'escalated' and category = 'exposed_wiring' from issues where id = :'canal'),
                     'admin can still recategorise a dangerous issue and send it to the City Corporation');

\echo '--- 3. Bounded reopen: the reporter reopens alone only once'
select pg_temp.report('Dumped rubble on the road', 'illegal_dumping', 23.8130, 90.3730) as rubble \gset
select pg_temp.validate(:'rubble');
select pg_temp.fix('00000000-0000-0000-0000-000000000005', :'rubble');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.check(review_resolution(:'rubble', false) = 'validated', 'first dispute by the reporter reopens it');
select pg_temp.fix('00000000-0000-0000-0000-000000000006', :'rubble');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.check(review_resolution(:'rubble', false) = 'resolution_submitted', 'second dispute alone does not reopen it');
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select pg_temp.check(review_resolution(:'rubble', false) = 'validated', 'reporter + a neighbour reopen it');
reset role;
select pg_temp.check((select count(*) = 1 from review_items where issue_id = :'rubble' and kind = 'stuck' and status = 'open'),
                     'after 2 disputed fixes the admin is asked to look');
select pg_temp.fix('00000000-0000-0000-0000-000000000007', :'rubble');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.check(review_resolution(:'rubble', true) = 'closed', 'the reporter can still accept a fix alone');

\echo '--- 4. Route lock: after an admin moves an issue, no ping-pong'
select pg_temp.report('Overflowing garbage at the corner', 'garbage', 23.8150, 90.3740) as corner \gset
select pg_temp.validate(:'corner');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_set_route(:'corner', 'authority', 'Needs a garbage truck');
reset role;
select pg_temp.check((select route_locked_until > now() + interval '29 days' from issues where id = :'corner'), 'locked for 30 days');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select pg_temp.expect_error($$select request_send_back('$$||:'corner'||$$', 'Volunteers can clean this themselves')$$, 'ROUTE_LOCKED');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_set_route(:'corner', 'community', 'Changed my mind after the site visit');
reset role;
select pg_temp.check((select route = 'community' and status = 'validated' from issues where id = :'corner'), 'the admin can still move it');

\echo '--- 5. Other agencies: never receive issues by area, only by referral'
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_save_authority(null, 'Dhaka Electric Supply Company', 'DESCO',
  '{"type":"Polygon","coordinates":[[[90.30,23.70],[90.50,23.70],[90.50,23.95],[90.30,23.95],[90.30,23.70]]]}',
  '16120', '', '[]', 1, 2, 5, 10, true, 'agency') as desco \gset
select pg_temp.report('Streetlight pole sparking', 'streetlight', 23.8170, 90.3750) as pole \gset
select pg_temp.validate(:'pole');
reset role;
select pg_temp.check((select a.short_name = 'DNCC' from issues i join authorities a on a.id = i.authority_id where i.id = :'pole'),
                     'escalated to the City Corporation, not the agency');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select pg_temp.expect_error($$select admin_refer_issue('$$||:'pole'||$$', '$$||:'desco'||$$', 'Power line')$$, 'NOT_ADMIN');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_refer_issue(:'pole', :'desco', 'The sparks come from the power line, not the lamp');
reset role;
select pg_temp.check((select authority_id = :'desco' and status = 'escalated' and severity = 'medium'
                             and due_at between now() + interval '4 days' and now() + interval '6 days'
                      from issues where id = :'pole'), 'referred to DESCO with DESCO''s own target time (5 days, not DNCC''s 14)');
select pg_temp.check((select count(*) = 1 from issue_events where issue_id = :'pole' and type = 'referred'), 'referral on the timeline');
select pg_temp.check((select kind = 'agency' from authorities_v where short_name = 'DESCO'), 'agency visible in the authorities list');

\echo '--- 6. Related categories count as duplicates'
select pg_temp.report('Garbage heap by the mosque', 'garbage', 23.8190, 90.3760) as heap \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select pg_temp.check((select count(*) = 1 from find_nearby_duplicates(23.81905, 90.37605, 'illegal_dumping') d where d.id = :'heap'),
                     '"illegal dumping" finds the nearby garbage report');
select pg_temp.check((select count(*) = 0 from find_nearby_duplicates(23.81905, 90.37605, 'pothole') d where d.id = :'heap'),
                     'an unrelated category does not');

\echo '--- 7. Admin category form: the new rules can be set, but not contradict each other'
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select admin_save_category('open_manhole', 'Open Manhole', '', 'triangle-alert', '#dc2626', 'community', 'critical', 11, true, false, null)$$, 'UNSAFE_FOR_VOLUNTEERS');
select admin_save_category('open_manhole', 'Open Manhole', 'খোলা ম্যানহোল', 'triangle-alert', '#dc2626', 'authority', 'critical', 11, true, false, 'Drain Covers');
reset role;
select pg_temp.check((select not volunteer_allowed and duplicate_group = 'drain_covers' from categories where slug = 'open_manhole'), 'saved with both rules');

\echo '--- 8. An issue that becomes dangerous while with volunteers goes to the City Corporation'
-- a) the admin sent it to volunteers, then it is recategorised as an open manhole
select pg_temp.report('Something blocking the lane', 'garbage', 23.8210, 90.3770) as lane \gset
select pg_temp.validate(:'lane');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_set_route(:'lane', 'community', 'Volunteers can clear it');
reset role;
select change_issue_category(:'lane', 'open_manhole', '00000000-0000-0000-0000-000000000008', 'Photo shows an open manhole');
select pg_temp.check((select status = 'escalated' and route = 'authority' from issues where id = :'lane'),
                     'admin-routed issue moves to the City Corporation when it turns out to be dangerous');
select pg_temp.check((select count(*) = 1 from issue_events where issue_id = :'lane' and type = 'escalated'), 'escalated exactly once');

-- b) a volunteer is already working on it: told to stop, no penalty
select pg_temp.report('Bags piled at the junction', 'garbage', 23.8230, 90.3780) as junction \gset
select pg_temp.validate(:'junction');
select pg_temp.as_user('00000000-0000-0000-0000-000000000007');
select accept_task(:'junction');
reset role;
select reputation as rep_before from profiles where username = 'vol3' \gset
select change_issue_category(:'junction', 'exposed_wiring', '00000000-0000-0000-0000-000000000008', 'Live wires under the bags');
select pg_temp.check((select status = 'escalated' and volunteer_id is null from issues where id = :'junction'), 'taken off the volunteer and escalated');
select pg_temp.check((select outcome = 'rerouted' from assignments where issue_id = :'junction' order by id desc limit 1), 'assignment ended as re-routed');
select pg_temp.check((select count(*) = 1 from notifications n join profiles p on p.id = n.user_id
                       where n.issue_id = :'junction' and p.username = 'vol3' and n.message like 'Please stop work%'), 'volunteer told to stop');
select pg_temp.check((select reputation = :rep_before from profiles where username = 'vol3'), 'no penalty');

-- c) back in the volunteer pool after the admin rejects an escalation request
select pg_temp.report('Rubbish in the drain mouth', 'garbage', 23.8250, 90.3790) as drainmouth \gset
select pg_temp.validate(:'drainmouth');
select pg_temp.as_user('00000000-0000-0000-0000-000000000006');
select accept_task(:'drainmouth');
select release_task(:'drainmouth', 'The cover is missing, it is a deep hole', 'needs_authority',
  '[{"path":"00000000-0000-0000-0000-000000000006/hole.jpg","type":"image"}]');
reset role;
update issues set category = 'open_manhole' where id = :'drainmouth';  -- e.g. an admin category decision
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_decide_escalation(:'drainmouth', false, 'Volunteers can clear rubbish');
reset role;
select pg_temp.check((select status = 'escalated' from issues where id = :'drainmouth'),
                     'rejected request does not put a dangerous issue back with volunteers');

-- d) fire hazards are authority work
select pg_temp.report('Gas cylinders stacked next to a stove stall', 'fire_hazard', 23.8270, 90.3800) as fire \gset
reset role;
select pg_temp.check((select route = 'authority' from issues where id = :'fire'), 'fire hazard goes to the authority');
select pg_temp.check((select not volunteer_allowed from categories where slug = 'fire_hazard'), 'fire hazard marked too dangerous for volunteers');

\echo '--- 9. Spam has consequences: −10 per hidden report, 3 in 30 days pause posting'
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000030','spam@x.com','{"username":"spammer"}');
update profiles set created_at = now() - interval '30 days' where username = 'spammer';
update user_settings set home_location = make_point(23.8070, 90.3690) where user_id = '00000000-0000-0000-0000-000000000030';
create or replace function pg_temp.spam(p_title text, p_lat double precision) returns uuid language plpgsql as $$
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000030');
  return create_issue(p_title, '', 'garbage', p_lat, 90.3900, 5, 'gps', '', false,
    '[{"path":"00000000-0000-0000-0000-000000000030/x.jpg","type":"image"}]', true, 'medium');
end $$;
create or replace function pg_temp.flag5(p_issue uuid) returns void language plpgsql as $$
declare n int;
begin  -- five neighbours flag it as fake
  for n in 1..5 loop
    perform pg_temp.as_user(('00000000-0000-0000-0000-00000000001' || n)::uuid);
    perform flag_issue(p_issue, 'fake_or_scam', '');
  end loop;
end $$;
select pg_temp.spam('Free iPhone giveaway at the corner', 23.7900) as spam1 \gset
select pg_temp.flag5(:'spam1');
reset role;
select pg_temp.check((select status = 'hidden' from issues where id = :'spam1'), 'spam hidden by flags');
select pg_temp.check((select reputation = -10 from profiles where username = 'spammer'), 'reporter loses 10 reputation');
select pg_temp.spam('Buy cheap land here, call now', 23.7920) as spam2 \gset
select pg_temp.flag5(:'spam2');
select pg_temp.spam('Visit my shop for discounts', 23.7940) as spam3 \gset
select pg_temp.flag5(:'spam3');
reset role;
select pg_temp.check((select reputation = -30 from profiles where username = 'spammer'), 'three hidden reports: −30');
select pg_temp.check((select count(*) = 1 from notifications n where n.type = 'posting_paused'
                       and n.user_id = '00000000-0000-0000-0000-000000000030'), 'told about the posting pause');
select pg_temp.as_user('00000000-0000-0000-0000-000000000030');
select pg_temp.check(get_my_posting_pause() > now() + interval '6 days', 'paused for 7 days');
select pg_temp.expect_error($$select pg_temp.spam('Another ad', 23.7960)$$, 'POSTING_PAUSED');
select pg_temp.check((toggle_vote(:'stale2') ->> 'voted')::boolean, 'can still vote while paused');

\echo '--- 10. A hidden report that is real comes back, with its reputation'
-- six locals vouch for spam1 (weight 6 × 1.5 = 9 > five flags at 7.5).
-- Admins and officials don't vote (0031), so two more residents join in.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000041','local1@x.com','{"username":"local1"}'),
 ('00000000-0000-0000-0000-000000000042','local2@x.com','{"username":"local2"}');
update profiles set created_at = now() - interval '30 days' where username in ('local1', 'local2');
update user_settings set home_location = make_point(23.8070, 90.3690)
 where user_id in ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001'); select toggle_vote(:'spam1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000005'); select toggle_vote(:'spam1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000006'); select toggle_vote(:'spam1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000007'); select toggle_vote(:'spam1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000041'); select toggle_vote(:'spam1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000042'); select toggle_vote(:'spam1');
reset role;
select pg_temp.check((select status <> 'hidden' from issues where id = :'spam1'), 'visible again');
select pg_temp.check((select reputation = -20 from profiles where username = 'spammer'), '10 reputation given back');
select pg_temp.as_user('00000000-0000-0000-0000-000000000030');
select pg_temp.check(get_my_posting_pause() is null, 'pause lifted (only 2 hidden now)');

\echo '--- 11. Admin hides stay hidden; the reporter can appeal once'
select pg_temp.report('Overflowing bin behind the clinic', 'garbage', 23.8290, 90.3810) as clinic \gset
select pg_temp.validate(:'clinic');
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select accept_task(:'clinic');
select release_task(:'clinic', 'There is no bin here at all, I checked', 'wrong_issue',
  '[{"path":"00000000-0000-0000-0000-000000000005/none.jpg","type":"image"}]', 'fake');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_decide_wrong_report(:'clinic', 'hide', 'Checked on site: nothing there');
select pg_temp.as_user('00000000-0000-0000-0000-000000000013'); select toggle_vote(:'clinic');
reset role;
select pg_temp.check((select status = 'hidden' and hidden_by_admin from issues where id = :'clinic'),
                     'an upvote does not undo an admin''s hide');
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select pg_temp.expect_error($$select appeal_hidden_issue('$$||:'clinic'||$$', 'It really is there, behind the wall')$$, 'FORBIDDEN');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select appeal_hidden_issue('$$||:'clinic'||$$', 'real')$$, 'NOTE_REQUIRED');
select appeal_hidden_issue(:'clinic', 'The bin is behind the clinic wall, the volunteer looked in front');
select pg_temp.expect_error($$select appeal_hidden_issue('$$||:'clinic'||$$', 'Please check again, it is there')$$, 'ALREADY_APPEALED');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.check((select count(*) = 1 from get_review_queue() where kind = 'appeal'), 'appeal waiting in the admin queue');
select admin_decide_appeal(:'clinic', true, 'Second visit: the bin is behind the wall');
reset role;
select pg_temp.check((select status = 'validated' and not hidden_by_admin from issues where id = :'clinic'), 'restored by the admin');
select pg_temp.check((select reputation = 0 from profiles where username = 'rahim'), 'reporter''s 10 reputation given back');

\echo '--- 12. Flag accuracy: people who keep flagging real issues count less'
select pg_temp.as_user('00000000-0000-0000-0000-000000000016');
select flag_issue(:'lane', 'fake_or_scam', '');
select flag_issue(:'junction', 'fake_or_scam', '');
select flag_issue(:'stale2', 'spam', '');
reset role;
select flags.weight as before_weight from flags where user_id = '00000000-0000-0000-0000-000000000016' and issue_id = :'lane' \gset
select pg_temp.report('Pile of rubbish near the pond', 'garbage', 23.8310, 90.3820) as pond \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000016');
select flag_issue(:'pond', 'fake_or_scam', '');
reset role;
select pg_temp.check((select weight <= :before_weight * 0.25 + 0.01 from flags
                       where user_id = '00000000-0000-0000-0000-000000000016' and issue_id = :'pond'),
                     'after 3 wrong flags on validated issues, a new flag counts a quarter');
select pg_temp.check((select weight = :before_weight from flags
                       where user_id = '00000000-0000-0000-0000-000000000016' and issue_id = :'lane'), 'earlier flags unchanged');

\echo '--- 13. Not knowing where someone is no longer halves their vote'
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000031','nohome@x.com','{"username":"no_home"}');
update profiles set created_at = now() - interval '30 days' where username = 'no_home';  -- home area never set
-- about 0.4 km from the Mirpur homes
select pg_temp.report('Broken drain cover near the bazaar', 'garbage', 23.8100, 90.3720) as bazaar \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000031'); select toggle_vote(:'bazaar');            -- no GPS, no home
select pg_temp.as_user('00000000-0000-0000-0000-000000000020'); select toggle_vote(:'bazaar');            -- lives in Chattogram
select pg_temp.as_user('00000000-0000-0000-0000-000000000014'); select toggle_vote(:'bazaar');            -- lives in Mirpur
reset role;
select pg_temp.check((select weight = 1.00 from votes v join profiles p on p.id = v.user_id where v.issue_id = :'bazaar' and p.username = 'no_home'),
                     'unknown location counts normally (1.0)');
select pg_temp.check((select weight = 0.50 from votes v join profiles p on p.id = v.user_id where v.issue_id = :'bazaar' and p.username = 'far_away'),
                     'far away still counts half (0.5)');
select pg_temp.check((select weight = 1.50 from votes v join profiles p on p.id = v.user_id where v.issue_id = :'bazaar' and p.username = 'neighbour4'),
                     'neighbour still counts 1.5');

\echo '--- 14. Hexagons stay in place while the map moves'
-- 30 serious issues in one spot, so a hexagon has more than the 20 listed
insert into issues (reporter_id, title, category, severity, location, status, validated_at, route, confirmation_count, upvote_count)
select '00000000-0000-0000-0000-000000000001', 'Cluster issue ' || g, 'garbage',
       (array['low','medium','high','critical'])[1 + g % 4]::severity_level,
       make_point(23.8150 + (g % 6) * 0.0001, 90.3750 + (g / 6) * 0.0001), 'validated', now(), 'community', g % 3, g
from generate_series(1, 30) g;
with a as (select hex from heatmap_hex(90.35, 23.78, 90.40, 23.83, 400, null)),
     b as (select hex from heatmap_hex(90.35, 23.79, 90.40, 23.84, 400, null))
select pg_temp.check((select count(*) from a join b using (hex)) > 0
                     and (select count(*) from a join b using (hex)) =
                         (select count(*) from a where ST_Y(ST_Centroid(ST_GeomFromGeoJSON(hex::text))) between 23.79 and 23.83),
                     'after panning 1 km north every hexagon in the overlap is identical');

\echo '--- 15. A hexagon lists its most serious issues, with the exact total'
select pg_temp.as_user(null);  -- logged-out visitor
with cells as (select * from heatmap_hex(90.30, 23.75, 90.45, 23.85, 400, null))
select pg_temp.check(bool_and(issue_count = (select max(total) from hex_issues(c.hex, 400, null, 20))),
                     'every hexagon''s total equals the number on the map') from cells c;
with big as (select hex, issue_count from heatmap_hex(90.30, 23.75, 90.45, 23.85, 400, null) order by issue_count desc limit 1)
select pg_temp.check((select count(*) from hex_issues(big.hex, 400, null, 20)) = 20 and big.issue_count > 20,
                     'a busy hexagon lists 20 of ' || big.issue_count) from big;
reset role;
with big as (select hex from heatmap_hex(90.30, 23.75, 90.45, 23.85, 400, null) order by issue_count desc limit 1),
     l as (select severity, row_number() over () n from hex_issues((select hex from big), 400, null, 20))
select pg_temp.check(not exists (select 1 from l a join l b on b.n = a.n + 1 where severity_weight(b.severity) > severity_weight(a.severity)),
                     'most serious first');

\echo '--- 16. Residents vote; admins don''t, and officials don''t in their own area (0031)'
select pg_temp.report('Broken kerb near Gulshan 2', 'pothole', 23.7900, 90.4150) as role1 \gset
select pg_temp.report('Pothole in Old Dhaka', 'pothole', 23.7100, 90.4070) as south1 \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select toggle_vote('$$||:'role1'||$$')$$, 'ROLE_NOT_ALLOWED');
select pg_temp.expect_error($$select vote_severity('$$||:'role1'||$$', 'high')$$, 'ROLE_NOT_ALLOWED');
select pg_temp.expect_error($$select flag_issue('$$||:'role1'||$$', 'fake_or_scam', '')$$, 'ROLE_NOT_ALLOWED');
select pg_temp.expect_error($$select confirm_issue('$$||:'role1'||$$', 23.7900, 90.4150, 5, '',
  '[{"path":"00000000-0000-0000-0000-000000000008/c.jpg","type":"image"}]')$$, 'ROLE_NOT_ALLOWED');
select pg_temp.expect_error($$select set_volunteer_mode(true)$$, 'ROLE_NOT_ALLOWED');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select pg_temp.expect_error($$select toggle_vote('$$||:'role1'||$$')$$, 'ROLE_NOT_ALLOWED');
select pg_temp.check((toggle_vote(:'south1') ->> 'voted')::boolean, 'a DNCC official can still vote on a DSCC issue');
select pg_temp.expect_error($$select set_volunteer_mode(true)$$, 'ROLE_NOT_ALLOWED');
select pg_temp.check((select my_authority_covers from issues_v where id = :'role1')
                     and not (select my_authority_covers from issues_v where id = :'south1'),
                     'the page knows which issues are in the official''s area');
reset role;
select pg_temp.expect_error($$insert into emergency_alerts (reporter_id, kind, location, notify_radius_m, expires_at)
  values ('00000000-0000-0000-0000-000000000008', 'fire', make_point(23.79, 90.41), 1000, now() + interval '6 hours')$$,
  'ROLE_NOT_ALLOWED');
-- becoming an official ends volunteer mode
select pg_temp.as_user('00000000-0000-0000-0000-000000000042'); select set_volunteer_mode(true);
reset role;
select pg_temp.request_official('00000000-0000-0000-0000-000000000042', (select id from authorities where short_name = 'DSCC'), 'Conservancy Inspector', 'Zone 5');
-- Officials are verified by their area admin, never by a super admin (0061). A DNCC area admin
-- is appointed just for this and removed again, so the rest of the scenario is unchanged.
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-000000000099', 'ca@x.com', '{"username":"tmp_area_admin"}');
insert into user_roles (user_id, role, authority_id) values ('00000000-0000-0000-0000-000000000099', 'city_admin', (select id from authorities where short_name = 'DSCC'));
select pg_temp.as_user('00000000-0000-0000-0000-000000000099');
select admin_decide_role_request((select id from get_role_requests() where username = 'local2'), true, 'Checked staff ID');
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-000000000099';
reset role;
select pg_temp.check((select not is_volunteer from profiles where username = 'local2'), 'a new official is no longer a volunteer');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');

\echo '--- 17. "The report is real" sends a City Corporation issue back to its queue'
select pg_temp.report('Pothole outside the bank', 'pothole', 23.7910, 90.4160) as real1 \gset
select pg_temp.validate(:'real1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select accept_task(:'real1');
select release_task(:'real1', 'Already repaired by a contractor', 'wrong_issue',
  '[{"path":"00000000-0000-0000-0000-000000000009/w1.jpg","type":"image"}]', 'already_fixed');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_decide_wrong_report(:'real1', 'lie', 'The photo shows the hole is still there');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select pg_temp.check((select count(*) = 1 from get_authority_tasks('new') where id = :'real1'), 'back in DNCC''s New list');
select accept_task(:'real1');
select pg_temp.check((select status = 'assigned' from issues_v where id = :'real1'), 'an official can take it again');
-- hidden, appealed, restored
select pg_temp.report('Pothole by the mosque gate', 'pothole', 23.7920, 90.4170) as real2 \gset
select pg_temp.validate(:'real2');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select accept_task(:'real2');
select release_task(:'real2', 'No pothole at this spot at all', 'wrong_issue',
  '[{"path":"00000000-0000-0000-0000-000000000009/w2.jpg","type":"image"}]', 'wrong_location');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_decide_wrong_report(:'real2', 'hide', 'Official photo shows no pothole');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select appeal_hidden_issue(:'real2', 'It is 20 m further down, by the gate');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_decide_appeal(:'real2', true, 'The reporter is right, it is by the gate');
reset role;
select pg_temp.check((select status = 'escalated' from issues where id = :'real2'), 'restored to the City Corporation, not to volunteers');

\echo '--- 18. Keeping an issue with the City Corporation keeps the official on it'
select pg_temp.report('Pothole at the bus stop', 'pothole', 23.7930, 90.4180) as keep1 \gset
select pg_temp.validate(:'keep1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select accept_task(:'keep1');
select request_send_back(:'keep1', 'Small hole, a few volunteers could fill it');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_set_route(:'keep1', 'authority', 'Keep with DNCC, it is a main road');
reset role;
select pg_temp.check((select status = 'assigned' and volunteer_id = '00000000-0000-0000-0000-000000000009' from issues where id = :'keep1'),
                     'the official keeps working on it');
select pg_temp.check((select count(*) = 0 from review_items where issue_id = :'keep1' and status = 'open'), 'request answered');

\echo '--- 19. Requests leave the queue when the issue is closed or taken; the public record'
select resolved as dncc_resolved from authority_record_v where short_name = 'DNCC' \gset
select pg_temp.report('Pothole near the school', 'pothole', 23.7940, 90.4190) as done1 \gset
select pg_temp.validate(:'done1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select accept_task(:'done1');
select request_send_back(:'done1', 'Volunteers could fill this with some cement');
select submit_resolution(:'done1', 'Filled and levelled', 23.7940, 90.4190, 5,
  '[{"path":"00000000-0000-0000-0000-000000000009/d1.jpg","type":"image"}]');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select review_resolution(:'done1', true);
reset role;
select pg_temp.check((select count(*) = 0 from review_items where issue_id = :'done1' and status = 'open'),
                     'a closed issue leaves the admin queue');
select pg_temp.check((select resolved = :dncc_resolved + 1 from authority_record_v where short_name = 'DNCC'),
                     'a fix by DNCC, confirmed by the reporter, counts as resolved');
select pg_temp.report('Pothole by the pharmacy', 'pothole', 23.7960, 90.4210) as gone1 \gset
select pg_temp.validate(:'gone1');
reset role;
select close_issue_gone(:'gone1', 2);
select pg_temp.check((select resolved = :dncc_resolved + 1 from authority_record_v where short_name = 'DNCC'),
                     'an issue neighbours closed as gone doesn''t count as DNCC''s fix');
select pg_temp.report('Rubbish heap at the corner', 'garbage', 23.7950, 90.4200) as stuck1 \gset
select pg_temp.validate(:'stuck1');
reset role;
update issues set validated_at = now() - interval '30 days' where id = :'stuck1';
select run_maintenance() is not null as maintenance_ran \gset
select pg_temp.check((select count(*) = 1 from review_items where issue_id = :'stuck1' and kind = 'stuck' and status = 'open'),
                     'flagged as stuck');
select pg_temp.as_user('00000000-0000-0000-0000-000000000041'); select set_volunteer_mode(true);
select accept_task(:'stuck1');
reset role;
select pg_temp.check((select count(*) = 0 from review_items where issue_id = :'stuck1' and kind = 'stuck' and status = 'open'),
                     '"Stuck" leaves the queue once a volunteer takes it');

\echo '--- 20. A new City Corporation picks up issues nobody covered'
select pg_temp.report('Pothole on CDA Avenue', 'pothole', 22.3500, 91.8200) as ctg1 \gset
select pg_temp.validate(:'ctg1');
reset role;
select pg_temp.check((select status = 'escalated' and authority_id is null from issues where id = :'ctg1'), 'waiting with no City Corporation');
select id as ctg_review from review_items where issue_id = :'ctg1' and kind = 'no_authority' and status = 'open' \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select admin_dismiss_review($$||:ctg_review||$$, 'Will add CCC later')$$, 'USE_DECISION');
select admin_save_authority(null, 'Chattogram City Corporation', 'CCC',
  '{"type":"Polygon","coordinates":[[[91.7,22.2],[91.95,22.2],[91.95,22.5],[91.7,22.5],[91.7,22.2]]]}', '16100', '', '[]',
  3, 7, 14, 30, true);
reset role;
select pg_temp.check((select authority_short_name = 'CCC' and due_at is not null from issues_v where id = :'ctg1'),
                     'sent to CCC as soon as its area was drawn');
select pg_temp.check((select status = 'resolved' from review_items where id = :ctg_review), '"No City Corporation" item cleared');

\echo '--- 21. Switched-off City Corporations, settings'
select pg_temp.report('Pothole at the roundabout', 'pothole', 23.7970, 90.4220) as ref1 \gset
select pg_temp.validate(:'ref1');
reset role;
-- 0033 moves waiting issues off a switched-off City Corporation; pause that to test the guard itself.
alter table authorities disable trigger authorities_move_issues_off;
update authorities set is_active = false where short_name = 'DNCC';
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select pg_temp.expect_error($$select accept_task('$$||:'ref1'||$$')$$, 'AUTHORITY_INACTIVE');
reset role;
alter table authorities enable trigger authorities_move_issues_off;
update authorities set is_active = true where short_name = 'DNCC';
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select admin_update_settings('{"resolution_quorum": 0}')$$, 'BAD_SETTING');
select pg_temp.expect_error($$select admin_update_settings('{"lock_hours": -5}')$$, 'BAD_SETTING');
select pg_temp.expect_error($$select admin_update_settings('{"heat_min_decay": 2}')$$, 'BAD_SETTING');
select admin_update_settings('{"new_account_hours": 0, "rep_task_expired": -10}');
reset role;
select pg_temp.check((select new_account_hours = 0 and rep_task_expired = -10 from app_settings), 'demo-mode zero and penalties still allowed');

\echo '--- 22. Emergencies: residents witness, officials act, admins moderate (0032)'
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select create_emergency_alert('fire', 'Smoke from a shop', 23.7980, 90.4230, 'Gulshan 1') as fire1 \gset
reset role;
select pg_temp.check((select count(*) = 1 from notifications where alert_id = :'fire1' and type = 'emergency_official'
                       and user_id = '00000000-0000-0000-0000-000000000009'), 'the DNCC official is told as soon as it is raised');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select respond_emergency('$$||:'fire1'||$$', 'confirm', 23.7980, 90.4230, 10, '[]', 'fire')$$, 'ROLE_NOT_ALLOWED');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select pg_temp.expect_error($$select respond_emergency('$$||:'fire1'||$$', 'deny', 23.7980, 90.4230, 10)$$, 'ROLE_NOT_ALLOWED');
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select pg_temp.check(respond_emergency(:'fire1', 'confirm', 23.7980, 90.4230, 10, '[]', 'fire') = 'active', 'a resident can still confirm');
select pg_temp.check((select count(*) = 0 from get_live_alerts()), 'residents don''t get the officials'' list');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select pg_temp.check((select count(*) = 1 from get_live_alerts() where id = :'fire1'), 'on the DNCC live list before it is verified');
select post_alert_update(:'fire1', 'Fire Service on scene, Gulshan Avenue closed');
select pg_temp.check((select jsonb_array_length(updates) = 1 and can_end from get_alert(:'fire1')), 'the update is public; the official can end it');
select pg_temp.expect_error($$select official_log_damage('$$||:'fire1'||$$', 'Burnt pole', 'pothole', '',
  '[{"path":"00000000-0000-0000-0000-000000000009/dmg0.jpg","type":"image"}]')$$, 'LOCKED');
select pg_temp.as_user('00000000-0000-0000-0000-000000000042');  -- a DSCC official (section 16)
select pg_temp.expect_error($$select post_alert_update('$$||:'fire1'||$$', 'Not my area')$$, 'NOT_OFFICIAL');
select pg_temp.check((select count(*) = 0 from get_live_alerts() where id = :'fire1'), 'not on the DSCC list');
reset role;
select pg_temp.check((select count(*) = 1 from notifications where alert_id = :'fire1' and type = 'emergency_update'
                       and user_id = '00000000-0000-0000-0000-000000000001'), 'the reporter is told about the update');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select official_end_alert(:'fire1', 'Fire put out, the road is open again');
select pg_temp.check((select status = 'over' and can_log_damage from get_alert(:'fire1')), 'ended by DNCC; damage can be logged');
select official_log_damage(:'fire1', 'Burnt electric pole at Gulshan 1', 'pothole', 'Pole and pavement damaged by the fire',
  '[{"path":"00000000-0000-0000-0000-000000000009/dmg1.jpg","type":"image"}]', 'small') as dmg \gset
reset role;
select pg_temp.check((select status = 'escalated' and authority_short_name = 'DNCC' and route = 'authority' from issues_v where id = :'dmg'),
                     'the damage goes straight to DNCC');
select pg_temp.check((select followup_issue_id = :'dmg' from emergency_alerts where id = :'fire1'), 'linked to the alert');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009');
select accept_task(:'dmg');
select pg_temp.check((select status = 'assigned' from issues_v where id = :'dmg'), 'the official can take damage they logged');
select pg_temp.expect_error($$select official_log_damage('$$||:'fire1'||$$', 'Again', 'pothole', '',
  '[{"path":"00000000-0000-0000-0000-000000000009/dmg2.jpg","type":"image"}]')$$, 'ALREADY_LOGGED');
-- an admin removes an obvious fake before it is verified
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select create_emergency_alert('gas_leak', 'lol', 23.7990, 90.4240, '') as fake1 \gset
reset role;
select reputation as rep_before from profiles where username = 'rahim' \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.check((select can_hide from get_alert(:'fake1')), 'the admin sees "remove as fake"');
select pg_temp.expect_error($$select admin_hide_alert('$$||:'fake1'||$$', 'no')$$, 'REASON_REQUIRED');
select admin_hide_alert(:'fake1', 'Prank: the photo is from the internet');
reset role;
select pg_temp.check((select status = 'hidden' from emergency_alerts where id = :'fake1')
                     and (select reputation = :rep_before - 10 from profiles where username = 'rahim'), 'hidden, the reporter loses 10');
-- a verified alert goes through the evidence check instead
select pg_temp.as_user('00000000-0000-0000-0000-000000000016');
select create_emergency_alert('fire', '', 23.8000, 90.4250, '') as fire2 \gset
reset role;
update emergency_alerts set verified_at = now(), review_status = 'pending' where id = :'fire2';
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select admin_hide_alert('$$||:'fire2'||$$', 'Looks fake to me')$$, 'USE_REVIEW');
reset role;

\echo '--- 23. Votes admins and officials gave before 0031 are removed from open issues (0033)'
select pg_temp.report('Cracked footpath slab', 'pothole', 23.8010, 90.4260) as old1 \gset
reset role;
-- what an older database could hold: votes by an admin, the DNCC official and a DSCC official
alter table votes disable trigger votes_guard_role;
alter table flags disable trigger flags_guard_role;
insert into votes (issue_id, user_id, weight) values
  (:'old1', '00000000-0000-0000-0000-000000000008', 1),
  (:'old1', '00000000-0000-0000-0000-000000000009', 1),
  (:'old1', '00000000-0000-0000-0000-000000000042', 1),
  (:'done1', '00000000-0000-0000-0000-000000000008', 1);
insert into flags (issue_id, user_id, reason, weight) values (:'old1', '00000000-0000-0000-0000-000000000008', 'spam', 1);
alter table votes enable trigger votes_guard_role;
alter table flags enable trigger flags_guard_role;
select recompute_issue(:'old1');
-- 0045 added a column to comments_v, which re-running 0033 can't take away: drop the view
-- first, then re-run 0045 so the database is back on the latest version.
-- 0057 changed get_role_requests' columns, which 0045's version can't replace: drop it too.
drop view comments_v;
\i ../migrations/20261014000033_cleanup_and_locks.sql
drop function get_role_requests(text);
\i ../migrations/20261017000045_city_admins.sql
-- Re-running old files brings back functions later migrations dropped or replaced, open to
-- everyone; close them again as 0041 does (section 29 checks this).
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f'
              and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0))
  loop execute format('revoke execute on function %s from public', f.sig); end loop;
end $$;
grant select on comments_v to anon, authenticated;
select pg_temp.check((select array_agg(user_id::text order by user_id) = array['00000000-0000-0000-0000-000000000042']
                        from votes where issue_id = :'old1'), 'admin and DNCC votes removed; the DSCC official''s vote outside DSCC stays');
select pg_temp.check((select upvote_count = 1 and flag_count = 0 from issues where id = :'old1'), 'counts recalculated');
select pg_temp.check((select count(*) = 1 from votes where issue_id = :'done1' and user_id = '00000000-0000-0000-0000-000000000008'),
                     'closed issues keep their history');

\echo '--- 24. A switched-off City Corporation hands on its waiting issues and stays in the record'
select pg_temp.check((select status = 'escalated' and authority_short_name = 'DNCC' from issues_v where id = :'ref1'), 'waiting with DNCC');
update authorities set is_active = false where short_name = 'DNCC';
select pg_temp.check((select status = 'escalated' and authority_id is null from issues where id = :'ref1'), 'no longer stuck with a switched-off DNCC');
select pg_temp.check((select count(*) = 1 from review_items where issue_id = :'ref1' and kind = 'no_authority' and status = 'open'),
                     'the admin is asked (nobody else covers it)');
select pg_temp.check((select not is_active from authority_record_v where short_name = 'DNCC'), 'DNCC stays in the public record, marked switched off');
update authorities set is_active = true where short_name = 'DNCC';
select pg_temp.check((select authority_short_name = 'DNCC' from issues_v where id = :'ref1'), 'back with DNCC once switched on again');

\echo '--- 25. Comments by admins are labelled'
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select add_comment(:'ref1', 'Checked with DNCC, they are on it') as admin_comment \gset
select pg_temp.check((select author_is_admin and author_official_of is null from comments_v where id = :'admin_comment'), 'shown as Admin');
reset role;

\echo '--- 26. Time filter on the map: only issues reported in the last N days (0034)'
update issues set created_at = now() - interval '40 days' where id = :'ref1';
select pg_temp.check((select count(*) = 0 from map_issues(88.0, 20.5, 92.7, 26.7, null, array['active'], 30) where id = :'ref1'),
                     'pins: reported 40 days ago is not in the last 30 days');
select pg_temp.check((select count(*) = 1 from map_issues(88.0, 20.5, 92.7, 26.7, null, array['active'], 60) where id = :'ref1'),
                     'pins: it is in the last 60 days');
select pg_temp.check((select count(*) = 1 from map_issues(88.0, 20.5, 92.7, 26.7, null, array['active']) where id = :'ref1'),
                     'pins: no time filter shows it, as before');
select pg_temp.check((select coalesce(sum(issue_count), 0) from heatmap_hex(88.0, 20.5, 92.7, 26.7, 20000, null, 30))
                   = (select coalesce(sum(issue_count), 0) from heatmap_hex(88.0, 20.5, 92.7, 26.7, 20000, null)) - 1,
                     'hexagons: exactly that one issue is left out');
select pg_temp.check((select coalesce(sum(issue_count), 0) from heatmap_points(88.0, 20.5, 92.7, 26.7, null, 30))
                   = (select coalesce(sum(issue_count), 0) from heatmap_points(88.0, 20.5, 92.7, 26.7, null)) - 1,
                     'heat: exactly that one issue is left out');
select pg_temp.check((select (area_heat_summary(ST_Y(location::geometry), ST_X(location::geometry), 500, null, 30)->>'active')::int
                           = (area_heat_summary(ST_Y(location::geometry), ST_X(location::geometry), 500)->>'active')::int - 1
                        from issues where id = :'ref1'),
                     'area summary: exactly that one issue is left out');
with cells as (select * from heatmap_hex(90.30, 23.75, 90.45, 23.85, 400, null, 30))
select pg_temp.check(bool_and(issue_count = (select max(total) from hex_issues(c.hex, 400, null, 20, 30))),
                     'with the time filter, every hexagon''s number still matches its list') from cells c;

\echo '--- 27. Uploads: untraceable names, ownership from Storage'
reset role;
-- Storage records who uploaded each file (owner_id); the browser can't fake it.
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('media', 'u/11111111-1111-1111-1111-111111111111.jpg', '00000000-0000-0000-0000-000000000001', '{"size": 120000}'),
  ('media', 'u/22222222-2222-2222-2222-222222222222.jpg', '00000000-0000-0000-0000-000000000013', '{"size": 90000}');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select create_issue('Anonymous: rubbish dumped in the lake', '', 'illegal_dumping', 23.8420, 90.3910, 5, 'gps', '', true,
  '[{"path":"u/11111111-1111-1111-1111-111111111111.jpg","type":"image"}]', true, 'small') as anon_issue \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select pg_temp.check((select reporter_username is null and media->0->>'path' = 'u/11111111-1111-1111-1111-111111111111.jpg'
                      from issues_v where id = :'anon_issue'), 'anonymous report keeps an untraceable photo name');
select pg_temp.check((select count(*) = 0 from profiles where id::text = split_part(
                       (select media->0->>'path' from issues_v where id = :'anon_issue'), '/', 1)),
                     'the photo link no longer leads to the reporter''s profile');
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select create_issue('Someone else''s photo here', '', 'garbage', 23.8430, 90.3920, 5, 'gps', '', false,
  '[{"path":"u/22222222-2222-2222-2222-222222222222.jpg","type":"image"}]', true, 'small')$$, 'BAD_MEDIA');
select pg_temp.expect_error($$select create_issue('A file that was never uploaded', '', 'garbage', 23.8440, 90.3930, 5, 'gps', '', false,
  '[{"path":"u/33333333-3333-3333-3333-333333333333.jpg","type":"image"}]', true, 'small')$$, 'BAD_MEDIA');
select pg_temp.check((select create_issue('Old-style photo path still works', '', 'garbage', 23.8450, 90.3940, 5, 'gps', '', false,
  '[{"path":"00000000-0000-0000-0000-000000000001/old.jpg","type":"image"}]', true, 'small')) is not null,
  'photos uploaded the old way are still accepted');

\echo '--- 28. Unused uploads: avatars count as in use; only admins see the report'
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata, created_at) values
  ('media', 'u/44444444-4444-4444-4444-444444444444.jpg', '00000000-0000-0000-0000-000000000013', '{"size": 50000}', now() - interval '3 days'),
  ('media', 'u/55555555-5555-5555-5555-555555555555.jpg', '00000000-0000-0000-0000-000000000013', '{"size": 70000}', now() - interval '3 days'),
  ('media', 'u/66666666-6666-6666-6666-666666666666.jpg', '00000000-0000-0000-0000-000000000013', '{"size": 80000}', now() - interval '2 hours');
-- one of the old files is neighbour3's profile picture
update profiles set avatar_url = 'https://x.supabase.co/storage/v1/object/public/media/u/55555555-5555-5555-5555-555555555555.jpg'
 where id = '00000000-0000-0000-0000-000000000013';
select pg_temp.check(media_in_use('u/55555555-5555-5555-5555-555555555555.jpg'), 'a profile picture counts as in use');
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select pg_temp.expect_error($$select * from admin_unused_uploads()$$, 'NOT_ADMIN');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.check((select array_agg(path order by path) from admin_unused_uploads()
                       where path like 'u/%4444%' or path like 'u/%5555%' or path like 'u/%6666%')
                     = array['u/44444444-4444-4444-4444-444444444444.jpg'],
                     'only the old, unused file is reported (not the avatar, not the 2-hour-old upload)');
select pg_temp.check((select size_bytes = 50000 from admin_unused_uploads() where path like 'u/%4444%'), 'with its size');

\echo '--- 29. Visitors can only run read functions; nothing in public is open to everyone'
reset role;
select pg_temp.check((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.prokind = 'f'
                         and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) x where x.grantee = 0))),
                     'no function is open to everyone by default');
select pg_temp.check(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute'))
  <@ array['area_heat_summary','area_label','emergency_contacts_at','find_nearby_duplicates','get_active_alerts','get_alert',
           'get_category_votes','get_feed','get_issue','get_issue_alert','get_open_tasks','get_open_teams',
           'get_still_there','get_team','get_user_issues','heatmap_hex','heatmap_points','hex_issues','is_admin',
           'is_team_member','map_issues','official_authority','official_covers','platform_stats'],
  'visitors can run only the read functions on the list');
select pg_temp.check((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.prokind = 'f' and p.proname like 'admin\_%'
                         and has_function_privilege('anon', p.oid, 'execute')),
                     'no admin function is reachable by visitors');
-- functions created from now on are not opened to visitors or users by Supabase's default
create function public.zz_check_default() returns int language sql as 'select 1';
revoke execute on function public.zz_check_default() from public;
select pg_temp.check(not has_function_privilege('anon', 'public.zz_check_default()', 'execute')
                     and not has_function_privilege('authenticated', 'public.zz_check_default()', 'execute'),
                     'new functions are not opened to visitors or users by default');
drop function public.zz_check_default();

\echo '--- 30. Old notifications are cleared; recent and unread ones stay'
reset role;
insert into notifications (user_id, type, message, read_at, created_at) values
  ('00000000-0000-0000-0000-000000000013', 'zz_test', 'read, 100 days old',   now() - interval '99 days',  now() - interval '100 days'),
  ('00000000-0000-0000-0000-000000000013', 'zz_test', 'read, 10 days old',    now() - interval '9 days',   now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000000013', 'zz_test', 'unread, 100 days old', null,                        now() - interval '100 days'),
  ('00000000-0000-0000-0000-000000000013', 'zz_test', 'unread, 400 days old', null,                        now() - interval '400 days');
select pg_temp.check(cleanup_old_notifications() >= 2, 'cleanup removed the old ones');
select pg_temp.check((select array_agg(message order by message) from notifications where type = 'zz_test')
                     = array['read, 10 days old', 'unread, 100 days old'],
                     'kept: recent read, and unread under a year');
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select pg_temp.check(not has_function_privilege('cleanup_old_notifications()', 'execute'), 'users can''t run the cleanup');
