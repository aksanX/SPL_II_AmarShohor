-- =====================================================================
-- AmarShohor — 62. "Remove" deletes the whole account, no reason needed
--
-- The Remove button in Admin → Officials & admins now deletes the person's
-- account (login, profile and everything that cascades from it), not just
-- the role. Same rules as admin_revoke_role (0045):
--   super admin   may remove anyone except themselves (one super admin
--                 must always remain)
--   city admin    may remove only officials of their own City Corporation
-- Tasks the person was working on go back first (to the same City
-- Corporation, or to the volunteer pool). The log keeps their username,
-- since the account it points to is gone.
-- admin_revoke_role stays for removing a role only (SQL and tests).
-- =====================================================================

set search_path = public, extensions;

create or replace function admin_delete_account(p_username text, p_role app_role) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_any_admin();
  v_target uuid;
  v_username text;
  v_authority uuid;
  t record;
begin
  select id, username into v_target, v_username from profiles where username = lower(trim(p_username));
  if v_target is null then raise exception 'No user with that username' using hint = 'NOT_FOUND'; end if;
  if v_target = v_admin then raise exception 'You can''t remove yourself' using hint = 'NOT_ALLOWED'; end if;
  select authority_id into v_authority from user_roles where user_id = v_target and role = p_role;
  if not found then raise exception 'That user doesn''t have this role' using hint = 'NOT_FOUND'; end if;
  if not is_admin(v_admin) then
    if p_role <> 'official' or exists (select 1 from user_roles where user_id = v_target and role <> 'official') then
      raise exception 'Only super admins can remove admins and city admins' using hint = 'NOT_ADMIN';
    end if;
    if v_authority is distinct from city_admin_authority(v_admin) then
      raise exception 'This official works for another City Corporation' using hint = 'NOT_YOUR_CITY';
    end if;
  end if;
  if exists (select 1 from user_roles where user_id = v_target and role = 'admin')
     and (select count(*) from user_roles where role = 'admin') <= 1 then
    raise exception 'There must always be at least one admin' using hint = 'LAST_ADMIN';
  end if;

  for t in select id from issues where volunteer_id = v_target and status in ('assigned', 'in_progress') loop
    perform end_assignment(t.id, 'released');
    perform return_to_pool(t.id);
    perform log_event(t.id, v_admin, 'released', 'The person working on it was removed', null);
  end loop;

  -- Roles first, so the user_roles triggers hand their open cases on (0048, 0051).
  delete from user_roles where user_id = v_target;
  if p_role = 'city_admin'
     and not exists (select 1 from user_roles where role = 'city_admin' and authority_id = v_authority) then
    update review_items x set passed_up_at = now()
      from issues i
     where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is null
       and find_authority(i.location) = v_authority;
  end if;

  perform log_admin(v_admin, 'delete_' || p_role, null, null, null,
    jsonb_build_object('username', v_username)
      || case when v_authority is null then '{}'::jsonb
              else jsonb_build_object('authority', (select short_name from authorities where id = v_authority)) end);
  delete from auth.users where id = v_target;
end $$;

revoke execute on function admin_delete_account(text, app_role) from public, anon;
grant execute on function admin_delete_account(text, app_role) to authenticated;
