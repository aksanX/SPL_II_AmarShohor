-- End-to-end test of migration 0045: city admins. Run with supabase/tests/run_local.sh
\set ON_ERROR_STOP 1
\pset pager off
set search_path = public, extensions;

insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','rahim@x.com','{"username":"rahim"}'),
 ('00000000-0000-0000-0000-000000000008','admin@x.com','{"username":"admin1"}'),
 ('00000000-0000-0000-0000-000000000009','officer@x.com','{"username":"dncc_officer"}'),
 ('00000000-0000-0000-0000-000000000040','dncc_ca@x.com','{"username":"dncc_ca"}'),
 ('00000000-0000-0000-0000-000000000041','dscc_ca@x.com','{"username":"dscc_ca"}'),
 ('00000000-0000-0000-0000-000000000030','resident@x.com','{"username":"resident"}');
insert into auth.users (id, email, raw_user_meta_data)
 select ('00000000-0000-0000-0000-00000000001'||n)::uuid, 'n'||n||'@x.com', jsonb_build_object('username','neighbour'||n) from generate_series(1,6) n;
update profiles set created_at = now() - interval '30 days';
update user_settings set home_location = make_point(23.8000, 90.4000);
update app_settings set max_reports_per_day = 100;
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
create or replace function pg_temp.report(p_title text, p_lat double precision, p_lng double precision)
returns uuid language plpgsql as $$
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000001');
  return create_issue(p_title, '', 'garbage', p_lat, p_lng, 5, 'gps', '', false,
    '[{"path":"00000000-0000-0000-0000-000000000001/x.jpg","type":"image"}]', true, 'medium');
end $$;
create or replace function pg_temp.notified(p_user uuid, p_type text, p_issue uuid) returns boolean language sql as $$
  select exists (select 1 from notifications where user_id = p_user and type = p_type and issue_id is not distinct from p_issue) $$;

select id as dncc from authorities where short_name = 'DNCC' \gset
select id as dscc from authorities where short_name = 'DSCC' \gset
-- Two more areas, far from every test spot, for moving and appointing admins (one admin per area).
insert into authorities (name, short_name, area) values
 ('Khulna City Corporation', 'KCC', ST_Multi(ST_GeomFromText('POLYGON((89.4 22.7, 89.7 22.7, 89.7 23.0, 89.4 23.0, 89.4 22.7))', 4326))::geography),
 ('Rajshahi City Corporation', 'RCC', ST_Multi(ST_GeomFromText('POLYGON((88.5 24.3, 88.7 24.3, 88.7 24.45, 88.5 24.45, 88.5 24.3))', 4326))::geography);
select id as kcc from authorities where short_name = 'KCC' \gset
select id as rcc from authorities where short_name = 'RCC' \gset

\echo '--- 1. Super admins make city admins; the roles do not mix'
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_grant_city_admin('dncc_ca', :'dncc', 'Runs moderation for DNCC');
select admin_grant_city_admin('dscc_ca', :'dscc', 'Runs moderation for DSCC');
reset role;
select pg_temp.check(city_admin_authority('00000000-0000-0000-0000-000000000040') = :'dncc', 'dncc_ca is a DNCC city admin');
select pg_temp.check((select authority_area = 'Dhaka North' from roles_v where username = 'dncc_ca'), 'labelled by area: Dhaka North');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select admin_grant_city_admin('dncc_officer', '$$||:'dncc'||$$', 'Should not work')$$, 'ROLE_CONFLICT');
select pg_temp.expect_error($$select admin_grant_city_admin('admin1', '$$||:'dncc'||$$', 'Should not work')$$, 'ALREADY_ADMIN');
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select pg_temp.expect_error($$select admin_grant_city_admin('neighbour1', '$$||:'dncc'||$$', 'Should not work')$$, 'NOT_ADMIN');
select pg_temp.expect_error($$select set_volunteer_mode(true)$$, 'ROLE_NOT_ALLOWED');
select pg_temp.expect_error($$select request_official_role('$$||:'dncc'||$$', 'Inspector', '', '')$$, 'ROLE_CONFLICT');
reset role;
select pg_temp.expect_error($$insert into user_roles (user_id, role, authority_id) values ('00000000-0000-0000-0000-000000000040', 'official', '$$||:'dncc'||$$')$$, 'ROLE_CONFLICT');

