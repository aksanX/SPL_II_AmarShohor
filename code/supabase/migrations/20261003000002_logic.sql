-- =====================================================================
-- AmarShohor — 2. Business logic
-- Every write the app makes goes through one of these functions.
-- Clients can't touch tables directly (see 0003), so counters, scores,
-- status changes and locks can't be faked from the browser.
--
-- Errors are raised with a human message plus a machine code in HINT,
-- e.g. HINT = 'DUPLICATE_FOUND'. The web app switches on that code.
-- =====================================================================

set search_path = public, extensions;

-- ---------- Small helpers -------------------------------------------

create or replace function require_user() returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Please log in first' using hint = 'NOT_AUTHENTICATED';
  end if;
  if not exists (select 1 from profiles where id = v) then
    raise exception 'Your profile is missing. Please log out and in again.' using hint = 'NO_PROFILE';
  end if;
  return v;
end $$;

create or replace function make_point(p_lat double precision, p_lng double precision) returns geography
language sql immutable set search_path = public, extensions as $$
  select case when p_lat is null or p_lng is null then null
              else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end
$$;

create or replace function assert_in_service_area(p_lat double precision, p_lng double precision) returns void
language plpgsql stable set search_path = public, extensions as $$
declare s app_settings;
begin
  select * into s from app_settings where id = 1;
  if p_lat is null or p_lng is null
     or p_lat not between s.min_lat and s.max_lat
     or p_lng not between s.min_lng and s.max_lng then
    raise exception 'This location is outside the service area (Bangladesh)' using hint = 'OUT_OF_AREA';
  end if;
end $$;

create or replace function severity_weight(p severity_level) returns numeric
language sql immutable as $$
  select case p when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end::numeric
$$;

-- Weighted vote. Defends against fake accounts and outsiders:
--   * new accounts count less (0.25 → 0.5 → 1.0)
--   * locals count 1.5x, people far away 0.5x (current location or saved home)
--   * reputation adds up to +100%
create or replace function voter_weight(p_user uuid, p_issue_location geography, p_voter_location geography)
returns numeric
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s app_settings;
  v_age_hours numeric;
  v_rep int;
  v_home geography;
  v_dist double precision;
  w numeric := 1;
begin
  select * into s from app_settings where id = 1;
  select extract(epoch from now() - created_at) / 3600, reputation into v_age_hours, v_rep
    from profiles where id = p_user;
  select home_location into v_home from user_settings where user_id = p_user;

  if v_age_hours < s.new_account_hours then w := 0.25;
  elsif v_age_hours < s.established_account_hours then w := 0.5;
  end if;

  v_dist := least(coalesce(ST_Distance(p_voter_location, p_issue_location), 1e12),
                  coalesce(ST_Distance(v_home, p_issue_location), 1e12));
  if v_dist <= s.local_radius_m then w := w * 1.5;
  elsif v_dist > s.far_radius_m then w := w * 0.5;
  end if;

  w := w * (1 + least(greatest(coalesce(v_rep, 0), 0), 200) / 200.0);
  return round(least(w, 3), 2);
end $$;

create or replace function notify(p_user uuid, p_type text, p_issue uuid, p_actor uuid, p_message text)
returns void
language sql security definer set search_path = public, extensions as $$
  insert into notifications (user_id, type, issue_id, actor_id, message)
  select p_user, p_type, p_issue, p_actor, p_message
  where p_user is not null and p_user is distinct from p_actor
$$;

-- Everyone who cares about an issue: reporter, followers, on-site confirmers.
create or replace function notify_audience(p_issue uuid, p_type text, p_actor uuid, p_message text)
returns void
language sql security definer set search_path = public, extensions as $$
  insert into notifications (user_id, type, issue_id, actor_id, message)
  select distinct u, p_type, p_issue, p_actor, p_message
  from (
    select user_id as u from follows where issue_id = p_issue
    union select reporter_id from issues where id = p_issue
    union select user_id from confirmations where issue_id = p_issue
  ) audience
  where u is distinct from p_actor
$$;

create or replace function log_event(p_issue uuid, p_actor uuid, p_type text, p_note text, p_data jsonb)
returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint;
begin
  insert into issue_events (issue_id, actor_id, type, note, data)
  values (p_issue, p_actor, p_type, p_note, coalesce(p_data, '{}'))
  returning id into v_id;
  update issues set last_activity_at = now() where id = p_issue;
  return v_id;
end $$;

-- p_media: [{"path": "<uid>/<file>", "type": "image"|"video"}, ...]
-- Files must already be uploaded to Storage under the caller's own folder.
create or replace function attach_media(
  p_issue uuid, p_user uuid, p_kind media_kind, p_media jsonb, p_event bigint,
  p_min_items int, p_require_image boolean
) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  m record;
  v_total int := 0;
  v_images int := 0;
  v_videos int := 0;
