-- =====================================================================
-- AmarShohor — 26. Phone numbers for both City Corporations
--
-- Shown to volunteers on escalated issues (Hotline · Call). Only fills an
-- empty hotline, so a number an admin already entered is kept.
--   DNCC: 16106 (Nagar call centre)
--   DSCC: 01709900703 (second line 01709900704)
-- =====================================================================

set search_path = public, extensions;

update authorities set hotline = '16106'       where short_name = 'DNCC' and hotline = '';
update authorities set hotline = '01709900703' where short_name = 'DSCC' and hotline = '';