\echo '--- 2. A case goes to the city admins of its area; no city admin there means the super admins'
select pg_temp.report('Garbage in Banani', 23.8000, 90.4000) as north \gset
select pg_temp.report('Garbage in Dhanmondi', 23.7400, 90.3800) as south \gset
select pg_temp.report('Garbage in Chattogram', 22.3569, 91.7832) as ctg \gset
reset role;
select open_review(:'north', 'stuck', null, 'Nobody took it', '{}');
select open_review(:'south', 'stuck', null, 'Nobody took it', '{}');
select open_review(:'ctg', 'stuck', null, 'Nobody took it', '{}');
select id as south_review from review_items where issue_id = :'south' \gset
select pg_temp.check(pg_temp.notified('00000000-0000-0000-0000-000000000040', 'review_needed', :'north'), 'DNCC city admin told about the DNCC case');
select pg_temp.check(not pg_temp.notified('00000000-0000-0000-0000-000000000008', 'review_needed', :'north'), 'super admin not told about it');
select pg_temp.check(not pg_temp.notified('00000000-0000-0000-0000-000000000041', 'review_needed', :'north'), 'DSCC city admin not told about it');
select pg_temp.check(pg_temp.notified('00000000-0000-0000-0000-000000000008', 'review_needed', :'ctg'), 'super admin told about a case with no City Corporation');
select pg_temp.check((select passed_up_at is null from review_items where issue_id = :'north'), 'DNCC case waits with its city admin');
select pg_temp.check((select passed_up_at is not null from review_items where issue_id = :'ctg'), 'Chattogram case is with the super admins at once');

select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select pg_temp.check((select array_agg(city_short_name) = '{DNCC}' from get_review_queue()), 'DNCC city admin sees only the DNCC case');
select pg_temp.check(can_admin_issue(:'north') and not can_admin_issue(:'south'), 'admin tools only on DNCC issues');
select pg_temp.expect_error($$select admin_dismiss_review($$||:south_review||$$, 'Leave it with volunteers')$$, 'NOT_YOUR_CITY');
select pg_temp.expect_error($$select admin_set_route('$$||:'south'||$$', 'authority', 'Too big for volunteers')$$, 'NOT_YOUR_CITY');
select pg_temp.expect_error($$select toggle_vote('$$||:'north'||$$')$$, 'ROLE_NOT_ALLOWED');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.check((select count(*) = 3 from get_review_queue()), 'super admin sees every case');
select pg_temp.check((select not needs_super_admin from get_review_queue() where city_short_name = 'DNCC'), 'DNCC case does not need the super admin yet');
select pg_temp.check((select needs_super_admin from get_review_queue() where city_short_name is null), 'Chattogram case needs the super admin');
select pg_temp.as_user('00000000-0000-0000-0000-000000000011');
select pg_temp.expect_error($$select * from get_review_queue()$$, 'NOT_ADMIN');

\echo '--- 3. Left too long: passed up to the super admins once'
reset role;
update review_items set created_at = now() - interval '25 hours' where issue_id = :'south';
select pg_temp.check(pass_up_waiting_reviews() = 1, 'the DSCC case is passed up');
select pg_temp.check(pass_up_waiting_reviews() = 0, 'only once');
select pg_temp.check(pg_temp.notified('00000000-0000-0000-0000-000000000008', 'review_needed', :'south'), 'super admins told');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.check((select needs_super_admin from get_review_queue() where city_short_name = 'DSCC'), 'it needs the super admin now');

