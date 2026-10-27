-- =====================================================================
-- AmarShohor — 24. New review kind: appeal
-- Kept in its own file: a new enum value can't be used in the same
-- transaction that adds it (0025 uses it).
--
-- appeal  The reporter says their hidden report is real; an admin decides.
-- =====================================================================

alter type review_kind add value if not exists 'appeal';
