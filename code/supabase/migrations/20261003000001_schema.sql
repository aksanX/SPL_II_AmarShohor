-- =====================================================================
-- AmarShohor — 1. Schema
-- Tables, types and seed data. No business logic here (see 0002).
-- Version 1 has NO admin, NO moderator and NO AI: every decision is made
-- by community signals + the rules in 0002_logic.sql.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
set search_path = public, extensions;

-- ---------- Types ----------------------------------------------------

-- Issue lifecycle:
--   community_review → validated → assigned → in_progress
--   → resolution_submitted → closed
-- Side states: hidden (too many fake flags), expired (never validated).
create type issue_status as enum (
  'community_review', 'validated', 'assigned', 'in_progress',
  'resolution_submitted', 'closed', 'hidden', 'expired'
);

-- Declared low → critical so the enum sorts by importance.
create type severity_level as enum ('low', 'medium', 'high', 'critical');

-- community = volunteers fix it themselves
-- authority = volunteers escalate it (file complaint, follow up, confirm fix)
create type resolver_type as enum ('community', 'authority');

create type flag_reason as enum (
  'fake_or_scam', 'wrong_location', 'duplicate', 'spam', 'inappropriate', 'already_fixed'
);

create type media_kind as enum ('report', 'confirmation', 'progress', 'resolution');
create type media_type as enum ('image', 'video');

-- ---------- Tunable rules -------------------------------------------
-- One row. Every threshold the logic uses lives here so it can be tuned
-- (or relaxed for a demo) without touching code.
create table app_settings (
  id                          int primary key default 1 check (id = 1),
  -- validation thresholds (weighted score needed) per severity
  threshold_critical          numeric not null default 3,
  threshold_high              numeric not null default 5,
  threshold_medium            numeric not null default 7,
  threshold_low               numeric not null default 10,
  -- low-participation areas: fewer active users nearby → lower threshold
  low_activity_user_count     int     not null default 15,
  low_activity_factor         numeric not null default 0.6,
  min_threshold               numeric not null default 2,
  min_supporters              int     not null default 2,    -- distinct people, never one person alone
  -- vote weighting
  new_account_hours           int     not null default 24,   -- weight 0.25 below this age
  established_account_hours   int     not null default 168,  -- weight 0.5 below this age
  local_radius_m              int     not null default 3000, -- voter "local" to the issue
  far_radius_m                int     not null default 25000,-- voter far away
  confirmation_multiplier     numeric not null default 2,
  confirm_radius_m            int     not null default 200,  -- must stand near the issue
  -- fake-report hiding (ratio based, so a small group can't bury a real issue)
  hide_min_flags              int     not null default 5,
  comment_hide_flags          int     not null default 3,
  -- reporting
  duplicate_radius_m          int     not null default 50,
  duplicate_window_days       int     not null default 30,
  max_gps_accuracy_m          int     not null default 100,
  max_reports_per_day         int     not null default 10,
  review_expiry_days          int     not null default 30,
  -- service area (Bangladesh). Rejects 0,0 and out-of-country pins.
  min_lat numeric not null default 20.5,  max_lat numeric not null default 26.7,
  min_lng numeric not null default 88.0,  max_lng numeric not null default 92.7,
  -- volunteer workflow
  volunteer_min_account_hours int     not null default 72,
  max_active_tasks            int     not null default 3,
  lock_hours                  int     not null default 72,
  lock_reminder_hours         int     not null default 24,
  resolution_radius_m         int     not null default 200,
  resolution_quorum           int     not null default 2,
  reviewer_radius_m           int     not null default 3000,
  auto_close_days             int     not null default 7,
  -- reputation
  rep_task_completed          int     not null default 10,
  rep_task_expired            int     not null default -5,
  rep_task_reopened           int     not null default -15,
  rep_per_star                int     not null default 5,    -- (stars - 3) * this
  -- heatmap
  heat_half_life_days         numeric not null default 30,
  heat_min_decay              numeric not null default 0.35
);
insert into app_settings default values;

-- ---------- Reference data ------------------------------------------
create table categories (
  slug             text primary key,
  name             text not null,
  name_bn          text not null,
  icon             text not null,          -- lucide icon name used by the web app
  color            text not null,
  resolver         resolver_type not null,
  default_severity severity_level not null,
  sort_order       int not null default 0
);

insert into categories (slug, name, name_bn, icon, color, resolver, default_severity, sort_order) values
  ('pothole',            'Pothole / Road Damage',  'রাস্তার গর্ত',        'construction',   '#b45309', 'authority', 'high',     1),
  ('waterlogging',       'Waterlogging',           'জলাবদ্ধতা',          'waves',          '#0369a1', 'authority', 'high',     2),
  ('drainage',           'Drainage Blockage',      'ড্রেন বন্ধ',          'droplets',       '#0f766e', 'authority', 'high',     3),
  ('garbage',            'Overflowing Garbage',    'ময়লার স্তূপ',        'trash-2',        '#4d7c0f', 'community', 'medium',   4),
  ('illegal_dumping',    'Illegal Dumping',        'অবৈধ ময়লা ফেলা',     'package-x',      '#65a30d', 'community', 'medium',   5),
  ('dengue_breeding',    'Dengue Breeding Site',   'ডেঙ্গু প্রজননস্থল',   'bug',            '#be123c', 'community', 'critical', 6),
  ('streetlight',        'Broken Streetlight',     'নষ্ট স্ট্রিটলাইট',     'lamp',           '#a16207', 'authority', 'medium',   7),
  ('safety_hazard',      'Public Safety Hazard',   'জননিরাপত্তা ঝুঁকি',   'triangle-alert', '#dc2626', 'authority', 'critical', 8),
  ('infrastructure',     'Infrastructure Damage',  'অবকাঠামো ক্ষতি',      'building-2',     '#7c3aed', 'authority', 'high',     9),
  ('other',              'Other',                  'অন্যান্য',            'circle-help',    '#64748b', 'community', 'low',     10);

-- ---------- People ---------------------------------------------------
-- Public profile (readable by everyone). Private data lives in user_settings.
create table profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  username         text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  full_name        text not null default '' check (char_length(full_name) <= 80),
  avatar_url       text,
  bio              text not null default '' check (char_length(bio) <= 280),
  area_name        text not null default '' check (char_length(area_name) <= 80),
  is_volunteer     boolean not null default false,
  volunteer_since  timestamptz,
  reputation       int not null default 0,
  tasks_completed  int not null default 0,
  tasks_expired    int not null default 0,
  tasks_reopened   int not null default 0,
  rating_sum       int not null default 0,
  rating_count     int not null default 0,
  reports_count    int not null default 0,
  created_at       timestamptz not null default now()
);