\echo '--- 4. A city admin decides their own case; the log shows who'
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select admin_set_route(:'north', 'community', 'Small pile, volunteers can do it');
select pg_temp.check((select count(*) = 0 from get_review_queue()), 'DNCC queue is empty');
select pg_temp.check((select admin_city = 'Dhaka North' from get_admin_log() where action = 'set_route' limit 1), 'log says the Dhaka North admin did it');
select pg_temp.as_user('00000000-0000-0000-0000-000000000041');
select pg_temp.check((select count(*) = 0 from get_admin_log() where issue_id = :'north'), 'DSCC city admin does not see DNCC actions');
select pg_temp.check((select count(*) = 1 from issue_events_v where issue_id = :'north' and actor_city_admin_of = 'Dhaka North'), 'timeline labels the Dhaka North admin');

\echo '--- 5. Official requests: decided by that City Corporation''s city admins'
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select request_official_role(:'dncc', 'Conservancy Inspector', 'Zone 2', 'Staff ID 42');
reset role;
select pg_temp.check(pg_temp.notified('00000000-0000-0000-0000-000000000040', 'role_request', null), 'DNCC city admin told');
select pg_temp.check(not pg_temp.notified('00000000-0000-0000-0000-000000000008', 'role_request', null), 'super admin not told');
select id as req from role_requests where user_id = '00000000-0000-0000-0000-000000000013' \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000041');
select pg_temp.check((select count(*) = 0 from get_role_requests()), 'DSCC city admin does not see it');
select pg_temp.expect_error($$select admin_decide_role_request($$||:req||$$, true, 'Checked the staff ID')$$, 'NOT_YOUR_CITY');
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select admin_decide_role_request(:req, true, 'Checked the staff ID with DNCC');
select pg_temp.check(official_authority('00000000-0000-0000-0000-000000000013') = :'dncc', 'approved by the DNCC city admin');
select pg_temp.as_user('00000000-0000-0000-0000-000000000041');
select pg_temp.expect_error($$select admin_revoke_role('neighbour3', 'official', 'Not our official')$$, 'NOT_YOUR_CITY');
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select pg_temp.expect_error($$select admin_revoke_role('dscc_ca', 'city_admin', 'Should not work')$$, 'NOT_ADMIN');
select admin_revoke_role('neighbour3', 'official', 'Left the City Corporation');
select pg_temp.check(official_authority('00000000-0000-0000-0000-000000000013') is null, 'DNCC city admin removed a DNCC official');

\echo '--- 6. Emergencies: the city admins of the area'
select pg_temp.as_user('00000000-0000-0000-0000-000000000014');
select create_emergency_alert('fire', 'Smoke from a shop', 23.8000, 90.4000, 'Banani 11') as fire1 \gset
select create_emergency_alert('fire', 'Smoke again', 23.8010, 90.4010, 'Banani 12') as fire2 \gset
reset role;
select pg_temp.check(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-000000000040'
  and type = 'emergency_admin' and alert_id = :'fire1'), 'DNCC city admin told about a new alert');
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select pg_temp.check(exists (select 1 from get_live_alerts() where id = :'fire1'), 'DNCC city admin sees the live alert');
select pg_temp.check((select can_hide from get_alert(:'fire1')), 'and may remove it as fake');
select pg_temp.as_user('00000000-0000-0000-0000-000000000041');
select pg_temp.check(not exists (select 1 from get_live_alerts() where id = :'fire1'), 'DSCC city admin does not');
select pg_temp.check((select not can_hide from get_alert(:'fire1')), 'and may not remove it');
select pg_temp.expect_error($$select admin_hide_alert('$$||:'fire1'||$$', 'Looks fake to me')$$, 'NOT_YOUR_CITY');
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select admin_hide_alert(:'fire1', 'Same shop, no smoke on the cameras');
reset role;
select pg_temp.check((select status = 'hidden' from emergency_alerts where id = :'fire1'), 'removed by the DNCC city admin');

reset role;
update emergency_alerts set verified_at = now(), review_status = 'pending' where id = :'fire2';
select pg_temp.check(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-000000000040'
  and type = 'emergency_review' and alert_id = :'fire2'), 'DNCC city admin asked to check the evidence');
