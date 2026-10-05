-- =====================================================================
-- AmarShohor — 11. Closing the loops
-- Every open issue must end up with a timer or a decision-maker, never
-- waiting forever. This file adds:
--   1. "Still there?" check  — neighbours can close issues fixed outside the app
--   2. Never-volunteer categories — dangerous work always goes to an authority
--   3. Bounded reopen loop   — repeated disputes go to the admin
--   4. Route lock            — after an admin decides who fixes it, no ping-pong
--   5. Other agencies        — DESCO, WASA, ... besides City Corporations
--   6. Related categories    — duplicate check across e.g. garbage / dumping
-- =====================================================================

set search_path = public, extensions;

-- ---------- Tunable rules -------------------------------------------
alter table app_settings
  add column stale_check_days  int not null default 14,  -- no activity for this long → ask "still there?"
  add column stale_gone_quorum int not null default 2,   -- "gone" answers needed to close
  add column max_reopens       int not null default 2,   -- disputed fixes before the admin looks at it
  add column route_lock_days   int not null default 30;  -- after an admin decides the route

-- ---------- 2 & 6. Category rules -----------------------------------
alter table categories
  add column volunteer_allowed boolean not null default true,  -- false = too dangerous for volunteers
  add column duplicate_group   text check (char_length(duplicate_group) <= 40);  -- same group = same problem

comment on column categories.volunteer_allowed is
  'False for dangerous work (live wires, open manholes): never shown to volunteers, always sent to an authority.';
comment on column categories.duplicate_group is
  'Categories with the same group are treated as the same problem by the duplicate check.';

update categories set volunteer_allowed = false where slug = 'safety_hazard';
update categories set duplicate_group = 'waste' where slug in ('garbage', 'illegal_dumping');
update categories set duplicate_group = 'water' where slug in ('waterlogging', 'drainage');

-- ---------- 5. Authorities can be City Corporations or other agencies
alter table authorities
  add column kind text not null default 'city_corporation' check (kind in ('city_corporation', 'agency'));

comment on column authorities.kind is
  'city_corporation: receives escalated issues by area. agency (DESCO, WASA, ...): only receives issues an admin refers to it.';

-- ---------- 1 & 3 & 4. Issue fields ---------------------------------
alter table issues
  add column stale_asked_at      timestamptz,  -- when "still there?" was last asked
  add column route_locked_until  timestamptz;  -- no transfer requests before this

