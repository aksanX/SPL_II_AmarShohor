-- =====================================================================
-- AmarShohor — 32. Emergencies: residents witness, officials act, admins moderate
--
-- 1. Only residents answer "what do you see / nothing here / it's over".
--    Admins and City Corporation officials review evidence; they don't witness.
-- 2. Officials of the area hear about an alert as soon as it is raised, see all
--    live alerts of their area, post public updates ("Fire Service on scene,
--    road closed") and can end an alert.
-- 3. When an alert is over (or verified), an official can log the damage as an
--    issue that goes straight to their City Corporation. Admins can remove an
--    obvious fake before it is verified.
-- =====================================================================

set search_path = public, extensions;

-- An official of the City Corporation whose area contains the point.
create or replace function is_area_official(p_user uuid, p_location geography) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(p_user is not null and official_authority(p_user) = find_authority(p_location), false)
$$;

-- The reporter and everyone who answered, except p_actor.
create or replace function notify_alert_people(p_alert uuid, p_type text, p_actor uuid, p_message text) returns void
language sql security definer set search_path = public, extensions as $$
  insert into notifications (user_id, type, alert_id, actor_id, message)
  select u, p_type, p_alert, p_actor, p_message
    from (select reporter_id as u from emergency_alerts where id = p_alert
          union
          select user_id from emergency_responses where alert_id = p_alert) x
   where u is distinct from p_actor
$$;

-- =====================================================================
-- 1. Witness answers are for residents
-- =====================================================================
create or replace function guard_alert_response() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if is_admin(new.user_id) or official_authority(new.user_id) is not null then
    raise exception 'Residents on site confirm or deny alerts. Admins and officials review the evidence.'
      using hint = 'ROLE_NOT_ALLOWED';
  end if;
  return new;
end $$;

drop trigger if exists emergency_responses_guard_role on emergency_responses;
create trigger emergency_responses_guard_role before insert on emergency_responses
  for each row execute function guard_alert_response();

-- =====================================================================
-- 2. Officials: told at once, public updates, ending an alert
-- =====================================================================

-- Officials of the area are told as soon as an alert is raised, not only once it is verified.
create or replace function notify_area_officials_of_alert() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into notifications (user_id, type, alert_id, message)
  select r.user_id, 'emergency_official', new.id,
         format('Emergency alert in your area: %s near %s. Not verified yet.',
                emergency_label(new.kind), coalesce(nullif(new.address, ''), 'an unnamed spot'))
    from user_roles r
   where r.role = 'official' and r.authority_id = find_authority(new.location) and r.user_id <> new.reporter_id;
  return null;
end $$;

drop trigger if exists emergency_alerts_notify_officials on emergency_alerts;
create trigger emergency_alerts_notify_officials after insert on emergency_alerts
  for each row execute function notify_area_officials_of_alert();

-- Public notes on an alert: official updates, an official ending it, an admin removing it.
create table if not exists alert_updates (
  id           bigserial primary key,
  alert_id     uuid not null references emergency_alerts(id) on delete cascade,
  author_id    uuid references profiles(id) on delete set null,
  authority_id uuid references authorities(id) on delete set null,
  kind         text not null default 'update' check (kind in ('update', 'ended', 'removed', 'damage')),
  note         text not null check (char_length(note) between 3 and 500),
  created_at   timestamptz not null default now()
);
create index if not exists alert_updates_alert_idx on alert_updates (alert_id, created_at);
alter table alert_updates enable row level security;  -- read through get_alert / get_live_alerts

create or replace function post_alert_update(p_alert uuid, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  e emergency_alerts;
  v_note text := trim(coalesce(p_note, ''));
begin
  select * into e from emergency_alerts where id = p_alert;
  if not found then raise exception 'Alert not found' using hint = 'NOT_FOUND'; end if;
  if not is_area_official(v_user, e.location) then
    raise exception 'Only officials of this area can post updates' using hint = 'NOT_OFFICIAL';
  end if;
  if e.status = 'hidden' or (e.status <> 'active' and e.ended_at < now() - interval '24 hours') then
    raise exception 'This alert has ended' using hint = 'LOCKED';
  end if;
  if char_length(v_note) not between 3 and 500 then
    raise exception 'Write the update (3 to 500 characters)' using hint = 'NOTE_REQUIRED';
  end if;
  insert into alert_updates (alert_id, author_id, authority_id, kind, note)
  values (p_alert, v_user, official_authority(v_user), 'update', v_note);
  perform notify_alert_people(p_alert, 'emergency_update', v_user,
    format('%s update on %s: %s', (select short_name from authorities where id = official_authority(v_user)),
           lower(emergency_label(e.kind)), v_note));
end $$;

-- The City Corporation knows the situation is under control: end the alert.
create or replace function official_end_alert(p_alert uuid, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  e emergency_alerts;
  v_note text := trim(coalesce(p_note, ''));
begin
  select * into e from emergency_alerts where id = p_alert for update;
  if not found then raise exception 'Alert not found' using hint = 'NOT_FOUND'; end if;
  if not is_area_official(v_user, e.location) then
    raise exception 'Only officials of this area can end this alert' using hint = 'NOT_OFFICIAL';
  end if;
  if e.status <> 'active' then raise exception 'This alert has already ended' using hint = 'LOCKED'; end if;
  if char_length(v_note) < 3 then
    raise exception 'Say why it is over, e.g. "Fire put out, road open again"' using hint = 'NOTE_REQUIRED';
  end if;
  update emergency_alerts set status = 'over', ended_at = now() where id = p_alert;
  insert into alert_updates (alert_id, author_id, authority_id, kind, note)
  values (p_alert, v_user, official_authority(v_user), 'ended', left(v_note, 500));
  perform notify_alert_people(p_alert, 'emergency_over', v_user,
    format('%s marked the %s alert as over: %s', (select short_name from authorities where id = official_authority(v_user)),
           lower(emergency_label(e.kind)), v_note));
end $$;

-- =====================================================================
-- 3. Damage follow-up and early removal of fakes
-- =====================================================================
alter table emergency_alerts add column if not exists followup_issue_id uuid references issues(id) on delete set null;

-- An official logs what the emergency left behind (debris, burnt poles, broken
-- drains). The emergency itself was confirmed by residents, so the issue skips
-- community validation and goes straight to the official's City Corporation.
create or replace function official_log_damage(
  p_alert uuid, p_title text, p_category text, p_description text, p_media jsonb, p_size text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  e emergency_alerts;
  c categories;
  v_id uuid;
  v_event bigint;
  v_cc text;
begin
  select * into e from emergency_alerts where id = p_alert for update;
  if not found then raise exception 'Alert not found' using hint = 'NOT_FOUND'; end if;
  if not is_area_official(v_user, e.location) then
    raise exception 'Only officials of this area can log the damage' using hint = 'NOT_OFFICIAL';
  end if;
  if e.status = 'hidden' or (e.verified_at is null and e.status = 'active') then
    raise exception 'Log the damage once the alert is verified or over' using hint = 'LOCKED';
  end if;
  if e.followup_issue_id is not null then
    raise exception 'The damage from this alert is already logged' using hint = 'ALREADY_LOGGED';
  end if;
  if p_size is not null and p_size not in ('small', 'medium', 'large') then
    raise exception 'Size must be small, medium or large' using hint = 'BAD_SIZE';
  end if;
  select * into c from categories where slug = p_category and is_active;
  if not found then raise exception 'Unknown category' using hint = 'BAD_CATEGORY'; end if;
  v_cc := (select short_name from authorities where id = official_authority(v_user));

  insert into issues (reporter_id, title, description, category, severity, base_severity, size,
                      location, location_accuracy_m, location_source, address, is_anonymous,
                      route, route_source)
  values (v_user, trim(p_title), coalesce(trim(p_description), ''), c.slug, c.default_severity, c.default_severity, p_size,
          e.location, null, 'manual', e.address, false, 'authority', 'category')
  returning id into v_id;

  v_event := log_event(v_id, v_user, 'created',
    format('Logged by %s after the %s alert. Residents confirmed the emergency, so it goes straight to %s.',
           v_cc, lower(emergency_label(e.kind)), v_cc),
    jsonb_build_object('alert_id', p_alert));
  perform attach_media(v_id, v_user, 'report', p_media, v_event, 1, false);
  insert into follows (issue_id, user_id) values (v_id, v_user);
  update issues set follower_count = 1, status = 'validated', validated_at = now() where id = v_id;
  perform escalate_issue(v_id, v_user, 'Damage left by an emergency');

  update emergency_alerts set followup_issue_id = v_id where id = p_alert;
  insert into alert_updates (alert_id, author_id, authority_id, kind, note)
  values (p_alert, v_user, official_authority(v_user), 'damage', left(format('Damage logged for repair: %s', trim(p_title)), 500));
  return v_id;
end $$;

-- An admin removes an obvious fake before anyone verifies it. A verified alert
-- goes through the evidence check (review_emergency) instead.
create or replace function admin_hide_alert(p_alert uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  s app_settings;
  e emergency_alerts;
begin
  select * into s from app_settings where id = 1;
  select * into e from emergency_alerts where id = p_alert for update;
  if not found then raise exception 'Alert not found' using hint = 'NOT_FOUND'; end if;
  if e.status <> 'active' then raise exception 'This alert has already ended' using hint = 'LOCKED'; end if;
  if e.verified_at is not null then
    raise exception 'People on site verified this alert. Use Keep or Reject in the evidence check.' using hint = 'USE_REVIEW';
  end if;

  update emergency_alerts set status = 'hidden', ended_at = now() where id = p_alert;
  update profiles set reputation = reputation + s.rep_false_emergency where id = e.reporter_id;
  insert into alert_updates (alert_id, author_id, kind, note)
  values (p_alert, v_admin, 'removed', left('Removed by an admin: ' || v_reason, 500));
  insert into notifications (user_id, type, alert_id, actor_id, message)
  values (e.reporter_id, 'emergency_hidden', p_alert, v_admin,
          format('Your emergency alert was removed by an admin (%s reputation): %s', s.rep_false_emergency, v_reason));
  perform log_admin(v_admin, 'hide_alert', e.issue_id, e.reporter_id, v_reason, jsonb_build_object('alert_id', p_alert));
end $$;

-- An official may take a City Corporation issue they reported themselves (for
-- example damage they logged): officials earn no reputation, and residents
-- still confirm the fix. Volunteers still can't take their own reports.
-- Same as 0009 otherwise.
create or replace function accept_task(p_issue uuid, p_team_size int default 1) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  p profiles;
  v_rows int;
  v_assignment bigint;
  v_role text;
  v_lock_until timestamptz;
  v_team int := greatest(coalesce(p_team_size, 1), 1);
  v_who text;
begin
  select * into s from app_settings where id = 1;
  select * into p from profiles where id = v_user;
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;

  if i.route = 'authority' then
    if official_authority(v_user) is distinct from i.authority_id or i.authority_id is null then
      raise exception 'Only officials of % can take this issue',
        coalesce((select short_name from authorities where id = i.authority_id), 'the City Corporation')
        using hint = 'NOT_OFFICIAL';
    end if;
    v_role := 'official';
    v_team := 1;
    v_lock_until := null;  -- officials work to the City Corporation's target time instead
    update issues
       set volunteer_id = v_user, status = 'assigned', assigned_at = now(),
           lock_expires_at = null, lock_reminder_sent = false, updated_at = now()
     where id = p_issue and status = 'escalated' and volunteer_id is null;
  else
    if i.reporter_id = v_user then
      raise exception 'You can''t take a task you reported yourself' using hint = 'OWN_ISSUE';
    end if;
    if i.route = 'pending' then
      raise exception 'An admin is still deciding who should fix this' using hint = 'ROUTE_PENDING';
    end if;
    if not p.is_volunteer then
      raise exception 'Turn on volunteer mode first' using hint = 'NOT_VOLUNTEER';
    end if;
    if (select count(*) from assignments where volunteer_id = v_user and outcome = 'active') >= s.max_active_tasks then
      raise exception 'You can lead at most % active tasks', s.max_active_tasks using hint = 'TOO_MANY_TASKS';
    end if;
    if exists (select 1 from assignments where issue_id = p_issue and volunteer_id = v_user
                and outcome in ('expired', 'reopened')) then
      raise exception 'You already had this task and it was not completed; another volunteer should try' using hint = 'PREVIOUSLY_FAILED';
    end if;
    if exists (select 1 from review_items where issue_id = p_issue and kind = 'escalation_request'
                and requested_by = v_user and created_at > now() - make_interval(days => s.escalation_retake_days)) then
      raise exception 'You recently asked for this to go to the City Corporation. Let another volunteer try first.'
        using hint = 'RECENTLY_ESCALATED';
    end if;
    if v_team > 50 then
      raise exception 'A team can have at most 50 people' using hint = 'BAD_TEAM_SIZE';
    end if;
    if v_team > 1 and (p.tasks_completed < s.team_lead_min_tasks or p.reputation <= 0) then
      raise exception 'To lead a team you need at least % completed task and positive reputation. You can still join a team.',
        s.team_lead_min_tasks using hint = 'CANT_LEAD_TEAM';
    end if;
    v_role := 'volunteer';
    v_lock_until := now() + make_interval(hours => case when v_team > 1 then s.team_lock_hours else s.lock_hours end);
    update issues
       set volunteer_id = v_user, status = 'assigned', assigned_at = now(),
           lock_expires_at = v_lock_until, lock_reminder_sent = false, updated_at = now()
     where id = p_issue and status = 'validated' and route = 'community' and volunteer_id is null;
  end if;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'This task is no longer available — someone else may have taken it' using hint = 'TASK_TAKEN';
  end if;

  insert into assignments (issue_id, volunteer_id, role, team_size)
  values (p_issue, v_user, v_role, v_team) returning id into v_assignment;
  update issues set assignment_id = v_assignment where id = p_issue;
  insert into follows (issue_id, user_id) values (p_issue, v_user) on conflict do nothing;

  perform log_event(p_issue, v_user, 'assigned', null,
    jsonb_build_object('lock_expires_at', v_lock_until, 'team_size', v_team, 'role', v_role));
  v_who := case when v_role = 'official' then (select short_name from authorities where id = i.authority_id)
                else 'A volunteer' end;
  perform notify_audience(p_issue, 'task_accepted', v_user, format('%s accepted "%s".', v_who, i.title));
  if v_team > 1 then
    perform notify_nearby_volunteers(p_issue, s.request_help_radius_m, 'team_recruiting', v_user,
      format('A team near you needs %s more people for "%s".', v_team - 1, i.title));
  end if;
end $$;

-- =====================================================================
-- Reads
-- =====================================================================

-- Live alerts for the people who act on them: admins see every area, officials
-- their own. Ended alerts stay listed for a day.
create or replace function get_live_alerts()
returns table (
  id uuid, kind emergency_kind, address text, lat double precision, lng double precision, status text,
  created_at timestamptz, ended_at timestamptz, verified_at timestamptz, review_status text,
  confirm_count int, deny_count int, on_site_confirms int, issue_id uuid, issue_title text,
  authority_short_name text, last_update text, last_update_at timestamptz, followup_issue_id uuid
)
language sql stable security definer set search_path = public, extensions as $$
  select e.id, e.kind, e.address, ST_Y(e.location::geometry), ST_X(e.location::geometry), e.status,
         e.created_at, e.ended_at, e.verified_at, e.review_status, e.confirm_count, e.deny_count,
         (select count(*)::int from emergency_responses r
           where r.alert_id = e.id and r.response = 'confirm' and r.on_site and r.trusted
             and (r.seen_kind = e.kind or e.kind = 'other')),
         i.id, i.title, a.short_name, u.note, u.created_at, e.followup_issue_id
    from emergency_alerts e
    left join issues i on i.id = e.issue_id and i.status <> 'hidden'
    left join authorities a on a.id = find_authority(e.location)
    left join lateral (select x.note, x.created_at from alert_updates x where x.alert_id = e.id
                        order by x.created_at desc limit 1) u on true
   where (e.status = 'active' or (e.status in ('over', 'expired') and e.ended_at > now() - interval '24 hours'))
     and (is_admin(auth.uid()) or is_area_official(auth.uid(), e.location))
   order by e.status = 'active' desc, e.verified_at is null, e.created_at desc
   limit 100
$$;

-- Same as 0019, plus the public updates and what this viewer may do.
drop function if exists get_alert(uuid);
create function get_alert(p_alert uuid)
returns table (
  id uuid, kind emergency_kind, note text, lat double precision, lng double precision, address text,
  media jsonb, status text, confirm_count int, deny_count int, over_count int,
  created_at timestamptz, expires_at timestamptz, ended_at timestamptz, is_mine boolean, my_response text,
  emergency_contacts jsonb, authority_short_name text, issue_id uuid, issue_title text,
  verified_at timestamptz, live_evidence boolean, on_site_confirms int, witness_media jsonb,
  my_seen emergency_kind, review_status text, review_note text, can_review boolean,
  updates jsonb, can_update boolean, can_end boolean, can_log_damage boolean, can_hide boolean,
  followup_issue_id uuid, followup_issue_title text
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
         e.review_status = 'pending' and e.reporter_id is distinct from auth.uid() and can_review_alert(auth.uid(), e.location),
         coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'note', x.note, 'created_at', x.created_at,
                                                       'authority', ua.short_name, 'by_admin', x.authority_id is null)
                                    order by x.created_at)
                     from alert_updates x left join authorities ua on ua.id = x.authority_id
                    where x.alert_id = e.id), '[]'::jsonb),
         is_area_official(auth.uid(), e.location) and e.status <> 'hidden'
           and (e.status = 'active' or e.ended_at > now() - interval '24 hours'),
         is_area_official(auth.uid(), e.location) and e.status = 'active',
         is_area_official(auth.uid(), e.location) and e.status <> 'hidden' and e.followup_issue_id is null
           and (e.verified_at is not null or e.status in ('over', 'expired')),
         coalesce(is_admin(auth.uid()), false) and e.status = 'active' and e.verified_at is null,
         e.followup_issue_id, fi.title
    from emergency_alerts e
    left join authorities a on a.id = find_authority(e.location)
    left join issues i on i.id = e.issue_id and i.status <> 'hidden'
    left join issues fi on fi.id = e.followup_issue_id
   where e.id = p_alert
$$;

-- ---------- Permissions ------------------------------------------------
revoke execute on function
  is_area_official(uuid, geography), notify_alert_people(uuid, text, uuid, text),
  guard_alert_response(), notify_area_officials_of_alert(),
  post_alert_update(uuid, text), official_end_alert(uuid, text),
  official_log_damage(uuid, text, text, text, jsonb, text), admin_hide_alert(uuid, text),
  get_live_alerts(), get_alert(uuid)
from public, anon, authenticated;
grant execute on function get_alert(uuid) to anon, authenticated;
grant execute on function
  post_alert_update(uuid, text), official_end_alert(uuid, text),
  official_log_damage(uuid, text, text, text, jsonb, text), admin_hide_alert(uuid, text),
  get_live_alerts()
to authenticated;