select pg_temp.as_user('00000000-0000-0000-0000-000000000015');
select pg_temp.expect_error($$select review_emergency('$$||:'fire2'||$$', false, 'I say it is fake')$$, 'NOT_ALLOWED');
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select pg_temp.check((select count(*) = 1 from get_emergency_reviews()), 'it is in the DNCC city admin''s list');
select review_emergency(:'fire2', true, 'Live photos show the fire');
reset role;
select pg_temp.check((select review_status = 'kept' from emergency_alerts where id = :'fire2'), 'kept by the DNCC city admin');

\echo '--- 7. Removing a city''s last city admin hands its cases to the super admins'
select pg_temp.report('Broken bench in Gulshan', 23.7950, 90.4150) as north2 \gset
reset role;
select open_review(:'north2', 'stuck', null, 'Nobody took it', '{}');
select pg_temp.check((select passed_up_at is null from review_items where issue_id = :'north2'), 'with the DNCC city admin');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_revoke_role('dncc_ca', 'city_admin', 'Stepped down');
reset role;
select pg_temp.check((select passed_up_at is not null from review_items where issue_id = :'north2'), 'now with the super admins');
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select pg_temp.expect_error($$select * from get_review_queue()$$, 'NOT_ADMIN');

\echo '--- 8. A city admin made super admin loses the city role'
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_grant_admin('dscc_ca', 'Takes over the whole country');
reset role;
select pg_temp.check((select array_agg(role::text) = '{admin}' from user_roles where user_id = '00000000-0000-0000-0000-000000000041'), 'only the admin role left');

\echo '--- 9. A service area from thanas (0046)'
\set thanas `cat ../../web/public/data/city-thanas.json`
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select merge_areas((select jsonb_agg(x -> 'geometry') from jsonb_array_elements((:'thanas')::jsonb -> 'thanas') x
                     where x ->> 'area' = 'Dhaka North')) as north_area \gset
reset role;
select pg_temp.check((select ST_IsValid(g) and GeometryType(g) = 'POLYGON' and ST_NumInteriorRings(g) = 0
                        from (select ST_SetSRID(ST_GeomFromGeoJSON(:'north_area'), 4326) g) x), 'Dhaka North thanas join into one clean outline');
select pg_temp.check((select ST_Area(ST_SetSRID(ST_GeomFromGeoJSON(:'north_area'), 4326)::geography) / 1e6 between 180 and 215),
                     'about the size of Dhaka North (~196 km2)');
select pg_temp.check((select ST_Covers(g, make_point(23.7940, 90.4043)::geometry) and ST_Covers(g, make_point(23.8759, 90.3795)::geometry)
                             and not ST_Covers(g, make_point(23.7461, 90.3742)::geometry)
                        from (select ST_SetSRID(ST_GeomFromGeoJSON(:'north_area'), 4326) g) x),
                     'Banani and Uttara are inside, Dhanmondi is not');
select pg_temp.as_user('00000000-0000-0000-0000-000000000011');
select pg_temp.expect_error($$select merge_areas('[{"type":"Polygon","coordinates":[[[90.4,23.8],[90.41,23.8],[90.41,23.81],[90.4,23.8]]]}]')$$, 'NOT_ADMIN');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select merge_areas('[]')$$, 'BAD_AREA');

\echo '--- 10. Super admins oversee the area admins (0047)'
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_grant_city_admin('dncc_ca', :'dncc', 'Back for Dhaka North');
select pg_temp.check((select admins -> 0 ->> 'username' = 'dncc_ca' from get_area_overview() where area = 'Dhaka North'), 'Dhaka North row names its admin');
select pg_temp.check((select open_cases = 1 from get_area_overview() where area = 'Dhaka North'), 'its open case is counted');
select pg_temp.check((select decided_30d = 1 and avg_hours_to_decide is not null and last_action_at is not null
                        from get_area_overview() where area = 'Dhaka North'), 'its admin''s decision and last action are counted');
select pg_temp.check((select open_cases = 1 and overdue_cases = 1 from get_area_overview() where area = 'Dhaka South'), 'Dhaka South: one case, waiting too long');
select pg_temp.check((select open_cases = 1 from get_area_overview() where area_id is null), 'the Chattogram case counts as outside every City Corporation');
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select pg_temp.expect_error($$select * from get_area_overview()$$, 'NOT_ADMIN');

