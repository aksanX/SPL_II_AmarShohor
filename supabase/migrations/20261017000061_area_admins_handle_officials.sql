-- =====================================================================
-- AmarShohor — 61. Officials are handled only by their area admin
--
-- Super admins supervise the area admins; they don't handle City
-- Corporation officials. Only the area admin of that City Corporation:
--   - is told about, sees, approves or rejects official sign-ups
--   - removes officials (role only, or the whole account, 0058)
-- A super admin who tries gets AREA_ADMIN_ONLY.
-- An area without an admin: sign-ups wait. The super admins are told the
-- area needs an admin, and see those waiting requests read-only.
-- =====================================================================

set search_path = public, extensions;

-- Super admins: never. City admins: only officials of their own area.
create or replace function require_area_admin_of(p_admin uuid, p_authority uuid) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if is_admin(p_admin) then
    raise exception 'Officials are verified and managed by their area admin, not by super admins'
      using hint = 'AREA_ADMIN_ONLY';
  end if;
  if p_authority is distinct from city_admin_authority(p_admin) then
    raise exception 'This official works for another City Corporation' using hint = 'NOT_YOUR_CITY';
  end if;
end $$;

-- An official signed up: tell the area admins, or, if the area has none,
-- the super admins that it needs one.
create or replace function notify_official_signup(p_authority uuid, p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_name text := (select short_name from authorities where id = p_authority);
begin
  if exists (select 1 from user_roles where role = 'city_admin' and authority_id = p_authority) then
    insert into notifications (user_id, type, actor_id, message)
    select user_id, 'role_request', p_user, format('A %s official signed up with %s.', v_name, p_email)
      from user_roles where role = 'city_admin' and authority_id = p_authority;
  else
    perform notify_admins('role_request', null, p_user,
      format('A %s official signed up with %s, but %s has no area admin to verify them. Appoint one in Admin → Officials & admins.',
             v_name, p_email, v_name));
  end if;
end $$;

-- ---------- Sign-up (same as 0057, new notification) ---------------------
create or replace function handle_official_signup() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  a authorities;
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}');
begin
  if coalesce(v_meta ->> 'official_authority', '') = '' then return new; end if;
  select * into a from authorities
   where id = (v_meta ->> 'official_authority')::uuid and is_active and kind = 'city_corporation';
  if not found then
    raise exception 'Unknown City Corporation' using hint = 'NOT_FOUND';
  end if;
  if a.email_domain = '' then
    raise exception '% doesn''t take official sign-ups yet', a.short_name using hint = 'NO_DOMAIN';
  end if;
  if not email_matches_domain(new.email, a.email_domain) then
    raise exception 'Use your official @% email', a.email_domain using hint = 'WRONG_DOMAIN';
  end if;

  insert into role_requests (user_id, authority_id, designation, office, message, via_signup)
  values (new.id, a.id,
          left(coalesce(nullif(trim(v_meta ->> 'designation'), ''), 'Official'), 120),
          left(coalesce(trim(v_meta ->> 'office'), ''), 200),
          '', true);
  if new.email_confirmed_at is not null then  -- email confirmation switched off
    perform notify_official_signup(a.id, new.id, new.email);
  end if;
  return new;
end $$;

create or replace function official_email_confirmed() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    for r in select q.authority_id from role_requests q
              where q.user_id = new.id and q.status = 'pending' and q.via_signup loop
      perform notify_official_signup(r.authority_id, new.id, new.email);
    end loop;
  end if;
  return new;
end $$;

-- ---------- Reads -------------------------------------------------------
-- Same as 0057. City admins: their area's requests. Super admins: only
-- requests waiting in areas that have no area admin (to see that one is
-- needed); they can't decide them.
create or replace function get_role_requests(p_status text default 'pending')
returns table (
  id bigint, user_id uuid, username text, full_name text, account_created_at timestamptz,
  authority_short_name text, designation text, office text, message text, status text,
  created_at timestamptz, decision_note text, email text, official_email boolean, via_signup boolean
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_user uuid := require_any_admin();
begin
  return query
  select r.id, r.user_id, p.username, p.full_name, p.created_at, a.short_name, r.designation, r.office,
         r.message, r.status, r.created_at, r.decision_note,
         u.email::text, email_matches_domain(u.email, a.email_domain), r.via_signup
    from role_requests r
    join profiles p on p.id = r.user_id
    join authorities a on a.id = r.authority_id
    join auth.users u on u.id = r.user_id
   where r.status = p_status
     and (r.authority_id = city_admin_authority(v_user)
          or (is_admin(v_user)
              and not exists (select 1 from user_roles c where c.role = 'city_admin' and c.authority_id = r.authority_id)))
     and (not r.via_signup or u.email_confirmed_at is not null)
   order by r.created_at desc
   limit 200;
end $$;

-- ---------- Decide (same as 0045, area admin only) ------------------------
create or replace function admin_decide_role_request(p_request bigint, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_any_admin();
  v_reason text := require_reason(p_reason);
  r role_requests;
  v_name text;
begin
  select * into r from role_requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'Request not found' using hint = 'NOT_FOUND'; end if;
  perform require_area_admin_of(v_admin, r.authority_id);
  if r.user_id = v_admin then
    raise exception 'You can''t decide your own request. Another admin has to.' using hint = 'OWN_REQUEST';
  end if;
  select short_name into v_name from authorities where id = r.authority_id;

  update role_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_admin, decision_note = v_reason, decided_at = now()
   where id = p_request;
  if p_approve then
    insert into user_roles (user_id, role, authority_id, granted_by)
    values (r.user_id, 'official', r.authority_id, v_admin)
    on conflict (user_id, role) do update set authority_id = excluded.authority_id, granted_by = v_admin, granted_at = now();
    perform notify(r.user_id, 'role_approved', null, v_admin,
      format('You are now a verified %s official. Your dashboard is under "City Corporation".', v_name));
  else
    perform notify(r.user_id, 'role_rejected', null, v_admin,
      format('Your request to be a %s official was not approved: %s', v_name, v_reason));
  end if;
  perform log_admin(v_admin, case when p_approve then 'approve_official' else 'reject_official' end,
    null, r.user_id, v_reason, jsonb_build_object('authority', v_name));
end $$;

-- ---------- Remove the role (same as 0045; officials: area admin only) ----
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
    perform require_area_admin_of(v_admin, v_authority);
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

-- ---------- Delete the account (same as 0058; officials: area admin only) --
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
    perform require_area_admin_of(v_admin, v_authority);
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

-- ---------- Who may run what (0041) -------------------------------------
revoke execute on function
  require_area_admin_of(uuid, uuid),
  notify_official_signup(uuid, uuid, text)
from public, anon, authenticated;
