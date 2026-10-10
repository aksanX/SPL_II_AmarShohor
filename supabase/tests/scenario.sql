-- End-to-end test of the business logic. Run with supabase/tests/run_local.sh
\set ON_ERROR_STOP 1
\pset pager off
set search_path = public, extensions;

-- users (backdated so they count with full weight), one brand-new account
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','rahim@x.com','{"username":"rahim","full_name":"Rahim"}'),
 ('00000000-0000-0000-0000-000000000002','karim@x.com','{"username":"karim"}'),
 ('00000000-0000-0000-0000-000000000003','salma@x.com','{"username":"salma"}'),
 ('00000000-0000-0000-0000-000000000004','nila@x.com','{"username":"nila"}'),
 ('00000000-0000-0000-0000-000000000005','vol1@x.com','{"username":"vol1"}'),
 ('00000000-0000-0000-0000-000000000006','vol2@x.com','{"username":"vol2"}'),
 ('00000000-0000-0000-0000-000000000007','newbie@x.com','{"username":"newbie"}');
insert into auth.users (id, email, raw_user_meta_data)
 select ('00000000-0000-0000-0000-00000000001'||n)::uuid, 'f'||n||'@x.com', jsonb_build_object('username','flagger'||n) from generate_series(1,6) n;
update profiles set created_at = now() - interval '30 days' where username <> 'newbie';
-- Volunteers need a home area (0056). Far from the test issues, so it doesn't change vote weights.
update user_settings set home_location = make_point(22.3569, 91.7832)
 where user_id in ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006');
select username from profiles order by username;

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text,''), false);
      execute case when p is null then 'set role anon' else 'set role authenticated' end; end $$;
create or replace function pg_temp.expect_error(p_sql text, p_hint text) returns text language plpgsql as $$
declare h text;
begin execute p_sql; return 'FAIL: no error (expected ' || p_hint || ')';
exception when others then get stacked diagnostics h = pg_exception_hint;
  return case when h = p_hint then 'ok  ' || p_hint else 'FAIL: got ' || coalesce(h,'?') || ' / ' || sqlerrm end; end $$;

\echo '--- 1. Rahim reports a pothole at Mirpur 10'
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select create_issue('Huge pothole near Mirpur 10 circle','Cars swerving into the next lane','pothole',
  23.80690, 90.36870, 8, 'gps', 'Mirpur 10, Dhaka', false,
  '[{"path":"00000000-0000-0000-0000-000000000001/a.jpg","type":"image"}]') as pothole \gset
select title, status, severity, validation_threshold from issues_v where id = :'pothole';
select pg_temp.expect_error($$select toggle_vote('$$||:'pothole'||$$')$$, 'OWN_ISSUE');
select pg_temp.expect_error($$select create_issue('bad gps test here','', 'pothole', 23.8, 90.4, 500, 'gps','',false,'[{"path":"00000000-0000-0000-0000-000000000001/b.jpg","type":"image"}]')$$, 'LOW_GPS_ACCURACY');
select pg_temp.expect_error($$select create_issue('outside the country','', 'pothole', 0, 0, 5, 'gps','',false,'[{"path":"00000000-0000-0000-0000-000000000001/b.jpg","type":"image"}]')$$, 'OUT_OF_AREA');
select pg_temp.expect_error($$select create_issue('someone else file','', 'garbage', 23.75, 90.39, 5, 'gps','',false,'[{"path":"00000000-0000-0000-0000-000000000002/b.jpg","type":"image"}]')$$, 'BAD_MEDIA');

\echo '--- 2. Karim, 20 m away, tries to post the same pothole -> duplicate check'
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select title, round(distance_m) as metres_away from find_nearby_duplicates(23.80705, 90.36880, 'pothole');
select pg_temp.expect_error($$select create_issue('Pothole at Mirpur 10 again','', 'pothole', 23.80705, 90.36880, 6, 'gps','',false,'[{"path":"00000000-0000-0000-0000-000000000002/c.jpg","type":"image"}]')$$, 'DUPLICATE_FOUND');
\echo '    ...so he taps "I see this too" (on-site, with photo)'
select pg_temp.expect_error($$select confirm_issue('$$||:'pothole'||$$', 23.83, 90.37, 5, 'far', '[{"path":"00000000-0000-0000-0000-000000000002/c.jpg","type":"image"}]')$$, 'TOO_FAR');
select confirm_issue(:'pothole', 23.80705, 90.36880, 6, 'Saw it this morning', '[{"path":"00000000-0000-0000-0000-000000000002/c.jpg","type":"image"}]');
select status, validation_score, validation_threshold, confirmation_count from issues_v where id = :'pothole';

