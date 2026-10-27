-- =====================================================================
-- AmarShohor — 69. Super admins can remove any official
--
-- 0064 left removing officials to their area admin only. Now a super admin
-- can also remove any City Corporation's official at any time (the Remove
-- button deletes the account, 0062). Area admins still remove only their
-- own area's officials, and approving or rejecting new official sign-ups
-- stays with the area admin (0064).
-- Same as 0064 otherwise.
-- =====================================================================

set search_path = public, extensions;

-- ---------- Remove the role (SQL; officials: super admin or own area admin) --
create or replace function admin_revoke_role(p_username text, p_role app_role, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_any_admin();
  v_reason text := require_reason(p_reason);
  v_target uuid;
  v_authority uuid;
  t record;
begin
  select id into v_target from profiles where username = lower(trim(p_username));
  if v_target is null then raise exception 'No user with that username' using hint = 'NOT_FOUND'; end if;
  select authority_id into v_authority from user_roles where user_id = v_target and role = p_role;
  if p_role = 'official' then
    if not is_admin(v_admin) then  -- super admins may remove any official
      perform require_area_admin_of(v_admin, v_authority);
    end if;
  elsif not is_admin(v_admin) then
    raise exception 'Only super admins can remove admins and city admins' using hint = 'NOT_ADMIN';
  end if;
  if p_role = 'admin' and (select count(*) from user_roles where role = 'admin') <= 1 then
    raise exception 'There must always be at least one admin' using hint = 'LAST_ADMIN';
  end if;
  delete from user_roles where user_id = v_target and role = p_role;
  if not found then raise exception 'That user doesn''t have this role' using hint = 'NOT_FOUND'; end if;

  if p_role = 'official' then
    for t in select id from issues where volunteer_id = v_target and status in ('assigned', 'in_progress') loop
      perform end_assignment(t.id, 'released');
      perform return_to_pool(t.id);
      perform log_event(t.id, v_admin, 'released', 'The official''s role was removed', null);
    end loop;
  elsif p_role = 'city_admin'
        and not exists (select 1 from user_roles where role = 'city_admin' and authority_id = v_authority) then
    update review_items x set passed_up_at = now()
      from issues i
     where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is null
       and find_authority(i.location) = v_authority;
  end if;
  perform notify(v_target, 'role_removed', null, v_admin,
    format('Your %s role was removed: %s', replace(p_role::text, '_', ' '), v_reason));
  perform log_admin(v_admin, 'revoke_' || p_role, null, v_target, v_reason,
    case when v_authority is null then null
         else jsonb_build_object('authority', (select short_name from authorities where id = v_authority)) end);
end $$;

-- ---------- Delete the account (the Remove button) ------------------------
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
  if p_role = 'official' then
    if not is_admin(v_admin) then  -- super admins may remove any official
      perform require_area_admin_of(v_admin, v_authority);
    end if;
    if exists (select 1 from user_roles where user_id = v_target and role <> 'official') then
      raise exception 'Only super admins can remove admins and city admins' using hint = 'NOT_ADMIN';
    end if;
  elsif not is_admin(v_admin) then
    raise exception 'Only super admins can remove admins and city admins' using hint = 'NOT_ADMIN';
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