create table still_there_answers (
  issue_id    uuid not null references issues(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  still_there boolean not null,
  answered_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);
alter table still_there_answers enable row level security;

-- =====================================================================
-- 2. Never-volunteer categories
-- Enforced on the issues table itself, so no path (reporting, editing,
-- admin re-routing) can put dangerous work on the volunteer board.
-- =====================================================================
create or replace function is_unsafe_for_volunteers(p_category text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from categories where slug = p_category and not volunteer_allowed)
$$;

-- Before validation nothing is lost by quietly picking the authority instead.
create or replace function default_unsafe_to_authority() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.route = 'community' and new.status = 'community_review' and is_unsafe_for_volunteers(new.category) then
    new.route := 'authority';
  end if;
  return new;
end $$;

create trigger issues_default_unsafe_to_authority
  before insert or update of route, category on issues
  for each row execute function default_unsafe_to_authority();

-- After that, putting dangerous work on the volunteer board is refused. Checked
-- when the route is set: admin_set_route sets the category first and the route
-- last, so this sees the final category.
create or replace function guard_volunteer_route() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.route = 'community' and new.status <> 'community_review' and is_unsafe_for_volunteers(new.category) then
    raise exception 'This category is too dangerous for volunteers. It must be handled by an authority.'
      using hint = 'UNSAFE_FOR_VOLUNTEERS';
  end if;
  return new;
end $$;

create trigger issues_guard_volunteer_route
  before update of route on issues
  for each row execute function guard_volunteer_route();

-- Issues that already sit with volunteers in a now-dangerous category.
update issues i set route = 'authority'
  from categories c
 where c.slug = i.category and not c.volunteer_allowed
   and i.route = 'community' and i.status = 'community_review';
do $$
declare r record;
begin
  for r in
    select i.id from issues i join categories c on c.slug = i.category
     where not c.volunteer_allowed and i.route = 'community' and i.status = 'validated'
  loop
    perform escalate_issue(r.id, null, 'This category is handled by an authority for safety');
  end loop;
end $$;

-- =====================================================================
-- 5. Other agencies: only City Corporations receive issues by area.
-- =====================================================================
create or replace function find_authority(p_location geography) returns uuid
language sql stable security definer set search_path = public, extensions as $$
  select id from authorities
   where is_active and kind = 'city_corporation' and ST_Covers(area, p_location)
   order by ST_Area(area) asc
   limit 1
$$;

-- Same as v2, plus `kind` at the end.
create or replace view authorities_v as
select id, name, short_name, ST_AsGeoJSON(area, 6)::jsonb as area, hotline, complaint_url, emergency_contacts,
       due_days_critical, due_days_high, due_days_medium, due_days_low, is_active, created_at, kind
from authorities;

drop function if exists admin_save_authority(uuid, text, text, jsonb, text, text, jsonb, int, int, int, int, boolean);
create function admin_save_authority(
  p_id uuid, p_name text, p_short_name text, p_area jsonb,
  p_hotline text, p_complaint_url text, p_emergency_contacts jsonb,
  p_due_critical int, p_due_high int, p_due_medium int, p_due_low int, p_is_active boolean,
  p_kind text default 'city_corporation'
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_geom geometry;
  v_id uuid;
begin
  if coalesce(p_kind, '') not in ('city_corporation', 'agency') then
    raise exception 'Choose City Corporation or other agency' using hint = 'BAD_KIND';
  end if;
  begin
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_area::text), 4326);
  exception when others then
    raise exception 'The service area is not a valid map shape' using hint = 'BAD_AREA';
  end;
  if GeometryType(v_geom) not in ('POLYGON', 'MULTIPOLYGON') or not ST_IsValid(v_geom) then
    raise exception 'Draw the service area as a closed shape that doesn''t cross itself' using hint = 'BAD_AREA';
  end if;
  if jsonb_typeof(coalesce(p_emergency_contacts, '[]')) <> 'array' then
    raise exception 'Emergency contacts must be a list' using hint = 'BAD_CONTACTS';
  end if;

  if p_id is null then
    insert into authorities (name, short_name, area, hotline, complaint_url, emergency_contacts,
                             due_days_critical, due_days_high, due_days_medium, due_days_low, is_active, kind)
    values (trim(p_name), upper(trim(p_short_name)), ST_Multi(v_geom)::geography, coalesce(trim(p_hotline), ''),
            coalesce(trim(p_complaint_url), ''), coalesce(p_emergency_contacts, '[]'),
            p_due_critical, p_due_high, p_due_medium, p_due_low, coalesce(p_is_active, true), p_kind)
    returning id into v_id;
  else
    update authorities
       set name = trim(p_name), short_name = upper(trim(p_short_name)), area = ST_Multi(v_geom)::geography,
           hotline = coalesce(trim(p_hotline), ''), complaint_url = coalesce(trim(p_complaint_url), ''),
           emergency_contacts = coalesce(p_emergency_contacts, '[]'),
           due_days_critical = p_due_critical, due_days_high = p_due_high,
           due_days_medium = p_due_medium, due_days_low = p_due_low, is_active = coalesce(p_is_active, true),
           kind = p_kind
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Authority not found' using hint = 'NOT_FOUND'; end if;
  end if;
  perform log_admin(v_admin, 'save_authority', null, null, 'Updated authority setup',
    jsonb_build_object('authority', upper(trim(p_short_name)), 'kind', p_kind));
  return v_id;
end $$;