-- Private per-user settings (only the owner can read/write).
create table user_settings (
  user_id             uuid primary key references profiles(id) on delete cascade,
  home_location       geography(Point, 4326),
  default_anonymous   boolean not null default false,
  show_on_leaderboard boolean not null default true,
  updated_at          timestamptz not null default now()
);

-- ---------- Issues ---------------------------------------------------
create table issues (
  id                     uuid primary key default gen_random_uuid(),
  reporter_id            uuid not null references profiles(id) on delete cascade,
  title                  text not null check (char_length(title) between 5 and 120),
  description            text not null default '' check (char_length(description) <= 2000),
  category               text not null references categories(slug),
  severity               severity_level not null,
  location               geography(Point, 4326) not null,
  location_accuracy_m    real,
  location_source        text not null default 'gps' check (location_source in ('gps', 'manual')),
  address                text not null default '' check (char_length(address) <= 200),
  is_anonymous           boolean not null default false,
  status                 issue_status not null default 'community_review',
  status_before_hidden   issue_status,
  -- counters & scores: written only by the SECURITY DEFINER functions
  upvote_count           int not null default 0,
  confirmation_count     int not null default 0,
  comment_count          int not null default 0,
  follower_count         int not null default 0,
  flag_count             int not null default 0,
  validation_score       numeric(8,2) not null default 0,
  flag_score             numeric(8,2) not null default 0,
  validation_threshold   numeric(8,2) not null default 7,
  -- volunteer workflow (current assignment)
  volunteer_id           uuid references profiles(id) on delete set null,
  assignment_id          bigint,
  assigned_at            timestamptz,
  lock_expires_at        timestamptz,
  lock_reminder_sent     boolean not null default false,
  resolution_note        text,
  resolution_submitted_at timestamptz,
  validated_at           timestamptz,
  closed_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  last_activity_at       timestamptz not null default now()
);
create index issues_location_idx  on issues using gist (location);
create index issues_status_idx    on issues (status, created_at desc);
create index issues_category_idx  on issues (category);
create index issues_reporter_idx  on issues (reporter_id);
create index issues_volunteer_idx on issues (volunteer_id) where volunteer_id is not null;

