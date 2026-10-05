-- =====================================================================
-- AmarShohor v2 — 7. Schema
-- Roles (admin, City Corporation official), City Corporations, per-issue
-- routing, the admin review queue, volunteer teams and emergency alerts.
-- No business logic here (see 0008).
--
-- Principle: community-driven. The admin handles setup, verification and
-- unclear cases only.
-- =====================================================================

set search_path = public, extensions;

-- ---------- Tunable rules -------------------------------------------
alter table app_settings
  -- teams
  add column team_lock_hours                int     not null default 120,
  add column team_lead_min_tasks            int     not null default 1,
  -- volunteer release reasons
  add column escalation_retake_days         int     not null default 7,
  add column escalation_abuse_rejections    int     not null default 3,
  add column escalation_abuse_window_days   int     not null default 30,
  add column rep_escalation_abuse           int     not null default -5,
  add column rep_wrong_issue_lie            int     not null default -5,
  -- stuck issues go to the admin
  add column stuck_release_count            int     not null default 3,
  add column stuck_days                     int     not null default 14,
  -- admin "request help"
  add column request_help_radius_m          int     not null default 5000,
  -- emergency alerts
  add column emergency_radius_m             int     not null default 1000,
  add column emergency_new_account_radius_m int     not null default 300,
  add column emergency_hours                int     not null default 6,
  add column emergency_max_per_day          int     not null default 2,
  add column emergency_hide_denials         int     not null default 3,
  add column emergency_end_votes            int     not null default 2,
  add column emergency_respond_radius_m     int     not null default 2000,
  add column rep_false_emergency            int     not null default -10;

-- ---------- Categories (admin-managed) -----------------------------
alter table categories
  add column is_active  boolean not null default true,
  add column created_at timestamptz not null default now();
comment on column categories.resolver is 'Who fixes new issues in this category. An admin can change it per issue.';

-- ---------- City Corporations ---------------------------------------
create table authorities (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 2 and 120),
  short_name         text not null unique check (char_length(short_name) between 2 and 16),
  area               geography(MultiPolygon, 4326) not null,  -- service area, drawn by the admin
  hotline            text not null default '' check (char_length(hotline) <= 60),
  complaint_url      text not null default '' check (char_length(complaint_url) <= 300),
  -- local emergency numbers shown next to 999: [{"label": "...", "phone": "..."}]
  emergency_contacts jsonb not null default '[]',
  -- target time to deal with an escalated issue, by severity
  due_days_critical  int not null default 3  check (due_days_critical > 0),
  due_days_high      int not null default 7  check (due_days_high > 0),
  due_days_medium    int not null default 14 check (due_days_medium > 0),
  due_days_low       int not null default 30 check (due_days_low > 0),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);
create index authorities_area_idx on authorities using gist (area);

-- ---------- Roles ---------------------------------------------------
-- The first admin is created once with SQL (see README). After that, admins
-- approve officials and other admins. Nobody can give themselves a role.
create table user_roles (
  user_id      uuid not null references profiles(id) on delete cascade,
  role         app_role not null,
  authority_id uuid references authorities(id) on delete cascade,
  granted_by   uuid references profiles(id) on delete set null,
  granted_at   timestamptz not null default now(),
  primary key (user_id, role),
  check ((role = 'official') = (authority_id is not null))
);
create index user_roles_authority_idx on user_roles (authority_id) where role = 'official';