begin
  for m in select * from jsonb_to_recordset(coalesce(p_media, '[]'::jsonb)) as x(path text, type text) loop
    if m.path is null or position(p_user::text || '/' in m.path) <> 1 then
      raise exception 'Invalid media file' using hint = 'BAD_MEDIA';
    end if;
    if m.type not in ('image', 'video') then
      raise exception 'Media must be an image or a video' using hint = 'BAD_MEDIA';
    end if;
    insert into issue_media (issue_id, uploader_id, kind, media_type, storage_path, event_id)
    values (p_issue, p_user, p_kind, m.type::media_type, m.path, p_event);
    v_total := v_total + 1;
    if m.type = 'image' then v_images := v_images + 1; else v_videos := v_videos + 1; end if;
  end loop;

  if v_total > 5 then raise exception 'You can attach up to 5 files' using hint = 'BAD_MEDIA'; end if;
  if v_videos > 1 then raise exception 'You can attach only one video' using hint = 'BAD_MEDIA'; end if;
  if v_total < p_min_items then raise exception 'Please attach a photo or video as evidence' using hint = 'MEDIA_REQUIRED'; end if;
  if p_require_image and v_images = 0 then raise exception 'Please attach at least one photo' using hint = 'MEDIA_REQUIRED'; end if;
  return v_total;
end $$;

