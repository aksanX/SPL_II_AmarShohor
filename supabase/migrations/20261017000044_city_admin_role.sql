-- =====================================================================
-- AmarShohor — 44. New role: city admin
--
-- Kept in its own migration: a new enum value can't be used in the same
-- transaction that adds it (0045 uses it).
--
-- city_admin  Moderates one City Corporation's area (see 0045). The admins
--             from before stay 'admin' and are now the super admins.
-- =====================================================================

alter type app_role add value if not exists 'city_admin';
