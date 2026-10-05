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
select pg_temp.report('Live wire hanging over the footpath', 'safety_hazard', 23.8100, 90.3710) as wire \gset
reset role;
select pg_temp.check((select route = 'authority' from issues where id = :'wire'), 'dangerous report starts with the authority');
select pg_temp.report('Garbage beside the canal', 'garbage', 23.8110, 90.3720) as canal \gset
select pg_temp.validate(:'canal');
select pg_temp.as_user('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select admin_set_route('$$||:'canal'||$$', 'community', 'It is really a live wire', 'safety_hazard')$$, 'UNSAFE_FOR_VOLUNTEERS');
select admin_set_route(:'canal', 'authority', 'It is really a live wire', 'safety_hazard');
reset role;
select pg_temp.check((select route = 'authority' and status = 'escalated' and category = 'safety_hazard' from issues where id = :'canal'),
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