-- ---------- The validation engine -----------------------------------
-- Recalculates every community score for an issue and moves it between
-- community_review / validated / hidden. Called after every vote,
-- confirmation, flag or severity vote.
create or replace function recompute_issue(p_issue uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  i issues;
  v_votes int; v_vote_w numeric;
  v_conf int;  v_conf_w numeric;
  v_flags int; v_flag_w numeric;
  v_sev severity_level;
  v_sev_votes int;
  v_threshold numeric;
  v_active_nearby int;
  v_score numeric;
  v_should_hide boolean;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found then return; end if;

  select count(*), coalesce(sum(weight), 0) into v_votes, v_vote_w from votes where issue_id = p_issue;
  select count(*), coalesce(sum(weight), 0) into v_conf, v_conf_w from confirmations where issue_id = p_issue;
  select count(*), coalesce(sum(weight), 0) into v_flags, v_flag_w from flags where issue_id = p_issue;

  -- Severity: category default until 3 people vote, then the median vote.
  select count(*) into v_sev_votes from severity_votes where issue_id = p_issue;
  if v_sev_votes >= 3 then
    select percentile_disc(0.5) within group (order by severity) into v_sev
      from severity_votes where issue_id = p_issue;
  else
    select default_severity into v_sev from categories where slug = i.category;
  end if;

  v_threshold := case v_sev
    when 'critical' then s.threshold_critical
    when 'high'     then s.threshold_high
    when 'medium'   then s.threshold_medium
    else s.threshold_low end;

  -- Low-participation areas: if few people are active nearby, a full
  -- threshold would never be reached, so it is lowered (never below min).
  select count(distinct u) into v_active_nearby from (
    select v.user_id as u from votes v join issues x on x.id = v.issue_id
     where v.created_at > now() - interval '30 days'
       and ST_DWithin(x.location, i.location, s.local_radius_m)
    union
    select x.reporter_id from issues x
     where x.created_at > now() - interval '30 days'
       and ST_DWithin(x.location, i.location, s.local_radius_m)
  ) active;
  if v_active_nearby < s.low_activity_user_count then
    v_threshold := greatest(s.min_threshold, ceil(v_threshold * s.low_activity_factor));
  end if;

  v_score := v_vote_w + v_conf_w;
  -- Ratio rule: hidden only if enough people flag it AND flags outweigh support.
  v_should_hide := v_flags >= s.hide_min_flags and v_flag_w > v_score;

  update issues
     set upvote_count = v_votes, confirmation_count = v_conf, flag_count = v_flags,
         validation_score = v_score, flag_score = v_flag_w,
         severity = v_sev, validation_threshold = v_threshold, updated_at = now()
   where id = p_issue;

  -- Hide / unhide. Only before a volunteer takes the issue.
  if v_should_hide and i.status in ('community_review', 'validated') then
    update issues set status = 'hidden', status_before_hidden = i.status where id = p_issue;
    perform log_event(p_issue, null, 'hidden',
      'Hidden automatically: more people flagged it as fake than vouched for it',
      jsonb_build_object('flags', v_flags, 'flag_score', v_flag_w, 'score', v_score));
    perform notify(i.reporter_id, 'issue_hidden', p_issue, null,
      format('Your report "%s" was hidden because many people flagged it. Support from others can bring it back.', i.title));
    return;
  elsif not v_should_hide and i.status = 'hidden' then
    i.status := coalesce(i.status_before_hidden, 'community_review');
    update issues set status = i.status, status_before_hidden = null where id = p_issue;
    perform log_event(p_issue, null, 'unhidden', 'Visible again: community support now outweighs the flags', null);
  end if;

  if i.status = 'community_review' and v_score >= v_threshold
     and v_votes + v_conf >= s.min_supporters then
    update issues set status = 'validated', validated_at = now() where id = p_issue;
    perform log_event(p_issue, null, 'validated',
      format('Validated by the community (score %s of %s needed)', v_score, v_threshold),
      jsonb_build_object('score', v_score, 'threshold', v_threshold));
    perform notify_audience(p_issue, 'issue_validated', null,
      format('"%s" was validated by the community and is now open for volunteers.', i.title));
  end if;
end $$;

-- ---------- Reporting -----------------------------------------------

-- Open issues of the same category close by. Used before posting so people
-- confirm the existing issue ("I see this too") instead of duplicating it.
create or replace function find_nearby_duplicates(p_lat double precision, p_lng double precision, p_category text)
returns table (
  id uuid, title text, status issue_status, distance_m double precision,
  upvote_count int, confirmation_count int, created_at timestamptz,
  thumb_path text, thumb_type media_type
)
language sql stable security definer set search_path = public, extensions as $$
  select i.id, i.title, i.status, ST_Distance(i.location, make_point(p_lat, p_lng)),
         i.upvote_count, i.confirmation_count, i.created_at, m.storage_path, m.media_type
  from issues i
  cross join app_settings s
  left join lateral (
    select storage_path, media_type from issue_media
     where issue_id = i.id and kind = 'report' order by created_at limit 1
  ) m on true
  where s.id = 1
    and i.category = p_category
    and i.status not in ('closed', 'hidden', 'expired')
    and i.created_at > now() - make_interval(days => s.duplicate_window_days)
    and ST_DWithin(i.location, make_point(p_lat, p_lng), s.duplicate_radius_m)
  order by 4
  limit 5
$$;

create or replace function create_issue(
  p_title text,
  p_description text,
  p_category text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m real,
  p_location_source text,
  p_address text,
  p_is_anonymous boolean,
  p_media jsonb,
  p_skip_duplicate_check boolean default false
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  v_sev severity_level;
  v_id uuid;
  v_event bigint;
begin
  select * into s from app_settings where id = 1;

  if (select count(*) from issues where reporter_id = v_user and created_at > now() - interval '24 hours')
     >= s.max_reports_per_day then
    raise exception 'You have reached the daily limit of % reports', s.max_reports_per_day using hint = 'RATE_LIMIT';
  end if;

  select default_severity into v_sev from categories where slug = p_category;
  if not found then raise exception 'Unknown category' using hint = 'BAD_CATEGORY'; end if;

  perform assert_in_service_area(p_lat, p_lng);

  if p_location_source not in ('gps', 'manual') then
    raise exception 'Invalid location source' using hint = 'BAD_LOCATION';
  end if;
  if p_location_source = 'gps' and (p_accuracy_m is null or p_accuracy_m > s.max_gps_accuracy_m) then
    raise exception 'GPS accuracy is too low (±% m). Drag the pin to the exact spot instead.',
      coalesce(round(p_accuracy_m)::text, '?') using hint = 'LOW_GPS_ACCURACY';
  end if;

  if not p_skip_duplicate_check
     and exists (select 1 from find_nearby_duplicates(p_lat, p_lng, p_category)) then
    raise exception 'A similar open issue already exists nearby' using hint = 'DUPLICATE_FOUND';
  end if;

  insert into issues (reporter_id, title, description, category, severity, location,
                      location_accuracy_m, location_source, address, is_anonymous)
  values (v_user, trim(p_title), coalesce(trim(p_description), ''), p_category, v_sev,
          make_point(p_lat, p_lng), p_accuracy_m, p_location_source,
          coalesce(trim(p_address), ''), coalesce(p_is_anonymous, false))
  returning id into v_id;

  v_event := log_event(v_id, v_user, 'created', null, null);
  perform attach_media(v_id, v_user, 'report', p_media, v_event, 1, false);

  insert into follows (issue_id, user_id) values (v_id, v_user);
  update issues set follower_count = 1 where id = v_id;
  update profiles set reports_count = reports_count + 1 where id = v_user;

  perform recompute_issue(v_id);
  return v_id;
end $$;

-- Reporter may edit only while the community is still reviewing.
create or replace function update_issue(
  p_issue uuid, p_title text, p_description text, p_category text, p_address text
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue for update;
  if not found or i.reporter_id <> v_user then
    raise exception 'You can only edit your own reports' using hint = 'FORBIDDEN';
  end if;
  if i.status <> 'community_review' then
    raise exception 'Reports can only be edited before they are validated' using hint = 'LOCKED';
  end if;
  if not exists (select 1 from categories where slug = p_category) then
    raise exception 'Unknown category' using hint = 'BAD_CATEGORY';
  end if;

  update issues
     set title = trim(p_title), description = coalesce(trim(p_description), ''),
         category = p_category, address = coalesce(trim(p_address), ''), updated_at = now()
   where id = p_issue;
  perform log_event(p_issue, v_user, 'edited', null, null);
  perform recompute_issue(p_issue);
end $$;

-- Returns the storage paths so the app can delete the files too.
create or replace function delete_issue(p_issue uuid) returns setof text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue for update;
  if not found or i.reporter_id <> v_user then
    raise exception 'You can only delete your own reports' using hint = 'FORBIDDEN';
  end if;
  if i.status not in ('community_review', 'hidden', 'expired') then
    raise exception 'Validated reports can no longer be deleted' using hint = 'LOCKED';
  end if;

  return query select storage_path from issue_media where issue_id = p_issue;
  delete from issues where id = p_issue;
  update profiles set reports_count = greatest(reports_count - 1, 0) where id = v_user;
end $$;

-- ---------- Community signals ---------------------------------------

create or replace function toggle_vote(p_issue uuid, p_lat double precision default null, p_lng double precision default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
  v_voted boolean;
begin
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.reporter_id = v_user then
    raise exception 'You can''t upvote your own report' using hint = 'OWN_ISSUE';
  end if;
  if i.status in ('closed', 'expired') then
    raise exception 'Voting is closed for this issue' using hint = 'LOCKED';
  end if;
  if exists (select 1 from confirmations where issue_id = p_issue and user_id = v_user) then
    raise exception 'You already confirmed this issue on-site, which counts more than an upvote' using hint = 'ALREADY_CONFIRMED';
  end if;

  if exists (select 1 from votes where issue_id = p_issue and user_id = v_user) then
    delete from votes where issue_id = p_issue and user_id = v_user;
    v_voted := false;
  else
    insert into votes (issue_id, user_id, weight)
    values (p_issue, v_user, voter_weight(v_user, i.location, make_point(p_lat, p_lng)));
    v_voted := true;
  end if;

  perform recompute_issue(p_issue);
  return jsonb_build_object('voted', v_voted);
end $$;

-- "I see this too": must be on-site with a photo. Replaces the user's upvote.
create or replace function confirm_issue(
  p_issue uuid, p_lat double precision, p_lng double precision, p_accuracy_m real,
  p_note text, p_media jsonb
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_here geography := make_point(p_lat, p_lng);
  v_dist double precision;
  v_event bigint;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.reporter_id = v_user then
    raise exception 'You reported this issue yourself' using hint = 'OWN_ISSUE';
  end if;
  if i.status not in ('community_review', 'validated', 'assigned', 'in_progress') then
    raise exception 'This issue can no longer be confirmed' using hint = 'LOCKED';
  end if;
  if exists (select 1 from confirmations where issue_id = p_issue and user_id = v_user) then
    raise exception 'You already confirmed this issue' using hint = 'ALREADY_CONFIRMED';
  end if;
  if v_here is null then
    raise exception 'Your location is needed to confirm an issue' using hint = 'LOCATION_REQUIRED';
  end if;

  v_dist := ST_Distance(v_here, i.location);
  if v_dist > s.confirm_radius_m + least(coalesce(p_accuracy_m, 0), 100) then
    raise exception 'You need to be within % m of the issue to confirm it (you are % m away)',
      s.confirm_radius_m, round(v_dist) using hint = 'TOO_FAR';
  end if;

  delete from votes where issue_id = p_issue and user_id = v_user;
  insert into confirmations (issue_id, user_id, note, distance_m, weight)
  values (p_issue, v_user, coalesce(trim(p_note), ''), v_dist,
          voter_weight(v_user, i.location, v_here) * s.confirmation_multiplier);

  v_event := log_event(p_issue, v_user, 'confirmed', nullif(trim(p_note), ''),
                       jsonb_build_object('distance_m', round(v_dist)));
  perform attach_media(p_issue, v_user, 'confirmation', p_media, v_event, 1, true);

  insert into follows (issue_id, user_id) values (p_issue, v_user) on conflict do nothing;
  update issues set follower_count = (select count(*) from follows where issue_id = p_issue) where id = p_issue;

  perform notify(i.reporter_id, 'issue_confirmed', p_issue, v_user,
    format('Someone confirmed "%s" on-site with a photo.', i.title));
  perform recompute_issue(p_issue);
end $$;

create or replace function flag_issue(p_issue uuid, p_reason flag_reason, p_details text default '')
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.reporter_id = v_user then
    raise exception 'You can''t flag your own report' using hint = 'OWN_ISSUE';
  end if;
  if i.status not in ('community_review', 'validated', 'hidden') then
    raise exception 'This issue can no longer be flagged' using hint = 'LOCKED';
  end if;

  insert into flags (issue_id, user_id, reason, details, weight)
  values (p_issue, v_user, p_reason, coalesce(trim(p_details), ''), voter_weight(v_user, i.location, null))
  on conflict (issue_id, user_id) do update set reason = excluded.reason, details = excluded.details;

  -- Flaggers stay anonymous to the reporter (actor = null).
  perform notify(i.reporter_id, 'issue_flagged', p_issue, null,
    format('Someone flagged your report "%s" as %s.', i.title, replace(p_reason::text, '_', ' ')));
  perform recompute_issue(p_issue);
end $$;

create or replace function unflag_issue(p_issue uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_user uuid := require_user();
begin
  delete from flags where issue_id = p_issue and user_id = v_user;
  perform recompute_issue(p_issue);
end $$;

create or replace function vote_severity(p_issue uuid, p_severity severity_level) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.status in ('closed', 'expired') then
    raise exception 'This issue is closed' using hint = 'LOCKED';
  end if;
  insert into severity_votes (issue_id, user_id, severity) values (p_issue, v_user, p_severity)
  on conflict (issue_id, user_id) do update set severity = excluded.severity, created_at = now();
  perform recompute_issue(p_issue);
end $$;

create or replace function toggle_follow(p_issue uuid) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  v_following boolean;
begin
  if not exists (select 1 from issues where id = p_issue) then
    raise exception 'Issue not found' using hint = 'NOT_FOUND';
  end if;
  if exists (select 1 from follows where issue_id = p_issue and user_id = v_user) then
    delete from follows where issue_id = p_issue and user_id = v_user;
    v_following := false;
  else
    insert into follows (issue_id, user_id) values (p_issue, v_user);
    v_following := true;
  end if;
  update issues set follower_count = (select count(*) from follows where issue_id = p_issue) where id = p_issue;
  return v_following;
end $$;

-- ---------- Comments ------------------------------------------------

create or replace function add_comment(p_issue uuid, p_body text, p_parent uuid default null, p_is_update boolean default false)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
  v_parent comments;
  v_id uuid;
  v_name text;
begin
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if (select count(*) from comments where author_id = v_user and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'You are commenting too fast. Please wait a bit.' using hint = 'RATE_LIMIT';
  end if;

  -- Facebook-style: one level of replies. Replies to replies attach to the top comment.
  if p_parent is not null then
    select * into v_parent from comments where id = p_parent and issue_id = p_issue;
    if not found then raise exception 'Comment not found' using hint = 'NOT_FOUND'; end if;
    if v_parent.parent_id is not null then p_parent := v_parent.parent_id; end if;
  end if;

  insert into comments (issue_id, author_id, parent_id, body, is_update)
  values (p_issue, v_user, p_parent, trim(p_body), coalesce(p_is_update, false))
  returning id into v_id;

  update issues set comment_count = comment_count + 1, last_activity_at = now() where id = p_issue;

  select coalesce(nullif(full_name, ''), username) into v_name from profiles where id = v_user;
  if p_is_update then
    perform notify_audience(p_issue, 'issue_update', v_user,
      format('%s shared an update on "%s".', v_name, i.title));
  else
    perform notify(i.reporter_id, 'comment', p_issue, v_user,
      format('%s commented on your report "%s".', v_name, i.title));
  end if;
  if v_parent.id is not null then
    perform notify(v_parent.author_id, 'reply', p_issue, v_user,
      format('%s replied to your comment.', v_name));
  end if;
  return v_id;
end $$;

create or replace function edit_comment(p_comment uuid, p_body text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_user uuid := require_user();
begin
  update comments set body = trim(p_body), edited_at = now()
   where id = p_comment and author_id = v_user and deleted_at is null;
  if not found then raise exception 'You can only edit your own comments' using hint = 'FORBIDDEN'; end if;
end $$;

create or replace function delete_comment(p_comment uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  v_issue uuid;
begin
  update comments set deleted_at = now()
   where id = p_comment and author_id = v_user and deleted_at is null
  returning issue_id into v_issue;
  if not found then raise exception 'You can only delete your own comments' using hint = 'FORBIDDEN'; end if;
  update issues set comment_count = greatest(comment_count - 1, 0) where id = v_issue;
end $$;

-- Inappropriate comments hide themselves after enough flags.
create or replace function flag_comment(p_comment uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  c comments;
  v_limit int;
begin
  select * into c from comments where id = p_comment;
  if not found then raise exception 'Comment not found' using hint = 'NOT_FOUND'; end if;
  if c.author_id = v_user then raise exception 'You can''t flag your own comment' using hint = 'OWN_COMMENT'; end if;

  insert into comment_flags (comment_id, user_id) values (p_comment, v_user) on conflict do nothing;
  select comment_hide_flags into v_limit from app_settings where id = 1;
  update comments
     set flag_count = (select count(*) from comment_flags where comment_id = p_comment),
         is_hidden = (select count(*) from comment_flags where comment_id = p_comment) >= v_limit
   where id = p_comment;
end $$;

-- ---------- Volunteer workflow --------------------------------------

create or replace function set_volunteer_mode(p_on boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  v_min int;
begin
  if p_on then
    select volunteer_min_account_hours into v_min from app_settings where id = 1;
    if (select created_at from profiles where id = v_user) > now() - make_interval(hours => v_min) then
      raise exception 'Your account must be at least % hours old to volunteer', v_min using hint = 'ACCOUNT_TOO_NEW';
    end if;
    update profiles set is_volunteer = true, volunteer_since = coalesce(volunteer_since, now()) where id = v_user;
  else
    if exists (select 1 from assignments where volunteer_id = v_user and outcome = 'active') then
      raise exception 'Finish or release your active tasks first' using hint = 'HAS_ACTIVE_TASKS';
    end if;
    update profiles set is_volunteer = false where id = v_user;
  end if;
end $$;

-- Atomic accept: the UPDATE only succeeds while the issue is still free,
-- so two volunteers pressing "Accept" at the same moment can't both win.
create or replace function accept_task(p_issue uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_rows int;
  v_assignment bigint;
begin
  select * into s from app_settings where id = 1;
  if not (select is_volunteer from profiles where id = v_user) then
    raise exception 'Turn on volunteer mode first' using hint = 'NOT_VOLUNTEER';
  end if;
  if (select count(*) from assignments where volunteer_id = v_user and outcome = 'active') >= s.max_active_tasks then
    raise exception 'You can have at most % active tasks', s.max_active_tasks using hint = 'TOO_MANY_TASKS';
  end if;

  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.reporter_id = v_user then
    raise exception 'You can''t take a task you reported yourself' using hint = 'OWN_ISSUE';
  end if;
  if exists (select 1 from assignments where issue_id = p_issue and volunteer_id = v_user
              and outcome in ('expired', 'reopened')) then
    raise exception 'You already had this task and it was not completed; another volunteer should try' using hint = 'PREVIOUSLY_FAILED';
  end if;

  update issues
     set volunteer_id = v_user, status = 'assigned', assigned_at = now(),
         lock_expires_at = now() + make_interval(hours => s.lock_hours),
         lock_reminder_sent = false, updated_at = now()
   where id = p_issue and status = 'validated' and volunteer_id is null;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'This task is no longer available — another volunteer may have taken it' using hint = 'TASK_TAKEN';
  end if;

  insert into assignments (issue_id, volunteer_id) values (p_issue, v_user) returning id into v_assignment;
  update issues set assignment_id = v_assignment where id = p_issue;
  insert into follows (issue_id, user_id) values (p_issue, v_user) on conflict do nothing;

  perform log_event(p_issue, v_user, 'assigned', null,
    jsonb_build_object('lock_expires_at', now() + make_interval(hours => s.lock_hours)));
  perform notify_audience(p_issue, 'task_accepted', v_user,
    format('A volunteer accepted "%s".', i.title));
end $$;

create or replace function end_assignment(p_issue uuid, p_outcome text) returns void
language sql security definer set search_path = public, extensions as $$
  update assignments set outcome = p_outcome, ended_at = now()
   where issue_id = p_issue and outcome = 'active'
$$;

-- Back to the volunteer pool (used by release, lock expiry and reopen).
create or replace function return_to_pool(p_issue uuid) returns void
language sql security definer set search_path = public, extensions as $$
  update issues
     set status = 'validated', volunteer_id = null, assignment_id = null, assigned_at = null,
         lock_expires_at = null, lock_reminder_sent = false,
         resolution_note = null, resolution_submitted_at = null, updated_at = now()
   where id = p_issue
$$;

-- Every progress update restarts the lock clock.
create or replace function post_progress(p_issue uuid, p_note text, p_media jsonb default '[]')
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_event bigint;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found or i.volunteer_id is distinct from v_user or i.status not in ('assigned', 'in_progress') then
    raise exception 'This is not your active task' using hint = 'FORBIDDEN';
  end if;
  if char_length(coalesce(trim(p_note), '')) < 3 then
    raise exception 'Please describe your progress' using hint = 'NOTE_REQUIRED';
  end if;

  update issues
     set status = 'in_progress',
         lock_expires_at = now() + make_interval(hours => s.lock_hours),
         lock_reminder_sent = false, updated_at = now()
   where id = p_issue;

  v_event := log_event(p_issue, v_user, 'progress', trim(p_note), null);
  perform attach_media(p_issue, v_user, 'progress', p_media, v_event, 0, false);
  perform notify_audience(p_issue, 'task_progress', v_user,
    format('Progress update on "%s": %s', i.title, left(trim(p_note), 80)));
end $$;

-- Giving a task back before the deadline carries no penalty.
create or replace function release_task(p_issue uuid, p_reason text default '') returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue for update;
  if not found or i.volunteer_id is distinct from v_user or i.status not in ('assigned', 'in_progress') then
    raise exception 'This is not your active task' using hint = 'FORBIDDEN';
  end if;

  perform end_assignment(p_issue, 'released');
  perform return_to_pool(p_issue);
  perform log_event(p_issue, v_user, 'released', nullif(trim(p_reason), ''), null);
  perform notify_audience(p_issue, 'task_released', v_user,
    format('The volunteer released "%s". It is open for other volunteers again.', i.title));
end $$;

-- Volunteer must be at the spot (GPS) and attach at least one "after" photo.
create or replace function submit_resolution(
  p_issue uuid, p_note text, p_lat double precision, p_lng double precision,
  p_accuracy_m real, p_media jsonb
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_here geography := make_point(p_lat, p_lng);
  v_dist double precision;
  v_event bigint;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found or i.volunteer_id is distinct from v_user or i.status not in ('assigned', 'in_progress') then
    raise exception 'This is not your active task' using hint = 'FORBIDDEN';
  end if;
  if char_length(coalesce(trim(p_note), '')) < 3 then
    raise exception 'Please describe what was done' using hint = 'NOTE_REQUIRED';
  end if;
  if v_here is null then
    raise exception 'Your location is needed to submit a resolution' using hint = 'LOCATION_REQUIRED';
  end if;
  v_dist := ST_Distance(v_here, i.location);
  if v_dist > s.resolution_radius_m + least(coalesce(p_accuracy_m, 0), 100) then
    raise exception 'You must be at the issue location (within % m) to submit the fix. You are % m away.',
      s.resolution_radius_m, round(v_dist) using hint = 'TOO_FAR';
  end if;

  update issues
     set status = 'resolution_submitted', resolution_note = trim(p_note),
         resolution_submitted_at = now(), lock_expires_at = null, updated_at = now()
   where id = p_issue;

  v_event := log_event(p_issue, v_user, 'resolution_submitted', trim(p_note),
                       jsonb_build_object('distance_m', round(v_dist)));
  perform attach_media(p_issue, v_user, 'resolution', p_media, v_event, 1, true);
  perform notify_audience(p_issue, 'resolution_submitted', v_user,
    format('The volunteer says "%s" is fixed. Is it? Please confirm.', i.title));
end $$;

create or replace function close_issue(p_issue uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  i issues;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;

  update issues set status = 'closed', closed_at = now(), updated_at = now() where id = p_issue;
  perform end_assignment(p_issue, 'completed');
  update profiles
     set reputation = reputation + s.rep_task_completed, tasks_completed = tasks_completed + 1
   where id = i.volunteer_id;

  perform log_event(p_issue, null, 'closed', null, jsonb_build_object('reason', p_reason));
  perform notify(i.volunteer_id, 'task_completed', p_issue, null,
    format('"%s" is confirmed fixed. +%s reputation!', i.title, s.rep_task_completed));
  perform notify(i.reporter_id, 'rate_volunteer', p_issue, null,
    format('"%s" is closed. Please rate the volunteer.', i.title));
  perform notify_audience(p_issue, 'issue_closed', i.volunteer_id,
    format('"%s" has been resolved and closed.', i.title));
end $$;

create or replace function reopen_issue(p_issue uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  i issues;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;

  perform end_assignment(p_issue, 'reopened');
  update profiles
     set reputation = reputation + s.rep_task_reopened, tasks_reopened = tasks_reopened + 1
   where id = i.volunteer_id;
  perform return_to_pool(p_issue);

  perform log_event(p_issue, null, 'reopened', null,
    jsonb_build_object('reason', p_reason, 'previous_volunteer', i.volunteer_id));
  perform notify(i.volunteer_id, 'resolution_disputed', p_issue, null,
    format('Your fix for "%s" was disputed and the issue was reopened (%s reputation).', i.title, s.rep_task_reopened));
  perform notify_audience(p_issue, 'issue_reopened', i.volunteer_id,
    format('"%s" was reopened — the problem is not fixed yet.', i.title));
end $$;

-- Who can judge a fix: the reporter (decides alone), or nearby citizens /
-- on-site confirmers (need resolution_quorum agreeing votes).
create or replace function review_resolution(
  p_issue uuid, p_is_fixed boolean, p_lat double precision default null, p_lng double precision default null
) returns issue_status
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_is_reporter boolean;
  v_home geography;
  v_fixed int;
  v_not_fixed int;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.status <> 'resolution_submitted' then
    raise exception 'There is no resolution waiting for confirmation' using hint = 'LOCKED';
  end if;
  if i.volunteer_id = v_user then
    raise exception 'You can''t confirm your own fix' using hint = 'OWN_TASK';
  end if;

  v_is_reporter := i.reporter_id = v_user;
  if not v_is_reporter
     and not exists (select 1 from confirmations where issue_id = p_issue and user_id = v_user) then
    select home_location into v_home from user_settings where user_id = v_user;
    if coalesce(ST_DWithin(make_point(p_lat, p_lng), i.location, s.reviewer_radius_m), false) = false
       and coalesce(ST_DWithin(v_home, i.location, s.reviewer_radius_m), false) = false then
      raise exception 'Only the reporter or people near this issue can confirm the fix' using hint = 'NOT_NEARBY';
    end if;
  end if;

  insert into resolution_reviews (issue_id, assignment_id, user_id, is_fixed)
  values (p_issue, i.assignment_id, v_user, p_is_fixed)
  on conflict (assignment_id, user_id) do update set is_fixed = excluded.is_fixed, created_at = now();

  perform log_event(p_issue, case when v_is_reporter and i.is_anonymous then null else v_user end,
    'resolution_review', null, jsonb_build_object('is_fixed', p_is_fixed, 'by_reporter', v_is_reporter));

  if v_is_reporter then
    if p_is_fixed then perform close_issue(p_issue, 'reporter_confirmed');
    else perform reopen_issue(p_issue, 'reporter_disputed'); end if;
  else
    select count(*) filter (where r.is_fixed), count(*) filter (where not r.is_fixed)
      into v_fixed, v_not_fixed
      from resolution_reviews r
     where r.assignment_id = i.assignment_id and r.user_id <> i.reporter_id;
    if v_fixed >= s.resolution_quorum then perform close_issue(p_issue, 'community_confirmed');
    elsif v_not_fixed >= s.resolution_quorum then perform reopen_issue(p_issue, 'community_disputed');
    end if;
  end if;

  return (select status from issues where id = p_issue);
end $$;

create or replace function rate_volunteer(p_issue uuid, p_stars int, p_review text default '') returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue;
  if not found or i.reporter_id <> v_user then
    raise exception 'Only the reporter can rate the volunteer' using hint = 'FORBIDDEN';
  end if;
  if i.status <> 'closed' or i.assignment_id is null then
    raise exception 'You can rate once the issue is closed' using hint = 'LOCKED';
  end if;
  if p_stars not between 1 and 5 then
    raise exception 'Rating must be 1 to 5 stars' using hint = 'BAD_RATING';
  end if;
  if exists (select 1 from ratings where assignment_id = i.assignment_id) then
    raise exception 'You already rated this volunteer' using hint = 'ALREADY_RATED';
  end if;

  insert into ratings (issue_id, assignment_id, volunteer_id, rater_id, stars, review)
  values (p_issue, i.assignment_id, i.volunteer_id, v_user, p_stars, coalesce(trim(p_review), ''));
  update profiles
     set rating_sum = rating_sum + p_stars, rating_count = rating_count + 1,
         reputation = reputation + (p_stars - 3) * s.rep_per_star
   where id = i.volunteer_id;
  perform notify(i.volunteer_id, 'rated', p_issue, case when i.is_anonymous then null else v_user end,
    format('You received %s★ for "%s".', p_stars, i.title));
end $$;

-- ---------- Scheduled maintenance (hourly via pg_cron, see 0005) -----
create or replace function run_maintenance() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  r record;
  v_reminders int := 0;
  v_expired_locks int := 0;
  v_closed int := 0;
  v_reopened int := 0;
  v_expired_reviews int := 0;
  v_fixed int;
  v_not_fixed int;
begin
  select * into s from app_settings where id = 1;

  -- 1. Reminder before a lock runs out
  for r in
    select id, volunteer_id, title, lock_expires_at from issues
     where status in ('assigned', 'in_progress') and not lock_reminder_sent
       and lock_expires_at > now()
       and lock_expires_at <= now() + make_interval(hours => s.lock_reminder_hours)
  loop
    perform notify(r.volunteer_id, 'lock_reminder', r.id, null,
      format('Less than %s hours left on "%s". Post a progress update or release the task.', s.lock_reminder_hours, r.title));
    update issues set lock_reminder_sent = true where id = r.id;
    v_reminders := v_reminders + 1;
  end loop;

  -- 2. Expired locks: task goes back to the pool, volunteer loses reputation
  for r in
    select id, volunteer_id, title from issues
     where status in ('assigned', 'in_progress') and lock_expires_at <= now()
     for update skip locked
  loop
    perform end_assignment(r.id, 'expired');
    update profiles set reputation = reputation + s.rep_task_expired, tasks_expired = tasks_expired + 1
     where id = r.volunteer_id;
    perform return_to_pool(r.id);
    perform log_event(r.id, null, 'lock_expired', null, jsonb_build_object('previous_volunteer', r.volunteer_id));
    perform notify(r.volunteer_id, 'lock_expired', r.id, null,
      format('Your task "%s" expired without progress (%s reputation).', r.title, s.rep_task_expired));
    perform notify_audience(r.id, 'task_released', r.volunteer_id,
      format('"%s" is open for volunteers again.', r.title));
    v_expired_locks := v_expired_locks + 1;
  end loop;

  -- 3. Resolutions nobody decided on: majority of reviews wins; no disputes → close
  for r in
    select id, assignment_id, reporter_id from issues
     where status = 'resolution_submitted'
       and resolution_submitted_at <= now() - make_interval(days => s.auto_close_days)
     for update skip locked
  loop
    select count(*) filter (where is_fixed), count(*) filter (where not is_fixed)
      into v_fixed, v_not_fixed
      from resolution_reviews where assignment_id = r.assignment_id;
    if v_not_fixed = 0 or v_fixed > v_not_fixed then
      perform close_issue(r.id, 'auto_closed');
      v_closed := v_closed + 1;
    else
      perform reopen_issue(r.id, 'auto_reopened');
      v_reopened := v_reopened + 1;
    end if;
  end loop;

  -- 4. Reports the community never validated
  for r in
    select id, reporter_id, title from issues
     where status = 'community_review'
       and created_at <= now() - make_interval(days => s.review_expiry_days)
     for update skip locked
  loop
    update issues set status = 'expired', updated_at = now() where id = r.id;
    perform log_event(r.id, null, 'expired', null, null);
    perform notify(r.reporter_id, 'issue_expired', r.id, null,
      format('"%s" expired because it did not get enough community support in %s days.', r.title, s.review_expiry_days));
    v_expired_reviews := v_expired_reviews + 1;
  end loop;

  return jsonb_build_object(
    'reminders', v_reminders, 'expired_locks', v_expired_locks,
    'auto_closed', v_closed, 'auto_reopened', v_reopened, 'expired_reviews', v_expired_reviews);
end $$;

-- ---------- Profiles ------------------------------------------------

-- Creates the profile + settings when someone signs up.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_base text;
  v_username text;
  n int := 0;
begin
  v_base := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username',
                                          split_part(new.email, '@', 1), 'user'), '[^a-zA-Z0-9_]', '', 'g'));
  if char_length(v_base) < 3 then v_base := v_base || 'user'; end if;
  v_base := left(v_base, 18);
  v_username := v_base;
  while exists (select 1 from profiles where username = v_username) loop
    n := n + 1;
    v_username := v_base || (floor(random() * 9000) + 1000)::int;
    if n > 20 then v_username := 'user_' || left(replace(new.id::text, '-', ''), 12); exit; end if;
  end loop;

  insert into profiles (id, username, full_name)
  values (new.id, v_username, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80));
  insert into user_settings (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create or replace function update_my_settings(
  p_home_lat double precision, p_home_lng double precision,
  p_default_anonymous boolean, p_show_on_leaderboard boolean
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_user uuid := require_user();
begin
  if p_home_lat is not null then perform assert_in_service_area(p_home_lat, p_home_lng); end if;
  update user_settings
     set home_location = make_point(p_home_lat, p_home_lng),
         default_anonymous = coalesce(p_default_anonymous, default_anonymous),
         show_on_leaderboard = coalesce(p_show_on_leaderboard, show_on_leaderboard),
         updated_at = now()
   where user_id = v_user;
end $$;
