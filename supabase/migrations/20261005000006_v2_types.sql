-- =====================================================================
-- AmarShohor v2 — 6. New types
-- Kept in its own file: Postgres can't use a new enum value inside the
-- transaction that adds it, and the next files use these values.
-- =====================================================================

set search_path = public, extensions;

-- New lifecycle states:
--   escalated     validated, waiting for the City Corporation to take it
--   under_review  a volunteer asked for a decision (needs City Corporation /
--                 report is wrong); an admin decides
alter type issue_status add value if not exists 'escalated' after 'validated';
alter type issue_status add value if not exists 'under_review' after 'escalated';

create type app_role as enum ('admin', 'official');

-- Who fixes an issue. Starts as the category's usual fixer; an admin can change it.
-- pending = an admin still has to decide.
create type issue_route as enum ('community', 'authority', 'pending');

-- Why an issue is waiting in the admin's review queue.
create type review_kind as enum (
  'escalation_request',  -- a volunteer says it needs the City Corporation
  'wrong_issue',         -- a volunteer says it's already fixed, fake or misplaced
  'stuck',               -- released too often, or nobody took it for too long
  'no_authority',        -- no City Corporation covers the location
  'send_back'            -- an official says volunteers can handle it
);

create type emergency_kind as enum ('fire', 'gas_leak', 'building_collapse', 'live_wire', 'flood_rescue', 'other');
