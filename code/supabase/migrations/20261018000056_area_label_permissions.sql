-- =====================================================================
-- AmarShohor — 56. area_label(): granted on purpose, not to everyone
--
-- area_label() (0045) was left open to PUBLIC like every function used to
-- be before 0041. It only shortens an area name, and the comments,
-- timeline and roles views call it, so visitors and users do need it:
-- a view checks function permissions as the person reading it. Grant it
-- to exactly those roles, as 0041 asks of every new function.
-- =====================================================================

revoke execute on function area_label(text) from public;
grant execute on function area_label(text) to anon, authenticated;
