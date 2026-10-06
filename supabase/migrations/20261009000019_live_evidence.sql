-- =====================================================================
-- AmarShohor — 0019: live evidence and verified emergencies
--
-- Live photos/videos
--   Emergency photos must be taken with the in-app camera, not picked from
--   the gallery. Opening the camera asks the server for a capture code tied
--   to the person, the time and their GPS spot. The code is stamped on the
--   photo. When the alert or confirmation is sent, the server checks:
--     - the code is theirs and unused,
--     - the file reached storage within live_capture_seconds of the code
--       (storage.objects.created_at is set by the server, not the phone),
--     - the GPS spot at capture is within emergency_verify_radius_m.
--
-- Verified emergencies
--   An alert becomes verified when emergency_verify_confirms people (not the
--   reporter, not brand-new accounts) say "I see it too" with live GPS within
--   emergency_verify_radius_m, confirmations outnumber denials, and there is
--   at least one live photo/video (from the reporter or an on-site confirmer).
--   Confirm/deny now need live GPS; home location only counts for "it's over".
--
-- A verified alert raised from an issue makes the issue critical (severity
-- votes can't lower it), skips the wait for community validation, and is
-- logged on its timeline. If the alert is later hidden as false, that's undone.
--
-- What it shows, not just where and when
--   A live photo proves time and place, not content. So:
--   - "I see it too" means picking what you see (fire, gas leak, …). Only
--     answers matching the alert's kind count towards verification
--     (any kind matches an "other" alert).
--   - A verified alert goes to people for a look at the evidence: admins and
--     the officials of the City Corporation covering the spot. "Keep" makes it
--     final (denials can no longer hide it). "Reject" (with a reason) hides it,
--     undoes the issue's critical severity and costs the reporter and the
--     confirmers who counted reputation. Until then the issue stays critical:
--     a real emergency doesn't wait for a reviewer.
-- =====================================================================

set search_path = public, extensions;

alter table app_settings
  add column emergency_verify_confirms  int not null default 2,
  add column emergency_verify_radius_m  int not null default 300,
  add column live_capture_seconds       int not null default 120,
  add column rep_false_confirm          int not null default -5;

-- ---------- Capture codes --------------------------------------------
create table capture_tokens (
  id         uuid primary key default gen_random_uuid(),
  code       text not null,                 -- short code stamped on the photo
  user_id    uuid not null references profiles(id) on delete cascade,
  location   geography(Point, 4326) not null,
  accuracy_m real not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
create index capture_tokens_user_idx on capture_tokens (user_id, created_at desc);
alter table capture_tokens enable row level security;  -- only reached through the functions below

alter table emergency_alerts
  add column live_evidence boolean not null default false,
  add column verified_at   timestamptz,
  -- after verification: pending → kept / rejected by an admin or the area's officials
  add column review_status text check (review_status in ('pending', 'kept', 'rejected')),
  add column reviewed_by   uuid references profiles(id) on delete set null,
  add column reviewed_at   timestamptz,
  add column review_note   text;
create index emergency_alerts_review_idx on emergency_alerts (verified_at) where review_status = 'pending';

alter table emergency_responses
  add column on_site   boolean not null default false,  -- live GPS within the verify radius
  add column trusted   boolean not null default false,  -- account older than new_account_hours
  add column media     jsonb   not null default '[]',   -- live photos with "I see it too"
  add column seen_kind emergency_kind;                  -- what they said they see (confirm only)

alter table issues
  add column emergency_verified_at timestamptz,
  add column emergency_alert_id    uuid references emergency_alerts(id) on delete set null;

-- Opening the in-app camera. Returns the code to stamp on the photo.
create or replace function start_live_capture(p_lat double precision, p_lng double precision, p_accuracy real)
returns table (token uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  t capture_tokens;
begin
  select * into s from app_settings where id = 1;
  if p_lat is null or p_lng is null or p_accuracy is null then
    raise exception 'Turn on location to take a live photo' using hint = 'NO_GPS';
  end if;
  if p_accuracy > s.max_gps_accuracy_m then
    raise exception 'GPS is only accurate to ±% m. Move to an open spot and try again.', round(p_accuracy)
      using hint = 'LOW_GPS_ACCURACY';
  end if;
  if (select count(*) from capture_tokens where user_id = v_user and created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'Too many photos in a short time. Wait a few minutes.' using hint = 'RATE_LIMIT';
  end if;
  delete from capture_tokens where user_id = v_user and created_at < now() - interval '1 day';
  insert into capture_tokens (code, user_id, location, accuracy_m)
  values (upper(substr(md5(gen_random_uuid()::text), 1, 6)), v_user, make_point(p_lat, p_lng), p_accuracy)
  returning * into t;
  return query select t.id, t.code, t.created_at + make_interval(secs => s.live_capture_seconds);
end $$;

-- Checks live media and uses up its codes. Returns what is stored:
-- [{"path", "type", "live": true, "code", "taken_at"}]
create or replace function take_live_media(p_media jsonb, p_user uuid, p_point geography)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  m record;
  t capture_tokens;
  v_uploaded timestamptz;
  v_out jsonb := '[]';
begin
  select * into s from app_settings where id = 1;
  if jsonb_array_length(coalesce(p_media, '[]')) > 3 then
    raise exception 'You can attach up to 3 files' using hint = 'BAD_MEDIA';
  end if;
  for m in select * from jsonb_to_recordset(coalesce(p_media, '[]'::jsonb)) as x(path text, type text, token text) loop
    if m.path is null or position(p_user::text || '/' in m.path) <> 1 or m.type not in ('image', 'video') then
      raise exception 'Invalid media file' using hint = 'BAD_MEDIA';
    end if;
    if m.token is null or m.token !~ '^[0-9a-f-]{36}$' then
      raise exception 'Only live photos or videos taken with the in-app camera can be attached' using hint = 'NOT_LIVE';
    end if;
    select * into t from capture_tokens where id = m.token::uuid and user_id = p_user for update;
    if not found or t.used_at is not null or t.created_at < now() - interval '30 minutes' then
      raise exception 'This live photo has expired or was already used. Take a new one.' using hint = 'NOT_LIVE';
    end if;
    select o.created_at into v_uploaded from storage.objects o where o.bucket_id = 'media' and o.name = m.path;
    if v_uploaded is null or v_uploaded < t.created_at
       or v_uploaded > t.created_at + make_interval(secs => s.live_capture_seconds) then
      raise exception 'Live photos must be taken and sent within % seconds. Take a new one.', s.live_capture_seconds
        using hint = 'NOT_LIVE';
    end if;
    if not ST_DWithin(t.location, p_point, s.emergency_verify_radius_m) then
      raise exception 'This photo was taken more than % m from the emergency', s.emergency_verify_radius_m
        using hint = 'TOO_FAR';
    end if;
    update capture_tokens set used_at = now() where id = t.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'path', m.path, 'type', m.type, 'live', true, 'code', t.code, 'taken_at', t.created_at));
  end loop;
  return v_out;
end $$;

-- ---------- Severity: verified emergencies are critical --------------
-- Same as 0009, plus: emergency_verified_at sets severity to critical and
-- counts as community validation.
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

  -- Severity: category starting point until 3 people vote, then the median vote.
  select count(*) into v_sev_votes from severity_votes where issue_id = p_issue;
  if v_sev_votes >= 3 then
    select percentile_disc(0.5) within group (order by severity) into v_sev
      from severity_votes where issue_id = p_issue;
  else
    v_sev := coalesce(i.base_severity,
                      (select default_severity from categories where slug = i.category),
                      'medium');
  end if;
  -- A verified emergency on this issue: critical, whatever the votes say.
  if i.emergency_verified_at is not null then v_sev := 'critical'; end if;

  v_threshold := case v_sev
    when 'critical' then s.threshold_critical
    when 'high'     then s.threshold_high
    when 'medium'   then s.threshold_medium
    else s.threshold_low end;

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
  v_should_hide := v_flags >= s.hide_min_flags and v_flag_w > v_score;

  update issues
     set upvote_count = v_votes, confirmation_count = v_conf, flag_count = v_flags,
         validation_score = v_score, flag_score = v_flag_w,
         severity = v_sev, validation_threshold = v_threshold, updated_at = now()
   where id = p_issue;

  -- Hide / unhide. Only before anyone takes the issue.
  if v_should_hide and i.status in ('community_review', 'validated', 'escalated') then
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

  if i.status = 'community_review'
     and ((v_score >= v_threshold and v_votes + v_conf >= s.min_supporters) or i.emergency_verified_at is not null) then
    update issues set status = 'validated', validated_at = now() where id = p_issue;
    if i.emergency_verified_at is not null and not (v_score >= v_threshold and v_votes + v_conf >= s.min_supporters) then
      perform log_event(p_issue, null, 'validated', 'Validated: people on site verified it as an emergency',
        jsonb_build_object('emergency_alert_id', i.emergency_alert_id));
    else
      perform log_event(p_issue, null, 'validated',
        format('Validated by the community (score %s of %s needed)', v_score, v_threshold),
        jsonb_build_object('score', v_score, 'threshold', v_threshold));
    end if;
    if i.route = 'authority' then
      perform escalate_issue(p_issue, null, null);
    elsif i.route = 'community' then
      perform notify_audience(p_issue, 'issue_validated', null,
        format('"%s" was validated by the community and is now open for volunteers.', i.title));
    else
      perform notify_audience(p_issue, 'issue_validated', null,
        format('"%s" was validated. An admin is deciding whether volunteers or the City Corporation should fix it.', i.title));
    end if;
  end if;
end $$;

-- ---------- Verification ---------------------------------------------
create or replace function maybe_verify_alert(p_alert uuid) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  e emergency_alerts;
  v_on_site int;
  v_evidence boolean;
begin
  select * into s from app_settings where id = 1;
  select * into e from emergency_alerts where id = p_alert for update;
  if not found or e.status <> 'active' or e.verified_at is not null then return false; end if;

  -- Only on-site witnesses who named the same thing count.
  select count(*) into v_on_site from emergency_responses
   where alert_id = p_alert and response = 'confirm' and on_site and trusted
     and (seen_kind = e.kind or e.kind = 'other');
  v_evidence := e.live_evidence or exists (
    select 1 from emergency_responses
     where alert_id = p_alert and response = 'confirm' and on_site and jsonb_array_length(media) > 0
       and (seen_kind = e.kind or e.kind = 'other'));
  if v_on_site < s.emergency_verify_confirms or e.confirm_count <= e.deny_count or not v_evidence then
    return false;
  end if;

  update emergency_alerts set verified_at = now(), review_status = 'pending' where id = p_alert;
  insert into notifications (user_id, type, alert_id, message)
  values (e.reporter_id, 'emergency_verified', p_alert,
          format('People on site verified your alert: %s.', emergency_label(e.kind)));
  -- People who look at the evidence: admins and the officials of the area.
  insert into notifications (user_id, type, alert_id, message)
  select distinct r.user_id, 'emergency_review', p_alert,
         format('Verified emergency to check: %s near %s. Look at the live evidence and keep or reject it.',
                emergency_label(e.kind), coalesce(nullif(e.address, ''), 'an unnamed spot'))
    from user_roles r
   where r.user_id <> e.reporter_id
     and (r.role = 'admin' or (r.role = 'official' and r.authority_id = find_authority(e.location)));

  if e.issue_id is not null then
    update issues set emergency_verified_at = now(), emergency_alert_id = p_alert
     where id = e.issue_id and emergency_verified_at is null;
    if found then
      perform log_event(e.issue_id, null, 'emergency_verified',
        format('%s verified by %s people on site. Severity set to critical.', emergency_label(e.kind), v_on_site),
        jsonb_build_object('alert_id', p_alert, 'on_site', v_on_site));
      perform recompute_issue(e.issue_id);
      perform notify_audience(e.issue_id, 'emergency_verified', null,
        format('"%s" was verified as an emergency by people on site. It is now critical.',
               (select title from issues where id = e.issue_id)));
    end if;
  end if;
  return true;
end $$;

-- A false alert takes back what it did to its issue.
create or replace function unverify_alert_issue(p_alert uuid, p_actor uuid default null, p_note text default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_issue uuid;
begin
  update issues set emergency_verified_at = null, emergency_alert_id = null
   where emergency_alert_id = p_alert
  returning id into v_issue;
  if v_issue is not null then
    perform log_event(v_issue, p_actor, 'emergency_unverified',
      coalesce(p_note, 'The emergency alert was hidden as false.') || ' Severity goes back to the community vote.',
      jsonb_build_object('alert_id', p_alert));
    perform recompute_issue(v_issue);
  end if;
end $$;

-- Can this person look at the evidence and keep or reject the alert?
create or replace function can_review_alert(p_user uuid, p_location geography) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_user is not null
     and (is_admin(p_user) or official_authority(p_user) = find_authority(p_location))
$$;

-- Keep: the verification stands for good. Reject: a fake or mismatched
-- emergency — hidden, the issue's critical severity undone, reputation lost.
create or replace function review_emergency(p_alert uuid, p_keep boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  e emergency_alerts;
  v_note text;
begin
  select * into s from app_settings where id = 1;
  select * into e from emergency_alerts where id = p_alert for update;
  if not found then raise exception 'Alert not found' using hint = 'NOT_FOUND'; end if;
  if not can_review_alert(v_user, e.location) then
    raise exception 'Only admins and officials of this area can review emergencies' using hint = 'NOT_ALLOWED';
  end if;
  if e.reporter_id = v_user then
    raise exception 'You raised this alert, so someone else must review it' using hint = 'OWN_ALERT';
  end if;
  if e.review_status is distinct from 'pending' then
    raise exception 'This alert is not waiting for a review' using hint = 'LOCKED';
  end if;

  if p_keep then
    v_note := nullif(trim(coalesce(p_note, '')), '');
    update emergency_alerts set review_status = 'kept', reviewed_by = v_user, reviewed_at = now(), review_note = v_note
     where id = p_alert;
    if e.issue_id is not null then
      perform log_event(e.issue_id, v_user, 'emergency_kept',
        coalesce('Emergency evidence checked and kept: ' || v_note, 'Emergency evidence checked and kept.'),
        jsonb_build_object('alert_id', p_alert));
    end if;
    return;
  end if;

  v_note := require_reason(p_note);
  update emergency_alerts
     set review_status = 'rejected', reviewed_by = v_user, reviewed_at = now(), review_note = v_note,
         status = case when status = 'active' then 'hidden' else status end,
         ended_at = coalesce(ended_at, now())
   where id = p_alert;
  update profiles set reputation = reputation + s.rep_false_emergency where id = e.reporter_id;
  -- The confirmations that made it "verified" vouched for something that wasn't there.
  update profiles set reputation = reputation + s.rep_false_confirm
   where id in (select user_id from emergency_responses
                 where alert_id = p_alert and response = 'confirm' and on_site and trusted);
  insert into notifications (user_id, type, alert_id, message)
  select x.u, 'emergency_rejected', p_alert,
         format('An emergency you %s was rejected after a look at the evidence: %s', x.what, v_note)
    from (select e.reporter_id as u, 'raised' as what
          union
          select user_id, 'confirmed' from emergency_responses
           where alert_id = p_alert and response = 'confirm' and on_site and trusted) x;
  perform unverify_alert_issue(p_alert, v_user, 'Emergency rejected after a look at the evidence: ' || v_note || '.');
end $$;

-- Verified emergencies waiting for a look, for this admin or official.
create or replace function get_emergency_reviews()
returns table (
  id uuid, kind emergency_kind, address text, lat double precision, lng double precision,
  verified_at timestamptz, status text, on_site_confirms int, live_items int, issue_id uuid, issue_title text
)
language sql stable security definer set search_path = public, extensions as $$
  select e.id, e.kind, e.address, ST_Y(e.location::geometry), ST_X(e.location::geometry), e.verified_at, e.status,
         (select count(*)::int from emergency_responses r
           where r.alert_id = e.id and r.response = 'confirm' and r.on_site and r.trusted),
         jsonb_array_length(e.media)
           + (select coalesce(sum(jsonb_array_length(r.media)), 0)::int from emergency_responses r where r.alert_id = e.id),
         i.id, i.title
    from emergency_alerts e
    left join issues i on i.id = e.issue_id
   where e.review_status = 'pending'
     and e.reporter_id is distinct from auth.uid()
     and can_review_alert(auth.uid(), e.location)
   order by e.verified_at
$$;

-- ---------- Raise an alert (live media only) --------------------------
create or replace function create_emergency_alert(
  p_kind emergency_kind, p_note text, p_lat double precision, p_lng double precision,
  p_address text, p_media jsonb default '[]', p_issue uuid default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_point geography;
  v_address text := coalesce(trim(p_address), '');
  v_media jsonb;
  v_radius int;
  v_id uuid;
  v_where text;
begin
  select * into s from app_settings where id = 1;
  if (select count(*) from emergency_alerts where reporter_id = v_user and created_at > now() - interval '24 hours')
     >= s.emergency_max_per_day then
    raise exception 'You can raise at most % emergency alerts a day. Call 999.', s.emergency_max_per_day using hint = 'RATE_LIMIT';
  end if;

  if p_issue is not null then
    select * into i from issues where id = p_issue;
    if not found or i.status in ('hidden', 'expired', 'closed') then
      raise exception 'This issue is no longer open' using hint = 'BAD_ISSUE';
    end if;
    if exists (select 1 from emergency_alerts where issue_id = p_issue and status = 'active') then
      raise exception 'An emergency alert is already active for this issue. Confirm it instead.' using hint = 'ALREADY_ALERTED';
    end if;
    -- The emergency is where the issue is, not where the person raising it stands.
    v_point := i.location;
    if v_address = '' then v_address := i.address; end if;
  else
    perform assert_in_service_area(p_lat, p_lng);
    v_point := make_point(p_lat, p_lng);
  end if;

  v_media := take_live_media(p_media, v_user, v_point);

  -- Brand-new accounts warn a smaller area until someone confirms.
  v_radius := case when (select created_at from profiles where id = v_user) > now() - make_interval(hours => s.new_account_hours)
                   then s.emergency_new_account_radius_m else s.emergency_radius_m end;

  insert into emergency_alerts (reporter_id, kind, note, location, address, media, notify_radius_m, expires_at,
                                issue_id, live_evidence)
  values (v_user, p_kind, coalesce(trim(p_note), ''), v_point, v_address,
          v_media, v_radius, now() + make_interval(hours => s.emergency_hours), p_issue,
          jsonb_array_length(v_media) > 0)
  returning id into v_id;

  v_where := coalesce(nullif(v_address, ''), 'your area');
  insert into notifications (user_id, type, alert_id, message)
  select us.user_id, 'emergency', v_id,
         format('%s reported near %s. Stay away and keep the road clear for emergency services.',
                emergency_label(p_kind), v_where)
    from user_settings us
   where us.user_id <> v_user and us.home_location is not null
     and ST_DWithin(us.home_location, v_point, v_radius);
  -- Followers of the issue care about it even if they live further away.
  if p_issue is not null then
    insert into notifications (user_id, type, alert_id, issue_id, message)
    select f.user_id, 'emergency', v_id, p_issue,
           format('An issue you follow is now an emergency: %s near %s. Stay away.', emergency_label(p_kind), v_where)
      from follows f
     where f.issue_id = p_issue and f.user_id <> v_user
       and not exists (select 1 from notifications n where n.alert_id = v_id and n.user_id = f.user_id);
  end if;
  insert into notifications (user_id, type, alert_id, actor_id, message)
  select user_id, 'emergency_admin', v_id, v_user,
         format('Emergency alert raised: %s near %s.', emergency_label(p_kind), v_where)
    from user_roles where role = 'admin' and user_id <> v_user;
  return v_id;
end $$;

-- ---------- Respond: live GPS for confirm/deny, say what you see -----
-- p_seen: for "confirm", what the person sees. Must be given; only answers
-- matching the alert's kind count towards verification.
drop function if exists respond_emergency(uuid, text, double precision, double precision);
create function respond_emergency(
  p_alert uuid, p_response text, p_lat double precision default null, p_lng double precision default null,
  p_accuracy real default null, p_media jsonb default '[]', p_seen emergency_kind default null
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  e emergency_alerts;
  v_home geography;
  v_here geography := case when p_lat is null or p_lng is null then null else make_point(p_lat, p_lng) end;
  v_on_site boolean;
  v_trusted boolean;
  v_media jsonb := '[]';
begin
  select * into s from app_settings where id = 1;
  select * into e from emergency_alerts where id = p_alert for update;
  if not found then raise exception 'Alert not found' using hint = 'NOT_FOUND'; end if;
  if e.status <> 'active' then raise exception 'This alert has ended' using hint = 'LOCKED'; end if;
  if p_response not in ('confirm', 'deny', 'over') then
    raise exception 'Unknown response' using hint = 'BAD_KIND';
  end if;
  if p_response = 'confirm' and p_seen is null then
    raise exception 'Say what you see' using hint = 'SEEN_REQUIRED';
  end if;

  if e.reporter_id = v_user then
    if p_response <> 'over' then
      raise exception 'You raised this alert. You can only mark it as over.' using hint = 'OWN_ALERT';
    end if;
    update emergency_alerts set status = 'over', ended_at = now() where id = p_alert;
    return 'over';
  end if;

  -- "I see it" / "not true" need where you are now; "it's over" may also come from people who live nearby.
  select home_location into v_home from user_settings where user_id = v_user;
  if coalesce(ST_DWithin(v_here, e.location, s.emergency_respond_radius_m), false) = false
     and (p_response <> 'over' or coalesce(ST_DWithin(v_home, e.location, s.emergency_respond_radius_m), false) = false) then
    raise exception 'Only people nearby can respond to this alert. Turn on location and try again.' using hint = 'NOT_NEARBY';
  end if;

  v_on_site := coalesce(ST_DWithin(v_here, e.location, s.emergency_verify_radius_m), false)
               and p_accuracy is not null and p_accuracy <= s.max_gps_accuracy_m;
  v_trusted := coalesce((select created_at from profiles where id = v_user) <= now() - make_interval(hours => s.new_account_hours), false);
  if p_response = 'confirm' and jsonb_array_length(coalesce(p_media, '[]')) > 0 then
    v_media := take_live_media(p_media, v_user, e.location);
  end if;

  insert into emergency_responses (alert_id, user_id, response, on_site, trusted, media, seen_kind)
  values (p_alert, v_user, p_response, v_on_site, v_trusted, v_media,
          case when p_response = 'confirm' then p_seen end)
  on conflict (alert_id, user_id) do update
    set response = excluded.response, created_at = now(), on_site = excluded.on_site, trusted = excluded.trusted,
        seen_kind = excluded.seen_kind,
        -- keep an earlier live photo when someone confirms again without one
        media = case when excluded.response <> 'confirm' then '[]'::jsonb
                     when jsonb_array_length(excluded.media) > 0 then excluded.media
                     else emergency_responses.media end;

  update emergency_alerts a
     set confirm_count = x.c, deny_count = x.d, over_count = x.o
    from (select count(*) filter (where response = 'confirm') c,
                 count(*) filter (where response = 'deny') d,
                 count(*) filter (where response = 'over') o
            from emergency_responses where alert_id = p_alert) x
   where a.id = p_alert
  returning * into e;

  -- Once a reviewer has looked at the evidence and kept it, denials can't hide it any more.
  if e.deny_count >= s.emergency_hide_denials and e.deny_count > e.confirm_count
     and e.review_status is distinct from 'kept' then
    update emergency_alerts set status = 'hidden', ended_at = now(), verified_at = null, review_status = null
     where id = p_alert;
    update profiles set reputation = reputation + s.rep_false_emergency where id = e.reporter_id;
    insert into notifications (user_id, type, alert_id, message)
    values (e.reporter_id, 'emergency_hidden', p_alert,
            format('Your emergency alert was hidden because people nearby said it wasn''t true (%s reputation).', s.rep_false_emergency));
    perform unverify_alert_issue(p_alert);
    return 'hidden';
  end if;
  perform maybe_verify_alert(p_alert);
  if e.over_count >= s.emergency_end_votes then
    update emergency_alerts set status = 'over', ended_at = now() where id = p_alert;
    return 'over';
  end if;
  return 'active';
end $$;

-- ---------- Reads ------------------------------------------------------
drop function if exists get_active_alerts(double precision, double precision, int);
create function get_active_alerts(
  p_lat double precision default null, p_lng double precision default null, p_radius_m int default 25000
) returns table (
  id uuid, kind emergency_kind, note text, lat double precision, lng double precision, address text,
  media jsonb, status text, confirm_count int, deny_count int, over_count int,
  created_at timestamptz, expires_at timestamptz, distance_m double precision, is_mine boolean, my_response text,
  issue_id uuid, verified_at timestamptz, live_evidence boolean
)
language sql stable security definer set search_path = public, extensions as $$
  select e.id, e.kind, e.note, ST_Y(e.location::geometry), ST_X(e.location::geometry), e.address,
         e.media, e.status, e.confirm_count, e.deny_count, e.over_count, e.created_at, e.expires_at,
         case when p_lat is null then null else ST_Distance(e.location, make_point(p_lat, p_lng)) end,
         coalesce(e.reporter_id = auth.uid(), false),
         (select r.response from emergency_responses r where r.alert_id = e.id and r.user_id = auth.uid()),
         e.issue_id, e.verified_at, e.live_evidence
    from emergency_alerts e
   where e.status = 'active'
     and (p_lat is null or ST_DWithin(e.location, make_point(p_lat, p_lng), p_radius_m))
   order by e.verified_at is null, e.created_at desc
   limit 50
$$;

drop function if exists get_alert(uuid);
create function get_alert(p_alert uuid)
returns table (
  id uuid, kind emergency_kind, note text, lat double precision, lng double precision, address text,
  media jsonb, status text, confirm_count int, deny_count int, over_count int,
  created_at timestamptz, expires_at timestamptz, ended_at timestamptz, is_mine boolean, my_response text,
  emergency_contacts jsonb, authority_short_name text, issue_id uuid, issue_title text,
  verified_at timestamptz, live_evidence boolean, on_site_confirms int, witness_media jsonb,
  my_seen emergency_kind, review_status text, review_note text, can_review boolean
)
language sql stable security definer set search_path = public, extensions as $$
  select e.id, e.kind, e.note, ST_Y(e.location::geometry), ST_X(e.location::geometry), e.address,
         case when e.status = 'hidden' and e.reporter_id is distinct from auth.uid() then '[]'::jsonb else e.media end,
         e.status, e.confirm_count, e.deny_count, e.over_count, e.created_at, e.expires_at, e.ended_at,
         coalesce(e.reporter_id = auth.uid(), false),
         (select r.response from emergency_responses r where r.alert_id = e.id and r.user_id = auth.uid()),
         coalesce(a.emergency_contacts, '[]'::jsonb), a.short_name,
         i.id, i.title,
         e.verified_at, e.live_evidence,
         (select count(*)::int from emergency_responses r
           where r.alert_id = e.id and r.response = 'confirm' and r.on_site and r.trusted
             and (r.seen_kind = e.kind or e.kind = 'other')),
         case when e.status = 'hidden' then '[]'::jsonb else coalesce(
           (select jsonb_agg(m order by r.created_at)
              from emergency_responses r, jsonb_array_elements(r.media) m
             where r.alert_id = e.id and r.response = 'confirm'), '[]'::jsonb) end,
         (select r.seen_kind from emergency_responses r where r.alert_id = e.id and r.user_id = auth.uid()),
         e.review_status, e.review_note,
         e.review_status = 'pending' and e.reporter_id is distinct from auth.uid() and can_review_alert(auth.uid(), e.location)
    from emergency_alerts e
    left join authorities a on a.id = find_authority(e.location)
    left join issues i on i.id = e.issue_id and i.status <> 'hidden'
   where e.id = p_alert
$$;

drop function if exists get_issue_alert(uuid);
create function get_issue_alert(p_issue uuid)
returns table (id uuid, kind emergency_kind, status text, confirm_count int, created_at timestamptz,
               verified_at timestamptz, issue_verified_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  -- The active alert if there is one; otherwise the one that verified the issue (so the page can say so).
  select e.id, e.kind, e.status, e.confirm_count, e.created_at, e.verified_at, i.emergency_verified_at
    from issues i
    join emergency_alerts e on e.issue_id = i.id
   where i.id = p_issue and (e.status = 'active' or e.id = i.emergency_alert_id)
   order by e.status = 'active' desc, e.created_at desc
   limit 1
$$;

-- Storage: photos with "I see it too" are evidence too.
create or replace function media_in_use(p_path text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from issue_media where storage_path = p_path)
      or exists (select 1 from emergency_alerts where media @> jsonb_build_array(jsonb_build_object('path', p_path)))
      or exists (select 1 from emergency_responses where media @> jsonb_build_array(jsonb_build_object('path', p_path)))
$$;

-- ---------- Permissions ------------------------------------------------
revoke execute on function
  start_live_capture(double precision, double precision, real),
  take_live_media(jsonb, uuid, geography),
  maybe_verify_alert(uuid),
  unverify_alert_issue(uuid, uuid, text),
  can_review_alert(uuid, geography),
  review_emergency(uuid, boolean, text),
  get_emergency_reviews(),
  respond_emergency(uuid, text, double precision, double precision, real, jsonb, emergency_kind),
  get_active_alerts(double precision, double precision, int),
  get_alert(uuid),
  get_issue_alert(uuid)
from public, anon, authenticated;
grant execute on function
  get_active_alerts(double precision, double precision, int),
  get_alert(uuid),
  get_issue_alert(uuid)
to anon, authenticated;
grant execute on function
  start_live_capture(double precision, double precision, real),
  respond_emergency(uuid, text, double precision, double precision, real, jsonb, emergency_kind),
  review_emergency(uuid, boolean, text),
  get_emergency_reviews()
to authenticated;
