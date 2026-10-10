-- =====================================================================
-- AmarShohor — 60. area_label: not open to everyone by default
--
-- 0045 granted area_label to anon and authenticated (views use it) but
-- left PostgreSQL's default "everyone may run it" in place. Same rule as
-- every other function (0041): close the default, keep the grants.
-- =====================================================================

set search_path = public, extensions;

revoke execute on function area_label(text) from public;
grant execute on function area_label(text) to anon, authenticated;
