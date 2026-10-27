-- =====================================================================
-- AmarShohor — 0016: new enum values
--
-- Kept in their own migration: a new enum value can't be used in the same
-- transaction that adds it (later migrations use these).
--
-- toxic_release      Chemical spills giving off fumes and toxic smoke are
--                    emergencies, not repair jobs.
-- category_mismatch  People who saw an issue say it's a different kind of
--                    problem, but they disagree or the issue is already
--                    being worked on: an admin decides.
-- =====================================================================

alter type emergency_kind add value if not exists 'toxic_release' before 'other';
alter type review_kind add value if not exists 'category_mismatch';
