-- =====================================================================
-- AmarShohor — 55. No complaint reference, no invite by username
--
-- The City Corporation card on the issue page (hotline, Copy complaint,
-- complaint reference) is gone, so nothing records a complaint reference
-- any more. The issues.complaint_ref column stays (the issue views still
-- return it); old references keep showing on the timeline.
-- =====================================================================

set search_path = public, extensions;

drop function if exists set_complaint_ref(uuid, text);

-- Admins no longer invite one volunteer by username; "Ask nearby volunteers" stays.
drop function if exists admin_invite_volunteer(uuid, text);