-- The City Corporation says "not ours" (power line, water main, highway):
-- the admin refers the issue to the agency responsible. Whoever was working
-- on it stops with no penalty; the target-time clock restarts.
create or replace function admin_refer_issue(p_issue uuid, p_authority uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  i issues;
  a authorities;
  v_from text;
begin
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.route <> 'authority' or i.status not in ('escalated', 'assigned', 'in_progress', 'under_review') then
    raise exception 'Only issues waiting for an authority can be referred' using hint = 'LOCKED';
  end if;
  select * into a from authorities where id = p_authority and is_active;
  if not found then raise exception 'Choose an active authority' using hint = 'NOT_FOUND'; end if;
  if a.id = i.authority_id then
    raise exception 'The issue is already with %', a.short_name using hint = 'SAME_AUTHORITY';
  end if;
  select short_name into v_from from authorities where id = i.authority_id;

  if i.status in ('assigned', 'in_progress') then
    perform end_assignment(p_issue, 'rerouted');
    perform notify(i.volunteer_id, 'rerouted', p_issue, v_admin,
      format('An admin referred "%s" to %s (%s). Your task ended.', i.title, a.short_name, v_reason));
  end if;

  update issues
     set status = 'escalated', authority_id = a.id, route_source = 'admin',
         escalated_at = now(), due_at = now() + make_interval(days => due_days(a, i.severity)),
         overdue_notified = false, volunteer_id = null, assignment_id = null, assigned_at = null,
         lock_expires_at = null, lock_reminder_sent = false,
         resolution_note = null, resolution_submitted_at = null, updated_at = now()
   where id = p_issue;

  perform log_event(p_issue, v_admin, 'referred', v_reason,
    jsonb_build_object('from', v_from, 'to', a.short_name, 'due_at', (select due_at from issues where id = p_issue)));
  perform log_admin(v_admin, 'refer_issue', p_issue, null, v_reason, jsonb_build_object('from', v_from, 'to', a.short_name));
  perform resolve_reviews(p_issue, array['send_back', 'no_authority', 'stuck']::review_kind[], v_admin, 'referred:' || a.short_name, v_reason);
  perform notify_officials(a.id, 'escalated', p_issue, format('New issue for %s: "%s"', a.short_name, i.title));
  perform notify_audience(p_issue, 'escalated', v_admin, format('"%s" was referred to %s.', i.title, a.short_name));
end $$;

-- =====================================================================
-- 4. Route lock: once an admin actually moves an issue (volunteers ↔
-- City Corporation, or to another agency), nobody can ask to move it again
-- for route_lock_days. This stops the ping-pong between a volunteer's
-- "needs City Corporation" and an official's "volunteers can do it".
-- A rejected request doesn't lock: v2 already penalises repeated rejections.
-- The admin can still move the issue at any time.
-- =====================================================================
create or replace function lock_route_on_admin_decision() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.route_source = 'admin'
     and (old.route is distinct from new.route
          or (new.route = 'authority' and old.authority_id is distinct from new.authority_id)) then
    new.route_locked_until := now() + make_interval(days => (select route_lock_days from app_settings where id = 1));
  end if;
  return new;
end $$;

create trigger issues_lock_route
  before update of route, route_source, authority_id on issues
  for each row execute function lock_route_on_admin_decision();

create or replace function guard_route_requests() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare v_until timestamptz;
begin
  if new.kind in ('escalation_request', 'send_back') then
    select route_locked_until into v_until from issues where id = new.issue_id;
    if v_until > now() then
      raise exception 'An admin already decided who fixes this issue. It can''t be moved again until %.',
        to_char(v_until, 'DD Mon YYYY') using hint = 'ROUTE_LOCKED';
    end if;
  end if;
  return new;
end $$;

create trigger review_items_guard_route_requests
  before insert on review_items
  for each row execute function guard_route_requests();

-- =====================================================================
-- 3. Bounded reopen loop
-- =====================================================================

-- After max_reopens disputed fixes the admin takes a look: it may be bigger
-- than volunteers can handle, or the wrong agency.
create or replace function review_after_reopens() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_max int;
  v_count int;
begin
  if new.outcome = 'reopened' and old.outcome is distinct from 'reopened' then
    select max_reopens into v_max from app_settings where id = 1;
    select count(*) into v_count from assignments where issue_id = new.issue_id and outcome = 'reopened';
    if v_count >= v_max then
      perform open_review(new.issue_id, 'stuck', null,
        format('The fix was disputed %s times', v_count), jsonb_build_object('reopens', v_count));
    end if;
  end if;
  return new;
end $$;

create trigger assignments_review_after_reopens
  after update of outcome on assignments
  for each row execute function review_after_reopens();

-- Same as v2, plus: the reporter can reopen a fix alone only once. After
-- that, a further "not fixed" from the reporter counts as one neighbour vote,
-- so one person can't keep an issue open forever. Saying "fixed" still closes it.
create or replace function review_resolution(
  p_issue uuid, p_is_fixed boolean, p_lat double precision default null, p_lng double precision default null
) returns issue_status
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_is_reporter boolean;
  v_reporter_decides boolean;
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
  if i.volunteer_id = v_user or is_team_member(i.assignment_id, v_user) then
    raise exception 'You can''t confirm your own fix' using hint = 'OWN_TASK';
  end if;
  if i.authority_id is not null and official_authority(v_user) = i.authority_id then
    raise exception 'Officials can''t confirm their own City Corporation''s fix' using hint = 'OWN_TASK';
  end if;

  v_is_reporter := i.reporter_id = v_user;
  -- The reporter can always accept a fix, but can reopen it alone only once.
  v_reporter_decides := v_is_reporter
    and (p_is_fixed or not exists (select 1 from assignments where issue_id = p_issue and outcome = 'reopened'));
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
    'resolution_review', null,
    jsonb_build_object('is_fixed', p_is_fixed, 'by_reporter', v_is_reporter, 'reporter_decides', v_reporter_decides));

  if v_reporter_decides then
    if p_is_fixed then perform close_issue(p_issue, 'reporter_confirmed');
    else perform reopen_issue(p_issue, 'reporter_disputed'); end if;
  else
    select count(*) filter (where r.is_fixed), count(*) filter (where not r.is_fixed)
      into v_fixed, v_not_fixed
      from resolution_reviews r
     where r.assignment_id = i.assignment_id
       and (r.user_id <> i.reporter_id or not v_reporter_decides);
    if v_fixed >= s.resolution_quorum then perform close_issue(p_issue, 'community_confirmed');
    elsif v_not_fixed >= s.resolution_quorum then perform reopen_issue(p_issue, 'community_disputed');
    end if;
  end if;

  return (select status from issues where id = p_issue);