\echo '    (one supporter is never enough, even with a high score)'
\echo '--- 3. Salma (local) upvotes -> crosses threshold -> validated'
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select toggle_vote(:'pothole', 23.807, 90.369);
select status, validation_score, validation_threshold, upvote_count from issues_v where id = :'pothole';

\echo '--- 4. Map + heatmap see it'
select pg_temp.as_user(null);  -- logged-out visitor
select title, status from map_issues(90.30, 23.70, 90.50, 23.90, null, array['active']);
select issue_count, weight, top_category, jsonb_array_length(hex->'coordinates'->0) as hex_vertices from heatmap_hex(90.30, 23.70, 90.50, 23.90, 250, null);
select summary->>'active' as area_active, summary->>'heat' as area_heat, jsonb_array_length(summary->'hottest') as hottest from area_heat_summary(23.807, 90.369, 1000) summary;
select count(*) as feed_items from get_feed();

\echo '--- 5. Two volunteers race for the task'
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select pg_temp.expect_error($$select accept_task('$$||:'pothole'||$$')$$, 'NOT_VOLUNTEER');
select set_volunteer_mode(true);
select accept_task(:'pothole');
select pg_temp.as_user('00000000-0000-0000-0000-000000000006');
select set_volunteer_mode(true);
select pg_temp.expect_error($$select accept_task('$$||:'pothole'||$$')$$, 'TASK_TAKEN');
select pg_temp.as_user('00000000-0000-0000-0000-000000000007');
select pg_temp.expect_error($$select set_volunteer_mode(true)$$, 'ACCOUNT_TOO_NEW');

\echo '--- 6. vol1 posts progress, submits fix (must be on-site)'
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select post_progress(:'pothole', 'Filed complaint with DNCC, ref #4411', '[]');
select pg_temp.expect_error($$select submit_resolution('$$||:'pothole'||$$', 'fixed', 23.75, 90.39, 5, '[{"path":"00000000-0000-0000-0000-000000000005/after.jpg","type":"image"}]')$$, 'TOO_FAR');
select pg_temp.expect_error($$select submit_resolution('$$||:'pothole'||$$', 'fixed', 23.80690, 90.36870, 5, '[]')$$, 'MEDIA_REQUIRED');
select submit_resolution(:'pothole', 'DNCC patched it today', 23.80691, 90.36871, 5, '[{"path":"00000000-0000-0000-0000-000000000005/after.jpg","type":"image"}]');
select status from issues_v where id = :'pothole';

\echo '--- 7. Reporter says NOT fixed -> reopened, vol1 penalised and blocked from retaking'
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select review_resolution(:'pothole', false);
select pg_temp.as_user('00000000-0000-0000-0000-000000000005');
select pg_temp.expect_error($$select accept_task('$$||:'pothole'||$$')$$, 'PREVIOUSLY_FAILED');

\echo '--- 8. vol2 takes it, fixes it; two nearby citizens confirm -> closed'
select pg_temp.as_user('00000000-0000-0000-0000-000000000006');
select accept_task(:'pothole');
select submit_resolution(:'pothole', 'Properly filled and compacted', 23.80690, 90.36870, 5, '[{"path":"00000000-0000-0000-0000-000000000006/after.jpg","type":"image"}]');
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
select pg_temp.expect_error($$select review_resolution('$$||:'pothole'||$$', true, 23.75, 90.39)$$, 'NOT_NEARBY');
select review_resolution(:'pothole', true, 23.8070, 90.3690) as after_nila;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');  -- Karim confirmed on-site earlier, so he may review
select review_resolution(:'pothole', true) as after_karim;
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
select rate_volunteer(:'pothole', 5, 'Fast and clean work');
select pg_temp.expect_error($$select rate_volunteer('$$||:'pothole'||$$', 1, 'again')$$, 'ALREADY_RATED');