-- Timeline of everything that happened to an issue (also the "issue history").
create table issue_events (
  id         bigserial primary key,
  issue_id   uuid not null references issues(id) on delete cascade,
  actor_id   uuid references profiles(id) on delete set null,
  type       text not null,     -- created, validated, hidden, unhidden, assigned, progress, released,
                                -- lock_expired, resolution_submitted, closed, reopened, expired, edited
  note       text,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index issue_events_issue_idx on issue_events (issue_id, created_at);

-- Photos/videos. Files live in Supabase Storage; this stores their paths.
create table issue_media (
  id           uuid primary key default gen_random_uuid(),
  issue_id     uuid not null references issues(id) on delete cascade,
  uploader_id  uuid not null references profiles(id) on delete cascade,
  kind         media_kind not null,
  media_type   media_type not null,
  storage_path text not null,
  event_id     bigint references issue_events(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index issue_media_issue_idx on issue_media (issue_id, created_at);

-- ---------- Community signals ---------------------------------------
create table votes (
  issue_id   uuid not null references issues(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  weight     numeric(4,2) not null,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

-- "I see this too": on-site confirmation with a photo. Worth more than a vote.
create table confirmations (
  issue_id   uuid not null references issues(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  note       text not null default '' check (char_length(note) <= 500),
  distance_m real not null,
  weight     numeric(4,2) not null,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

create table flags (
  issue_id   uuid not null references issues(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  reason     flag_reason not null,
  details    text not null default '' check (char_length(details) <= 500),
  weight     numeric(4,2) not null,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

-- Community decides priority (reporter can't pick "critical" to skip the queue).
create table severity_votes (
  issue_id   uuid not null references issues(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  severity   severity_level not null,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

create table follows (
  issue_id   uuid not null references issues(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);
create index follows_user_idx on follows (user_id);

-- ---------- Discussion ----------------------------------------------
create table comments (
  id          uuid primary key default gen_random_uuid(),
  issue_id    uuid not null references issues(id) on delete cascade,
  author_id   uuid not null references profiles(id) on delete cascade,
  parent_id   uuid references comments(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  is_update   boolean not null default false,   -- "share an update" posts
  flag_count  int not null default 0,
  is_hidden   boolean not null default false,
  deleted_at  timestamptz,
  edited_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index comments_issue_idx on comments (issue_id, created_at);

create table comment_flags (
  comment_id uuid not null references comments(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

-- ---------- Volunteer workflow --------------------------------------
-- One row per time a volunteer takes an issue (an issue can be taken again
-- after a release, expiry or reopen).
create table assignments (
  id           bigserial primary key,
  issue_id     uuid not null references issues(id) on delete cascade,
  volunteer_id uuid not null references profiles(id) on delete cascade,
  accepted_at  timestamptz not null default now(),
  ended_at     timestamptz,
  outcome      text not null default 'active'
               check (outcome in ('active', 'completed', 'released', 'expired', 'reopened'))
);
create index assignments_volunteer_idx on assignments (volunteer_id, outcome);
create unique index assignments_one_active on assignments (issue_id) where outcome = 'active';

alter table issues
  add constraint issues_assignment_fk foreign key (assignment_id) references assignments(id) on delete set null;

-- Citizens' verdict on a submitted resolution (per assignment round).
create table resolution_reviews (
  issue_id      uuid not null references issues(id) on delete cascade,
  assignment_id bigint not null references assignments(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  is_fixed      boolean not null,
  created_at    timestamptz not null default now(),
  primary key (assignment_id, user_id)
);

create table ratings (
  id            bigserial primary key,
  issue_id      uuid not null references issues(id) on delete cascade,
  assignment_id bigint not null unique references assignments(id) on delete cascade,
  volunteer_id  uuid not null references profiles(id) on delete cascade,
  rater_id      uuid not null references profiles(id) on delete cascade,
  stars         int not null check (stars between 1 and 5),
  review        text not null default '' check (char_length(review) <= 500),
  created_at    timestamptz not null default now()
);
create index ratings_volunteer_idx on ratings (volunteer_id, created_at desc);

-- ---------- Notifications -------------------------------------------
create table notifications (
  id         bigserial primary key,
  user_id    uuid not null references profiles(id) on delete cascade,
  type       text not null,
  issue_id   uuid references issues(id) on delete cascade,
  actor_id   uuid references profiles(id) on delete set null,
  message    text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