\echo '--- 11. Cases follow the area admins (0048)'
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.check((select super_reason = 'no_admin' from get_review_queue() where city_area = 'Dhaka South'), 'Dhaka South case: with the super admins, no admin there');
select pg_temp.check((select super_reason = 'no_city_corporation' from get_review_queue() where city_id is null), 'Chattogram case: no City Corporation');
select admin_grant_city_admin('neighbour2', :'dscc', 'New Dhaka South admin');
select pg_temp.check((select super_reason is null and not needs_super_admin from get_review_queue() where city_area = 'Dhaka South'),
                     'appointing an admin hands them the Dhaka South case');
reset role;
select pg_temp.check(pass_up_waiting_reviews() = 0, 'with a fresh clock: the old case is not passed straight back up');
select pg_temp.check(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-000000000012'
                       and type = 'review_needed' and message like '1 open case in Dhaka South is now yours%'), 'the new admin is told');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_grant_city_admin('neighbour2', :'kcc', 'Moves to Khulna');
select pg_temp.check((select super_reason = 'no_admin' and needs_super_admin from get_review_queue() where city_area = 'Dhaka South'),
                     'moving the only Dhaka South admin away sends its case back up');

\echo '--- 12. Fixes from testing (0049)'
-- State here: dncc_ca is the Dhaka North admin, neighbour2 Khulna's; Dhaka South has none.
\echo '    1. No admin decides a case about their own report'
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select create_issue('Report by an area admin', '', 'garbage', 23.8020, 90.4020, 5, 'gps', '', false,
  '[{"path":"00000000-0000-0000-0000-000000000040/x.jpg","type":"image"}]', true, 'medium') as rahims \gset
reset role;
update issues set status = 'hidden', status_before_hidden = 'community_review' where id = :'rahims';
select open_review(:'rahims', 'appeal', '00000000-0000-0000-0000-000000000040', 'It is real', '{}');
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select pg_temp.expect_error($$select admin_decide_appeal('$$||:'rahims'||$$', true, 'My own report is real')$$, 'OWN_ISSUE');
select pg_temp.expect_error($$select admin_set_route('$$||:'rahims'||$$', 'authority', 'Moving my own report')$$, 'OWN_ISSUE');
select pg_temp.check(not can_admin_issue(:'rahims'), 'no admin tools on your own report');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_decide_appeal(:'rahims', true, 'Checked the photo, it is real');
reset role;
select pg_temp.check((select status <> 'hidden' from issues where id = :'rahims'), 'the super admin decides it');
-- From here on issues are reported by a plain resident.
create or replace function pg_temp.report(p_title text, p_lat double precision, p_lng double precision)
returns uuid language plpgsql as $$
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000000030');
  return create_issue(p_title, '', 'garbage', p_lat, p_lng, 5, 'gps', '', false,
    '[{"path":"00000000-0000-0000-0000-000000000030/x.jpg","type":"image"}]', true, 'medium');
end $$;

\echo '    2. A new role takes back the answers it may no longer give'
select pg_temp.report('Pothole near the market', 23.8030, 90.4030) as votedon \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000014');
select toggle_vote(:'votedon', 23.8030, 90.4030);
reset role;
select upvote_count as votes_before from issues where id = :'votedon' \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_grant_city_admin('neighbour4', :'rcc', 'Neighbour 4 moderates Rajshahi');
reset role;
select pg_temp.check(not exists (select 1 from votes where issue_id = :'votedon' and user_id = '00000000-0000-0000-0000-000000000014'),
                     'the new area admin''s vote is removed');
select pg_temp.check((select upvote_count = :votes_before - 1 from issues where id = :'votedon'), 'and the count recalculated');