end $$;

-- =====================================================================
-- 1. "Still there?" check
-- Problems are often fixed outside the app (the city's crew comes by).
-- Without this, those issues would stay red on the heatmap forever.
-- =====================================================================

-- Open issues nobody is actively working on.
create or replace function is_stale_checkable(i issues) returns boolean
language sql stable as $$
  select i.status in ('validated', 'escalated')
      or (i.route = 'authority' and i.status in ('assigned', 'in_progress'))
$$;

-- Asks once per stale_check_days. Runs every 15 min with the other maintenance.
create or replace function run_stale_checks() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  r record;
  n int := 0;
begin
  select * into s from app_settings where id = 1;
  for r in
    select i.id, i.title from issues i
     where is_stale_checkable(i)
       and i.last_activity_at < now() - make_interval(days => s.stale_check_days)
       and (i.stale_asked_at is null or i.stale_asked_at < now() - make_interval(days => s.stale_check_days))
     for update skip locked
  loop
    update issues set stale_asked_at = now() where id = r.id;
    perform notify_audience(r.id, 'still_there_check', null,
      format('Is "%s" still there? Nothing has happened for %s days. Tell us if it''s gone.', r.title, s.stale_check_days));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Closing because neighbours say the problem is gone. Nobody earns reputation:
-- we don't know who fixed it. City Corporation issues still count in its record.
create or replace function close_issue_gone(p_issue uuid, p_gone int) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare i issues;
begin
  select * into i from issues where id = p_issue for update;
  if i.status in ('assigned', 'in_progress') then
    perform end_assignment(p_issue, 'rerouted');
    perform notify(i.volunteer_id, 'issue_closed', p_issue, null,
      format('Neighbours say "%s" is already fixed, so it was closed.', i.title));
  end if;
  update issues
     set status = 'closed', closed_at = now(), volunteer_id = null, assignment_id = null,
         lock_expires_at = null, stale_asked_at = null, updated_at = now()
   where id = p_issue;
  perform resolve_reviews(p_issue,
    array['escalation_request', 'wrong_issue', 'stuck', 'no_authority', 'send_back']::review_kind[],
    null, 'closed:gone', 'Neighbours confirmed the problem is gone');
  perform log_event(p_issue, null, 'closed', null, jsonb_build_object('reason', 'confirmed_gone', 'gone_answers', p_gone));
  perform notify_audience(p_issue, 'issue_closed', null,
    format('Neighbours confirmed "%s" is gone. It was closed.', i.title));
end $$;

create or replace function answer_still_there(
  p_issue uuid, p_still_there boolean, p_lat double precision default null, p_lng double precision default null
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_home geography;
  v_gone int;
  v_still int;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if not is_stale_checkable(i) then
    raise exception 'This issue is being worked on or already closed' using hint = 'LOCKED';
  end if;
  if i.volunteer_id = v_user or (i.authority_id is not null and official_authority(v_user) = i.authority_id) then
    raise exception 'You''re responsible for this issue, so neighbours decide whether it''s gone' using hint = 'OWN_TASK';
  end if;
  -- Same people who can confirm a fix: reporter, on-site confirmers, followers, or anyone nearby.
  if i.reporter_id <> v_user
     and not exists (select 1 from confirmations where issue_id = p_issue and user_id = v_user)
     and not exists (select 1 from follows where issue_id = p_issue and user_id = v_user) then
    select home_location into v_home from user_settings where user_id = v_user;
    if coalesce(ST_DWithin(make_point(p_lat, p_lng), i.location, s.reviewer_radius_m), false) = false
       and coalesce(ST_DWithin(v_home, i.location, s.reviewer_radius_m), false) = false then
      raise exception 'Only people who follow this issue or live nearby can answer' using hint = 'NOT_NEARBY';
    end if;
  end if;

  insert into still_there_answers (issue_id, user_id, still_there) values (p_issue, v_user, p_still_there)
  on conflict (issue_id, user_id) do update set still_there = excluded.still_there, answered_at = now();

  if p_still_there then
    -- Fresh evidence the problem is real: stop asking for a while.
    update issues set stale_asked_at = null where id = p_issue;
    perform log_event(p_issue, case when i.reporter_id = v_user and i.is_anonymous then null else v_user end,
      'still_there', null, null);
    return 'still_there';
  end if;

  -- Only recent answers count, so old ones don't close a problem that came back.
  select count(*) filter (where not still_there), count(*) filter (where still_there)
    into v_gone, v_still
    from still_there_answers
   where issue_id = p_issue and answered_at > now() - make_interval(days => s.stale_check_days);
  if v_gone >= s.stale_gone_quorum and v_gone > v_still then
    perform close_issue_gone(p_issue, v_gone);
    return 'closed';
  end if;
  return 'recorded';
end $$;

create or replace function get_still_there(p_issue uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'checkable', is_stale_checkable(i),
    'asked_at',  i.stale_asked_at,
    'quiet_days', floor(extract(epoch from now() - i.last_activity_at) / 86400),
    'gone',  (select count(*) from still_there_answers a
               where a.issue_id = i.id and not a.still_there and a.answered_at > now() - make_interval(days => s.stale_check_days)),
    'still', (select count(*) from still_there_answers a
               where a.issue_id = i.id and a.still_there and a.answered_at > now() - make_interval(days => s.stale_check_days)),
    'quorum', s.stale_gone_quorum,
    'my_answer', (select a.still_there from still_there_answers a where a.issue_id = i.id and a.user_id = auth.uid())
  )
  from issues i cross join app_settings s
  where i.id = p_issue and s.id = 1
$$;

-- =====================================================================
-- 6. Duplicate check across related categories
-- Same as v2, but "garbage" also finds a nearby "illegal dumping" report.
-- =====================================================================
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
    and (p_category is null
         or i.category = p_category
         or i.category in (select c2.slug from categories c1 join categories c2 on c2.duplicate_group = c1.duplicate_group
                            where c1.slug = p_category and c1.duplicate_group is not null))
    and i.status not in ('closed', 'hidden', 'expired')
    and i.created_at > now() - make_interval(days => s.duplicate_window_days)
    and ST_DWithin(i.location, make_point(p_lat, p_lng), s.duplicate_radius_m)
  order by 4
  limit 5
$$;

-- ---------- Admin: category form with the two new rules ------------
drop function if exists admin_save_category(text, text, text, text, text, resolver_type, severity_level, int, boolean);
create function admin_save_category(
  p_slug text, p_name text, p_name_bn text, p_icon text, p_color text,
  p_resolver resolver_type, p_default_severity severity_level, p_sort_order int, p_is_active boolean,
  p_volunteer_allowed boolean default true, p_duplicate_group text default null
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_slug text := coalesce(nullif(p_slug, ''), slugify(p_name));
  v_group text := nullif(slugify(p_duplicate_group), '');
begin
  if char_length(coalesce(trim(p_name), '')) < 2 then
    raise exception 'Give the category a name' using hint = 'BAD_CATEGORY';
  end if;
  if v_slug = '' then v_slug := 'category_' || floor(random() * 100000)::int; end if;
  if p_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Colour must look like #1a2b3c' using hint = 'BAD_COLOR';
  end if;
  if not coalesce(p_volunteer_allowed, true) and p_resolver = 'community' then
    raise exception 'A category that is too dangerous for volunteers must be fixed by the City Corporation'
      using hint = 'UNSAFE_FOR_VOLUNTEERS';
  end if;
  insert into categories (slug, name, name_bn, icon, color, resolver, default_severity, sort_order, is_active,
                          volunteer_allowed, duplicate_group)
  values (v_slug, trim(p_name), coalesce(trim(p_name_bn), ''), coalesce(nullif(p_icon, ''), 'circle-help'), p_color,
          p_resolver, p_default_severity, coalesce(p_sort_order, 0), coalesce(p_is_active, true),
          coalesce(p_volunteer_allowed, true), v_group)
  on conflict (slug) do update
    set name = excluded.name, name_bn = excluded.name_bn, icon = excluded.icon, color = excluded.color,
        resolver = excluded.resolver, default_severity = excluded.default_severity,
        sort_order = excluded.sort_order, is_active = excluded.is_active,
        volunteer_allowed = excluded.volunteer_allowed, duplicate_group = excluded.duplicate_group;
  perform log_admin(v_admin, 'save_category', null, null, 'Updated category',
    jsonb_build_object('slug', v_slug, 'volunteer_allowed', coalesce(p_volunteer_allowed, true), 'duplicate_group', v_group));
  return v_slug;
end $$;

-- ---------- Permissions (0010 revoked everything by default) ---------
revoke execute on function
  is_unsafe_for_volunteers(text), default_unsafe_to_authority(),
  guard_volunteer_route(), lock_route_on_admin_decision(), guard_route_requests(), review_after_reopens(),
  is_stale_checkable(issues), run_stale_checks(), close_issue_gone(uuid, int)
from public, anon, authenticated;

grant execute on function get_still_there(uuid) to anon, authenticated;
grant execute on function
  answer_still_there(uuid, boolean, double precision, double precision),
  admin_refer_issue(uuid, uuid, text),
  admin_save_category(text, text, text, text, text, resolver_type, severity_level, int, boolean, boolean, text),
  admin_save_authority(uuid, text, text, jsonb, text, text, jsonb, int, int, int, int, boolean, text)
to authenticated;

-- ---------- Schedule the "still there?" check -----------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('amarshohor-stale-checks', '7 * * * *', 'select public.run_stale_checks()');
  else
    raise notice 'pg_cron is not enabled: schedule public.run_stale_checks() to run hourly.';
  end if;
end $$;
