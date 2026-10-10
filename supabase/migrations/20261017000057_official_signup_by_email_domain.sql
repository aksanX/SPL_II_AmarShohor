-- =====================================================================
-- AmarShohor — 57. Officials sign up with their official email
--
-- Before: any citizen could ask to be an official from Settings, and the
-- admin had to check their identity by hand.
-- Now:
--   - Each City Corporation has an official email domain (e.g. dncc.gov.bd),
--     set by a super admin. Without one, it takes no official sign-ups.
--   - Officials create a separate account on the City Corporation sign-up
--     page with an email at that domain. Confirming the email proves they
--     can read mail there; then the request reaches the admins.
--   - The area admin (or a super admin) still approves or rejects.
--   - While waiting, the account can't act as a resident (report, vote,
--     confirm, volunteer, raise alerts). If rejected, it becomes an ordinary
--     resident account.
--   - Citizens can no longer ask for the role (request_official_role is gone).
-- Existing officials and requests made from Settings are unchanged.
-- =====================================================================

set search_path = public, extensions;

-- ---------- Data --------------------------------------------------------
alter table authorities
  add column email_domain text not null default ''
    check (email_domain = '' or email_domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$');
alter table role_requests add column via_signup boolean not null default false;

-- Same as 0011, plus email_domain at the end (the sign-up page needs it).
create or replace view authorities_v as
select id, name, short_name, ST_AsGeoJSON(area, 6)::jsonb as area, hotline, complaint_url, emergency_contacts,
       due_days_critical, due_days_high, due_days_medium, due_days_low, is_active, created_at, kind, email_domain
from authorities;

-- name@dncc.gov.bd and name@zone2.dncc.gov.bd both match dncc.gov.bd.
create or replace function email_matches_domain(p_email text, p_domain text) returns boolean
language sql immutable set search_path = public, extensions as $$
  select coalesce(p_domain, '') <> ''
     and (lower(split_part(p_email, '@', 2)) = lower(p_domain)
          or lower(split_part(p_email, '@', 2)) like '%.' || lower(p_domain))
$$;

-- Waiting for approval after signing up as an official.
create or replace function is_pending_official(p_user uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from role_requests where user_id = p_user and status = 'pending' and via_signup)
$$;

-- ---------- Admin: the email domain -------------------------------------
-- Same as 0011, plus p_email_domain (null keeps the current one).
drop function if exists admin_save_authority(uuid, text, text, jsonb, text, text, jsonb, int, int, int, int, boolean, text);
create function admin_save_authority(
  p_id uuid, p_name text, p_short_name text, p_area jsonb,
  p_hotline text, p_complaint_url text, p_emergency_contacts jsonb,
  p_due_critical int, p_due_high int, p_due_medium int, p_due_low int, p_is_active boolean,
  p_kind text default 'city_corporation', p_email_domain text default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_geom geometry;
  v_id uuid;
  v_domain text := lower(trim(both '@ ' from p_email_domain));
begin
  if coalesce(p_kind, '') not in ('city_corporation', 'agency') then
    raise exception 'Choose City Corporation or other agency' using hint = 'BAD_KIND';
  end if;
  if v_domain <> '' and v_domain !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then
    raise exception 'Enter only the part after @, e.g. dncc.gov.bd' using hint = 'BAD_DOMAIN';
  end if;
  begin
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_area::text), 4326);
  exception when others then
    raise exception 'The service area is not a valid map shape' using hint = 'BAD_AREA';
  end;
  if GeometryType(v_geom) not in ('POLYGON', 'MULTIPOLYGON') or not ST_IsValid(v_geom) then
    raise exception 'Draw the service area as a closed shape that doesn''t cross itself' using hint = 'BAD_AREA';
  end if;
  if jsonb_typeof(coalesce(p_emergency_contacts, '[]')) <> 'array' then
    raise exception 'Emergency contacts must be a list' using hint = 'BAD_CONTACTS';
  end if;

  if p_id is null then
    insert into authorities (name, short_name, area, hotline, complaint_url, emergency_contacts,
                             due_days_critical, due_days_high, due_days_medium, due_days_low, is_active, kind, email_domain)
    values (trim(p_name), upper(trim(p_short_name)), ST_Multi(v_geom)::geography, coalesce(trim(p_hotline), ''),
            coalesce(trim(p_complaint_url), ''), coalesce(p_emergency_contacts, '[]'),
            p_due_critical, p_due_high, p_due_medium, p_due_low, coalesce(p_is_active, true), p_kind,
            coalesce(v_domain, ''))
    returning id into v_id;
  else
    update authorities
       set name = trim(p_name), short_name = upper(trim(p_short_name)), area = ST_Multi(v_geom)::geography,
           hotline = coalesce(trim(p_hotline), ''), complaint_url = coalesce(trim(p_complaint_url), ''),
           emergency_contacts = coalesce(p_emergency_contacts, '[]'),
           due_days_critical = p_due_critical, due_days_high = p_due_high,
           due_days_medium = p_due_medium, due_days_low = p_due_low, is_active = coalesce(p_is_active, true),
           kind = p_kind, email_domain = coalesce(v_domain, email_domain)
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Authority not found' using hint = 'NOT_FOUND'; end if;
  end if;
  perform log_admin(v_admin, 'save_authority', null, null, 'Updated authority setup',
    jsonb_build_object('authority', upper(trim(p_short_name)), 'kind', p_kind, 'email_domain', v_domain));
  return v_id;