\echo '    3. A case that moves into an area goes to that area''s admin'
select pg_temp.report('North of the old Dhaka North edge', 23.9500, 90.4000) as edge \gset
reset role;
select open_review(:'edge', 'stuck', null, 'Nobody took it', '{}');
select pg_temp.check((select passed_up_at is not null from review_items where issue_id = :'edge'), 'outside every area: with the super admins');
update authorities
   set area = ST_Multi(ST_GeomFromText('POLYGON((90.33 23.765, 90.46 23.765, 90.46 23.97, 90.33 23.97, 90.33 23.765))', 4326))::geography
 where id = :'dncc';
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.check((select super_reason is null from get_review_queue() where issue ->> 'id' = :'edge'),
                     'Dhaka North redrawn to cover it: now with its admin');
reset role;
select pg_temp.check((select area_admin_since is not null from review_items where issue_id = :'edge'), 'with a fresh clock');

\echo '    4. A reminder first, then one summary per area'
do $$ declare k int; begin
  for k in 1..5 loop
    perform pg_temp.report('Bulk ' || k, 23.80 + k * 0.001, 90.41);
  end loop;
end $$;
reset role;
select open_review(id, 'stuck', null, 'Nobody took it', '{}') from issues where title like 'Bulk %';
update review_items set created_at = now() - interval '20 hours', area_admin_since = null
 where issue_id in (select id from issues where title like 'Bulk %');
select pg_temp.check(pass_up_waiting_reviews() = 0, '20 hours in: nothing passed up yet');
select pg_temp.check((select count(*) = 1 from notifications where user_id = '00000000-0000-0000-0000-000000000040'
                       and message like '5 cases in Dhaka North go to the super admins%'), 'one reminder to each area admin for all 5');
select pg_temp.check(pass_up_waiting_reviews() = 0 and (select count(*) = 1 from notifications
                       where user_id = '00000000-0000-0000-0000-000000000040' and message like '5 cases in Dhaka North go%'), 'reminded only once');
update review_items set created_at = now() - interval '30 hours'
 where issue_id in (select id from issues where title like 'Bulk %');
select count(*) as super_before from notifications where user_id = '00000000-0000-0000-0000-000000000008' \gset
select pg_temp.check(pass_up_waiting_reviews() = 5, '30 hours in: all 5 passed up');
select pg_temp.check((select count(*) = :super_before + 1 from notifications where user_id = '00000000-0000-0000-0000-000000000008'),
                     'the super admin gets one summary, not 5 messages');
select pg_temp.check(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-000000000008'
                       and issue_id is null and message like 'Dhaka North admin has 5 cases waiting%'), 'summary names the area');

\echo '    5. Switching a City Corporation off tells its area admins'
update authorities set is_active = false where id = :'dncc';
select pg_temp.check(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-000000000040'
                       and message like 'Dhaka North was switched off%'), 'its area admins are told');
select pg_temp.check((select passed_up_at is not null from review_items where issue_id = :'edge'), 'its cases went to the super admins');
update authorities set is_active = true where id = :'dncc';
select pg_temp.check(exists (select 1 from notifications where user_id = '00000000-0000-0000-0000-000000000040'
                       and message like 'Dhaka North is switched on again%'), 'and told when it is back');
select pg_temp.check((select passed_up_at is null from review_items where issue_id = :'edge'), 'its cases are back with them');

\echo '--- 13. Who is who (0050)'
\echo '    G. Super admins don''t report issues'
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select create_issue('Test', '', 'garbage', 23.80, 90.40, 5, 'gps', '', false,
  '[{"path":"00000000-0000-0000-0000-000000000008/x.jpg","type":"image"}]', true, 'medium')$$, 'ROLE_NOT_ALLOWED');
-- A report from before they became super admin can still be decided by them.
reset role;
delete from user_roles where user_id = '00000000-0000-0000-0000-000000000041' and role = 'admin';
select pg_temp.as_user('00000000-0000-0000-0000-000000000041');
select create_issue('Reported before becoming super admin', '', 'garbage', 23.7400, 90.3800, 5, 'gps', '', false,
  '[{"path":"00000000-0000-0000-0000-000000000041/x.jpg","type":"image"}]', true, 'medium') as old_report \gset
