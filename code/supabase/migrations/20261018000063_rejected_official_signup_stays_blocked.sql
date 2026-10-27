-- =====================================================================
-- AmarShohor — 63. A rejected official sign-up doesn't become a resident
--
-- Before (0061): an account made on the City Corporation sign-up page
-- became an ordinary resident account if the admin rejected it.
-- Now: official accounts never act as residents. While waiting AND after a
-- rejection they can't report, vote, confirm, volunteer or raise alerts.
-- The app shows them only a waiting / "not approved" screen.
-- is_pending_official keeps its name, so every guard from 0061 (votes,
-- confirmations, reports, alerts, volunteer mode) now covers both cases.
-- =====================================================================

set search_path = public, extensions;

-- The account's latest request came from the sign-up page and isn't
-- approved, and it holds no role (an approved official has one).
create or replace function is_pending_official(p_user uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from role_requests r
     where r.user_id = p_user and r.via_signup and r.status in ('pending', 'rejected')
       and r.id = (select max(id) from role_requests where user_id = p_user)
  ) and not exists (select 1 from user_roles where user_id = p_user)
$$;

revoke execute on function is_pending_official(uuid) from public, anon;
