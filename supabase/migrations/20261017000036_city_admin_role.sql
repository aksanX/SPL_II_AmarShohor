-- =====================================================================
-- AmarShohor — 36. New role: city admin
--
-- Kept in its own migration: a new enum value can't be used in the same
-- transaction that adds it (0037 uses it).
--
-- city_admin  Moderates one City Corporation's area (see 0037). The admins
--             from before stay 'admin' and are now the super admins.
-- =====================================================================

alter type app_role add value if not exists 'city_admin';