reset role;
insert into user_roles (user_id, role) values ('00000000-0000-0000-0000-000000000041', 'admin');
select open_review(:'old_report', 'stuck', null, 'Nobody took it', '{}');
select pg_temp.as_user('00000000-0000-0000-0000-000000000041');
select admin_set_route(:'old_report', 'authority', 'Needs the City Corporation');
reset role;
select pg_temp.check((select route = 'authority' from issues where id = :'old_report'), 'a super admin''s old report doesn''t get stuck');

\echo '    H. An area admin''s own report, when they are the area''s only admin'
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_grant_city_admin('neighbour5', :'dscc', 'Only Dhaka South admin');
select pg_temp.report('Pothole in Dhanmondi', 23.7410, 90.3810) as dhanmondi \gset
reset role;
update issues set reporter_id = '00000000-0000-0000-0000-000000000015' where id = :'dhanmondi';
select open_review(:'dhanmondi', 'stuck', null, 'Nobody took it', '{}');
select pg_temp.check((select passed_up_at is not null from review_items where issue_id = :'dhanmondi'), 'straight to the super admins');
select pg_temp.check(not pg_temp.notified('00000000-0000-0000-0000-000000000015', 'review_needed', :'dhanmondi'), 'the area admin isn''t asked to decide their own report');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.check((select super_reason = 'own_report' and needs_super_admin from get_review_queue() where issue ->> 'id' = :'dhanmondi'),
                     'shown under Needs you as the area admin''s own report');

\echo '    I. Emergency evidence checks are in the Activity log'
select pg_temp.as_user('00000000-0000-0000-0000-000000000016');
select create_emergency_alert('fire', 'Smoke', 23.8005, 90.4005, 'Banani 12') as fire3 \gset
reset role;
update emergency_alerts set verified_at = now(), review_status = 'pending' where id = :'fire3';
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select review_emergency(:'fire3', true, 'Live photos show the fire');
select pg_temp.check(exists (select 1 from get_admin_log() where action = 'keep_emergency' and data ->> 'alert_id' = :'fire3'),
                     'keeping an emergency is logged, and counts as activity');

\echo '    J. Super admin or official, never both'
reset role;
select pg_temp.expect_error($$insert into user_roles (user_id, role, authority_id) select '00000000-0000-0000-0000-000000000008', 'official', id from authorities where short_name = 'DNCC'$$, 'ROLE_CONFLICT');
select pg_temp.expect_error($$insert into user_roles (user_id, role) values ('00000000-0000-0000-0000-000000000009', 'admin')$$, 'ROLE_CONFLICT');

\echo '    K. Appointing someone admin closes their official request'
select pg_temp.as_user('00000000-0000-0000-0000-000000000016');
select request_official_role(:'dscc', 'Inspector', '', '');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select admin_grant_city_admin('neighbour6', '$$||:'dncc'||$$', 'A second Dhaka North admin')$$, 'AREA_TAKEN');
select admin_revoke_role('neighbour4', 'city_admin', 'Stepping down');
select admin_grant_city_admin('neighbour6', :'rcc', 'New Rajshahi admin');
reset role;
select pg_temp.check((select status = 'rejected' and decision_note = 'Appointed as an area admin' from role_requests
                        where user_id = '00000000-0000-0000-0000-000000000016'), 'the pending official request is closed');

\echo '    Wording outside one''s area'
select pg_temp.as_user('00000000-0000-0000-0000-000000000015');
do $$ begin
  perform admin_request_help((select id from issues_v where title = 'Report by an area admin'));
  raise notice 'FAIL: no error';
exception when others then
  raise notice '%', case when sqlerrm like 'This is outside your area.%' then 'ok  says "outside your area"' else 'FAIL: ' || sqlerrm end;
end $$;

\echo '--- 14. Fixes from the third round (0051)'
\echo '    M. Not on your own request'
select pg_temp.report('Huge pile in Dhanmondi', 23.7420, 90.3820) as pile \gset
reset role;
update issues set status = 'validated', route = 'community', validated_at = now() where id = :'pile';
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select set_volunteer_mode(true);
select accept_task(:'pile');
select release_task(:'pile', 'Far too big, needs a truck', 'needs_authority',
  '[{"path":"00000000-0000-0000-0000-000000000013/p.jpg","type":"image"}]');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_revoke_role('neighbour5', 'city_admin', 'Stepping down');
