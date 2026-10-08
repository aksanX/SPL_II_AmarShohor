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
-- six locals vouch for spam1 (weight 6 × 1.5 = 9 > five flags at 7.5)
select pg_temp.as_user('00000000-0000-0000-0000-000000000001'); select toggle_vote(:'spam1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000005'); select toggle_vote(:'spam1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000006'); select toggle_vote(:'spam1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000007'); select toggle_vote(:'spam1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008'); select toggle_vote(:'spam1');
select pg_temp.as_user('00000000-0000-0000-0000-000000000009'); select toggle_vote(:'spam1');
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