end $$;

-- ---------- Sign-up -----------------------------------------------------
-- Runs after on_auth_user_created (alphabetical), so the profile exists.
-- The sign-up page sends official_authority, designation and office as
-- user metadata. A wrong domain is refused here too, not only in the page.
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
    perform notify_city_or_super_admins(a.id, 'role_request', null, new.id,
      format('A %s official signed up with %s.', a.short_name, new.email));
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created_official on auth.users;
create trigger on_auth_user_created_official
  after insert on auth.users
  for each row execute function handle_official_signup();

-- The request reaches the admins once the official email is confirmed.
create or replace function official_email_confirmed() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare r record;
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    for r in select q.authority_id, a.short_name from role_requests q join authorities a on a.id = q.authority_id
              where q.user_id = new.id and q.status = 'pending' and q.via_signup loop
      perform notify_city_or_super_admins(r.authority_id, 'role_request', null, new.id,
        format('A %s official signed up with %s.', r.short_name, new.email));
    end loop;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_email_confirmed_official on auth.users;
create trigger on_auth_user_email_confirmed_official
  after update of email_confirmed_at on auth.users
  for each row execute function official_email_confirmed();

-- Citizens no longer ask for the role.
drop function if exists request_official_role(uuid, text, text, text);

-- ---------- Reads -------------------------------------------------------
-- Same as 0045, plus the email, whether it is at the official domain, and
-- whether the request came from the sign-up page. Sign-ups whose email isn't
-- confirmed yet are left out.
drop function if exists get_role_requests(text);
create function get_role_requests(p_status text default 'pending')
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
     and (is_admin(v_user) or r.authority_id = city_admin_authority(v_user))
     and (not r.via_signup or u.email_confirmed_at is not null)
   order by r.created_at desc
   limit 200;
end $$;

-- Same as 0010, plus via_signup.
drop function if exists get_my_role_request();
create function get_my_role_request()
returns table (id bigint, authority_short_name text, designation text, status text, decision_note text,
               created_at timestamptz, via_signup boolean)
language sql stable security definer set search_path = public, extensions as $$
  select r.id, a.short_name, r.designation, r.status, r.decision_note, r.created_at, r.via_signup
    from role_requests r join authorities a on a.id = r.authority_id
   where r.user_id = auth.uid()
   order by r.created_at desc limit 1
$$;