-- "I work for DNCC": an admin checks and approves.
create table role_requests (
  id           bigserial primary key,
  user_id      uuid not null references profiles(id) on delete cascade,
  authority_id uuid not null references authorities(id) on delete cascade,
  designation  text not null check (char_length(designation) between 2 and 120),
  office       text not null default '' check (char_length(office) <= 200),
  message      text not null default '' check (char_length(message) <= 1000),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by   uuid references profiles(id) on delete set null,
  decision_note text,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create unique index role_requests_one_pending on role_requests (user_id) where status = 'pending';

-- Every admin action, with its reason.
create table admin_actions (
  id          bigserial primary key,
  admin_id    uuid references profiles(id) on delete set null,
  action      text not null,
  issue_id    uuid references issues(id) on delete set null,
  target_user uuid references profiles(id) on delete set null,
  reason      text not null,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index admin_actions_created_idx on admin_actions (created_at desc);

-- ---------- Issues: routing and escalation --------------------------
alter table issues
  add column size                 text check (size in ('small', 'medium', 'large')),
  add column base_severity        severity_level,       -- starting severity (category default)
  add column route                issue_route not null default 'pending',
  add column route_source         text check (route_source in ('category', 'admin')),
  add column authority_id         uuid references authorities(id) on delete set null,
  add column escalated_at         timestamptz,
  add column due_at               timestamptz,
  add column overdue_notified     boolean not null default false,
  add column complaint_ref        text check (char_length(complaint_ref) <= 120);
create index issues_authority_idx on issues (authority_id, status) where authority_id is not null;

-- Issues created before v2 keep their category's route.
update issues i
   set route = c.resolver::text::issue_route, route_source = 'category', base_severity = i.severity
  from categories c
 where c.slug = i.category;

-- ---------- Admin review queue --------------------------------------
create table review_items (
  id            bigserial primary key,
  issue_id      uuid not null references issues(id) on delete cascade,
  kind          review_kind not null,
  status        text not null default 'open' check (status in ('open', 'resolved')),
  requested_by  uuid references profiles(id) on delete set null,
  note          text,
  data          jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  resolved_by   uuid references profiles(id) on delete set null,
  resolved_at   timestamptz,
  decision      text,
  decision_note text
);
create unique index review_items_one_open on review_items (issue_id, kind) where status = 'open';
create index review_items_open_idx on review_items (created_at) where status = 'open';
create index review_items_requester_idx on review_items (requested_by, kind, resolved_at);

-- ---------- Assignments: officials and teams ------------------------
alter table assignments
  add column role            text not null default 'volunteer' check (role in ('volunteer', 'official')),
  add column team_size       int  not null default 1 check (team_size between 1 and 50),
  add column lead_offer_to   uuid references profiles(id) on delete set null,  -- friendly hand-over
  add column lead_offer_open boolean not null default false;                   -- leader inactive: any member may take over
alter table assignments drop constraint assignments_outcome_check;
alter table assignments add constraint assignments_outcome_check
  check (outcome in ('active', 'completed', 'released', 'expired', 'reopened', 'rerouted'));

-- assignments.volunteer_id is the team leader; these are the other members.
create table assignment_members (
  assignment_id       bigint not null references assignments(id) on delete cascade,
  user_id             uuid not null references profiles(id) on delete cascade,
  joined_at           timestamptz not null default now(),
  left_at             timestamptz,
  checked_in_at       timestamptz,   -- "I'm here" at the site; only checked-in members are rewarded
  check_in_distance_m real,
  primary key (assignment_id, user_id)
);
create index assignment_members_user_idx on assignment_members (user_id) where left_at is null;

-- ---------- Emergency alerts ----------------------------------------
-- Not issues: published at once, never assigned, expire after a few hours.
create table emergency_alerts (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid not null references profiles(id) on delete cascade,
  kind            emergency_kind not null,
  note            text not null default '' check (char_length(note) <= 500),
  location        geography(Point, 4326) not null,
  address         text not null default '' check (char_length(address) <= 200),
  media           jsonb not null default '[]',   -- [{"path", "type"}] in the reporter's storage folder
  notify_radius_m int not null,
  status          text not null default 'active' check (status in ('active', 'over', 'hidden', 'expired')),
  confirm_count   int not null default 0,
  deny_count      int not null default 0,
  over_count      int not null default 0,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  ended_at        timestamptz
);
create index emergency_alerts_location_idx on emergency_alerts using gist (location);
create index emergency_alerts_status_idx on emergency_alerts (status, created_at desc);

create table emergency_responses (
  alert_id   uuid not null references emergency_alerts(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  response   text not null check (response in ('confirm', 'deny', 'over')),
  created_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

alter table notifications add column alert_id uuid references emergency_alerts(id) on delete cascade;