\echo '--- 9. Lock expiry: vol1 takes a garbage task and goes silent'
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select create_issue('Garbage pile at Dhanmondi 27','','garbage', 23.7560, 90.3740, 10, 'gps','',false,
  '[{"path":"00000000-0000-0000-0000-000000000003/g.jpg","type":"image"}]') as garbage \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000002'); select toggle_vote(:'garbage', 23.756, 90.374);
select pg_temp.as_user('00000000-0000-0000-0000-000000000004'); select toggle_vote(:'garbage', 23.756, 90.374);
select status, validation_score, validation_threshold from issues_v where id = :'garbage';
\echo '    (medium issue needs 5 here; two more locals upvote)'
select pg_temp.as_user('00000000-0000-0000-0000-000000000001'); select toggle_vote(:'garbage', 23.756, 90.374);
select pg_temp.as_user('00000000-0000-0000-0000-000000000006'); select toggle_vote(:'garbage', 23.756, 90.374);
select status, validation_score, validation_threshold from issues_v where id = :'garbage';
select pg_temp.as_user('00000000-0000-0000-0000-000000000005'); select accept_task(:'garbage');
reset role;
update issues set lock_expires_at = now() + interval '2 hours' where id = :'garbage';
select run_maintenance() as maintenance_reminder;
update issues set lock_expires_at = now() - interval '1 minute' where id = :'garbage';
select run_maintenance() as maintenance_expire;
select status, volunteer_id is null as back_in_pool from issues where id = :'garbage';

\echo '--- 10. Fake report gets hidden by flags (ratio rule), anonymity respected'
select pg_temp.as_user('00000000-0000-0000-0000-000000000007');
select create_issue('Totally real issue trust me','', 'other', 23.78, 90.40, 10, 'gps','',true,
  '[{"path":"00000000-0000-0000-0000-000000000007/x.jpg","type":"image"}]') as fake \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select reporter_id, reporter_username, is_anonymous from issues_v where id = :'fake';
select pg_temp.as_user('00000000-0000-0000-0000-000000000011'); select flag_issue(:'fake','fake_or_scam','');
select pg_temp.as_user('00000000-0000-0000-0000-000000000012'); select flag_issue(:'fake','fake_or_scam','');
select pg_temp.as_user('00000000-0000-0000-0000-000000000013'); select flag_issue(:'fake','spam','');
select pg_temp.as_user('00000000-0000-0000-0000-000000000014'); select flag_issue(:'fake','fake_or_scam','');
select status, flag_count from issues_v where id = :'fake';
select pg_temp.as_user('00000000-0000-0000-0000-000000000015'); select flag_issue(:'fake','fake_or_scam','');
reset role; select status, flag_count, flag_score from issues where id = :'fake'; select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
select count(*) filter (where id = :'fake') as fake_in_feed from get_feed('new');

\echo '--- 11. Comments + notifications'
select pg_temp.as_user('00000000-0000-0000-0000-000000000004');
select add_comment(:'garbage', 'This has been here for a week') as c1 \gset
select pg_temp.as_user('00000000-0000-0000-0000-000000000003');
select add_comment(:'garbage', 'Yes, and it smells', :'c1');
select type, message from notifications_v order by id;

\echo '--- 12. Clients cannot touch tables directly'
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
do $$ begin update issues set status = 'closed'; raise notice 'FAIL: could change a status directly';
exception when insufficient_privilege then raise notice 'ok  statuses not editable directly'; end $$;
do $$ begin perform 1 from issues; raise notice 'FAIL: could read issues table';
exception when insufficient_privilege then raise notice 'ok  issues table not readable'; end $$;
do $$ begin update profiles set reputation = 9999; raise notice 'FAIL: could edit reputation';
exception when insufficient_privilege then raise notice 'ok  reputation not editable'; end $$;

\echo '--- Final scoreboard'
reset role;
select * from leaderboard_v;
select type, coalesce(note,'') note from issue_events where issue_id = :'pothole' order by id;