-- ---------- Waiting officials don't act as residents ---------------------
-- Same as 0045, plus the waiting check.
create or replace function guard_citizen_action() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_issue issues;
begin
  if is_any_admin(new.user_id) then
    raise exception 'Admins don''t vote or confirm. Residents decide; use a citizen account for your own neighbourhood.'
      using hint = 'ROLE_NOT_ALLOWED';
  end if;
  if is_pending_official(new.user_id) then
    raise exception 'Your official account is waiting for admin approval.' using hint = 'ROLE_NOT_ALLOWED';
  end if;
  if official_authority(new.user_id) is not null then
    if tg_argv[0] = 'everywhere' then
      raise exception 'City Corporation officials can''t do this. Residents decide.' using hint = 'ROLE_NOT_ALLOWED';
    end if;
    select * into v_issue from issues where id = new.issue_id;
    if official_covers(new.user_id, v_issue.authority_id, v_issue.location) then
      raise exception 'This issue is in your City Corporation''s area, so residents decide.' using hint = 'ROLE_NOT_ALLOWED';
    end if;
  end if;
  return new;
end $$;

-- Same as 0050, plus the waiting check.
create or replace function guard_issue_reporter() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if is_admin(new.reporter_id) then
    raise exception 'Super admins supervise the app and don''t report issues. Residents report them.'
      using hint = 'ROLE_NOT_ALLOWED';
  end if;
  if is_pending_official(new.reporter_id) then
    raise exception 'Your official account is waiting for admin approval.' using hint = 'ROLE_NOT_ALLOWED';
  end if;
  return new;
end $$;

-- Same as 0045, plus the waiting check.
create or replace function guard_alert_reporter() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if is_any_admin(new.reporter_id) or official_authority(new.reporter_id) is not null
     or is_pending_official(new.reporter_id) then
    raise exception 'Admins and officials review alerts; residents on site raise them. Call 999 first.'
      using hint = 'ROLE_NOT_ALLOWED';
  end if;
  return new;
end $$;

-- Same as 0056, plus the waiting check.
create or replace function set_volunteer_mode(p_on boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  v_min int;
begin
  if p_on then
    if is_any_admin(v_user) or official_authority(v_user) is not null or is_pending_official(v_user) then
      raise exception 'Admins and City Corporation officials can''t volunteer. Use a citizen account.'
        using hint = 'ROLE_NOT_ALLOWED';
    end if;
    select volunteer_min_account_hours into v_min from app_settings where id = 1;
    if (select created_at from profiles where id = v_user) > now() - make_interval(hours => v_min) then
      raise exception 'Your account must be at least % hours old to volunteer', v_min using hint = 'ACCOUNT_TOO_NEW';
    end if;
    if (select home_location from user_settings where user_id = v_user) is null then
      raise exception 'Set your home area first, so you hear about tasks near you' using hint = 'HOME_REQUIRED';
    end if;
    update profiles set is_volunteer = true, volunteer_since = coalesce(volunteer_since, now()) where id = v_user;
  else
    if exists (select 1 from assignments where volunteer_id = v_user and outcome = 'active' and role = 'volunteer')
       or exists (select 1 from assignment_members m join assignments a on a.id = m.assignment_id
                   where m.user_id = v_user and m.left_at is null and a.outcome = 'active') then
      raise exception 'Finish, release or leave your active tasks first' using hint = 'HAS_ACTIVE_TASKS';
    end if;
    update profiles set is_volunteer = false where id = v_user;
  end if;
end $$;

-- ---------- Who may run what (0041) -------------------------------------
revoke execute on function
  email_matches_domain(text, text),
  is_pending_official(uuid),
  handle_official_signup(),
  official_email_confirmed(),
  admin_save_authority(uuid, text, text, jsonb, text, text, jsonb, int, int, int, int, boolean, text, text),
  get_role_requests(text),
  get_my_role_request()
from public, anon;
grant execute on function
  admin_save_authority(uuid, text, text, jsonb, text, text, jsonb, int, int, int, int, boolean, text, text),
  get_role_requests(text),
  get_my_role_request()
to authenticated;