select admin_grant_city_admin('neighbour3', :'dscc', 'New Dhaka South admin');
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select pg_temp.expect_error($$select admin_decide_escalation('$$||:'pile'||$$', true, 'I agree with myself')$$, 'OWN_REQUEST');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.check((select super_reason = 'own_report' and needs_super_admin from get_review_queue() where issue ->> 'id' = :'pile'),
                     'it is with the super admin');

\echo '    N. The overview counts only what the area admin may decide'
select pg_temp.check((select super_reason = 'own_report' from get_review_queue() where issue ->> 'id' = :'pile'),
                     'still the super admin''s');
select pg_temp.check((select open_cases from get_area_overview() where area = 'Dhaka South')
                      = (select count(*) from get_review_queue() where city_area = 'Dhaka South' and (super_reason is null or super_reason = 'waited')),
                     'Dhaka South''s open count leaves out cases its admin may not decide');
select pg_temp.check((select super_reason is null from get_review_queue() where issue ->> 'id' = :'dhanmondi'),
                     'neighbour5 is no longer an admin: their old report''s case is back with the Dhaka South admin');

\echo '    Reports by area admins: only the super admin decides (0051), others don''t even see them (0052)'
-- The Dhaka South admin reports, anonymously, in Dhaka North.
select pg_temp.as_user('00000000-0000-0000-0000-000000000013');
select create_issue('Leaking pipe reported by an area admin', '', 'garbage', 23.8040, 90.4040, 5, 'gps', '', true,
  '[{"path":"00000000-0000-0000-0000-000000000013/x.jpg","type":"image"}]', true, 'medium') as by_rahim \gset
reset role;
select open_review(:'by_rahim', 'stuck', null, 'Nobody took it', '{}');
select pg_temp.check((select passed_up_at is not null from review_items where issue_id = :'by_rahim'), 'goes straight to the super admin');
select pg_temp.check(not pg_temp.notified('00000000-0000-0000-0000-000000000040', 'review_needed', :'by_rahim'),
                     'the Dhaka North admin is not asked');
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select pg_temp.check(not exists (select 1 from get_review_queue() where issue ->> 'id' = :'by_rahim'),
                     'nor shown it: an anonymous report doesn''t reveal that an area admin made it');
select pg_temp.expect_error($$select admin_set_route('$$||:'by_rahim'||$$', 'authority', 'Deciding it anyway')$$, 'OWN_ISSUE');
select pg_temp.check(not can_admin_issue(:'by_rahim'), 'no admin tools for another area admin''s report');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select admin_set_route(:'by_rahim', 'authority', 'Checked: the City Corporation fixes pipes');
reset role;
select pg_temp.check((select route = 'authority' from issues where id = :'by_rahim'), 'the super admin decides it');
select admin_decide_escalation(:'pile', true, 'Checked the photo: a truck is needed');
reset role;
select pg_temp.check((select route = 'authority' from issues where id = :'pile'), 'the super admin decided it');

\echo '    O. The Activity log filters in the database'
insert into admin_actions (admin_id, action, reason)
select '00000000-0000-0000-0000-000000000008', 'busy_day', 'Lots of work' from generate_series(1, 250);
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.check((select count(*) > 0 and bool_and(admin_city = 'Dhaka North') from get_admin_log(200, 'Dhaka North')),
                     'filtering by the Dhaka North admin finds their actions after 250 newer ones');
select pg_temp.check((select bool_and(admin_city is null) from get_admin_log(50, 'super')), 'filtering by super admins');
select pg_temp.as_user('00000000-0000-0000-0000-000000000040');
select pg_temp.check((select count(*) = (select count(*) from get_admin_log(200)) from get_admin_log(200, 'super')),
                     'an area admin can''t use the filter to see more');
