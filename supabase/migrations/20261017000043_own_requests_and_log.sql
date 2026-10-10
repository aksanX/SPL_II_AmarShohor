-- =====================================================================
-- AmarShohor — 43. Fixes from the third round of testing
--
-- M. Reports and requests by area admins are decided by the super admins
--    only: not by the area admin themselves, and not by another area admin
--    either. (A request can come from an area admin who made it as a
--    volunteer before being appointed.) Replaces "another area admin of the
--    area may decide it" from 0041/0042.
-- N. The Area admins overview counts a case against the area admin only
--    when they may decide it: cases on their own report or request are the
--    super admins' and no longer make the area look "Falling behind".
-- O. The Activity log filters by who acted in the database, so filtering
--    by one area admin finds their latest actions, however busy others were.
-- Also: a case that went up because nobody in the area could decide it comes
--    back to the area admins as soon as one can (and the other way round).
-- =====================================================================

set search_path = public, extensions;

-- =====================================================================
-- M. Not on your own request
-- =====================================================================
-- Every decision closes its case through review_items: refuse when the
-- admin closing it is the one who asked for it. Cases closed automatically
-- (resolved_by null) are not affected.
create or replace function guard_own_request() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.status = 'open' and new.status = 'resolved' and new.resolved_by is not null then
    if new.resolved_by = old.requested_by then
      raise exception 'You made this request yourself, so the super admin decides it.' using hint = 'OWN_REQUEST';
    end if;
    if not is_admin(new.resolved_by)
       and exists (select 1 from user_roles where user_id = old.requested_by and role = 'city_admin') then
      raise exception 'An area admin made this request, so the super admin decides it.' using hint = 'OWN_REQUEST';
    end if;
  end if;
  return new;
end $$;

-- Is this issue reported by an area admin (any area)? Then only super admins handle it.
create or replace function reported_by_area_admin(p_issue uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from issues i join user_roles u on u.user_id = i.reporter_id and u.role = 'city_admin'
                  where i.id = p_issue)
$$;

-- Admin actions on an issue: an area admin never on a report by an area admin
-- (theirs or a colleague's); that is the super admins' job. Same as 0042 otherwise.
create or replace function require_issue_admin(p_issue uuid) returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v uuid := require_admin_at((select location from issues where id = p_issue));
begin
  if not is_admin(v) and reported_by_area_admin(p_issue) then
    raise exception '%', case when exists (select 1 from issues where id = p_issue and reporter_id = v)
                              then 'This is your own report, so the super admin decides it.'
                              else 'An area admin reported this, so the super admin decides it.' end
      using hint = 'OWN_ISSUE';
  end if;
  return v;
end $$;

create or replace function can_admin_issue(p_issue uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select admin_covers(auth.uid(), i.location) and (is_admin(auth.uid()) or not reported_by_area_admin(i.id))
    from issues i where i.id = p_issue
$$;

-- New cases: to the area admins, unless an area admin reported the issue
-- (then straight to the super admins). Same as 0042 otherwise.
create or replace function other_area_admin_exists(p_issue uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select not reported_by_area_admin(p_issue) and exists (
    select 1 from issues i join user_roles u on u.role = 'city_admin' and u.authority_id = find_authority(i.location)
     where i.id = p_issue)
$$;

drop trigger if exists review_items_guard_own_request on review_items;
create trigger review_items_guard_own_request before update of status on review_items
  for each row execute function guard_own_request();

-- May the area's admins decide this case? Not when an area admin reported the
-- issue or asked for the case: then only the super admins.
create or replace function case_has_free_area_admin(p_review bigint) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from review_items r
      join issues i on i.id = r.issue_id
      join user_roles u on u.role = 'city_admin' and u.authority_id = find_authority(i.location)
     where r.id = p_review
       and not exists (select 1 from user_roles a where a.role = 'city_admin' and a.user_id in (i.reporter_id, r.requested_by)))
$$;

-- Same as 0042; 'own_report' = an area admin reported the issue or asked for the case.
drop function if exists get_review_queue();
create function get_review_queue()
returns table (
  id bigint, kind review_kind, note text, data jsonb, created_at timestamptz,
  requester_username text, requester_full_name text, issue jsonb, evidence jsonb,
  city_id uuid, city_short_name text, passed_up_at timestamptz, needs_super_admin boolean, city_area text,
  super_reason text, clock_from timestamptz
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_user uuid := require_any_admin();
begin
  return query
  select q.id, q.kind, q.note, q.data, q.created_at, q.username, q.full_name, q.issue, q.evidence,
         q.city_id, q.city_short_name, q.passed_up_at, q.reason is not null, q.city_area, q.reason, q.clock_from
    from (
      select r.id, r.kind, r.note, r.data, r.created_at, p.username, p.full_name, to_jsonb(v) as issue,
             coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'media_type', m.media_type, 'path', m.storage_path))
                         from issue_media m where m.event_id = (r.data ->> 'event')::bigint), '[]'::jsonb) as evidence,
             c.id as city_id, c.short_name as city_short_name, r.passed_up_at, area_label(c.name) as city_area,
             case when c.id is null then 'no_city_corporation'
                  when not exists (select 1 from user_roles u where u.role = 'city_admin' and u.authority_id = c.id) then 'no_admin'
                  when not case_has_free_area_admin(r.id) then 'own_report'
                  when r.passed_up_at is not null then 'waited'
             end as reason,
             coalesce(r.area_admin_since, r.created_at) as clock_from
        from review_items r
        join issues i on i.id = r.issue_id
        join issues_v v on v.id = r.issue_id
        left join profiles p on p.id = r.requested_by
        left join authorities c on c.id = find_authority(i.location)
       where r.status = 'open'
         and admin_covers(v_user, i.location)
    ) q
   order by q.created_at;
end $$;

-- Cases go back to the area admins when the reason they went up is gone (an
-- admin who reported or requested it lost the role, or another admin joined),
-- and up when nobody in the area may decide them. Same as 0041, with "an
-- admin who may decide it" in place of "an admin". Also run after every
-- change of area admins, not only of areas.
create or replace function rehome_open_cases() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
begin
  select * into s from app_settings where id = 1;
  update review_items x set passed_up_at = null, area_admin_since = now(), reminded_at = null
   where x.status = 'open' and x.passed_up_at is not null
     and case_has_free_area_admin(x.id)
     and x.passed_up_at - coalesce(x.area_admin_since, x.created_at) < make_interval(hours => s.city_admin_hours);
  update review_items x set passed_up_at = now()
   where x.status = 'open' and x.passed_up_at is null
     and not case_has_free_area_admin(x.id);
end $$;

create or replace function rehome_cases_after_role_change() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform rehome_open_cases();
  return null;
end $$;

drop trigger if exists user_roles_rehome_cases on user_roles;
create trigger user_roles_rehome_cases after insert or update or delete on user_roles
  for each statement execute function rehome_cases_after_role_change();

-- =====================================================================
-- N. The overview counts only what the area admin may decide
-- =====================================================================
-- Same as 0040; open and over-time cases leave out those the area's admins
-- may not decide (they are with the super admins). An area with no admin
-- still shows all its cases.
create or replace function get_area_overview()
returns table (
  area_id uuid, area text, short_name text, admins jsonb,
  open_cases int, overdue_cases int, pending_emergencies int,
  decided_30d int, avg_hours_to_decide numeric, last_action_at timestamptz
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s app_settings;
begin
  perform require_admin();
  select * into s from app_settings where id = 1;
  return query
  with cases as (
    select r.status, r.created_at, r.resolved_at, r.resolved_by, find_authority(i.location) as area_id,
           coalesce(r.area_admin_since, r.created_at) as clock_from,
           -- in an area with admins, none of whom may decide it (their own report or request)
           r.status = 'open' and not case_has_free_area_admin(r.id)
             and exists (select 1 from user_roles u where u.role = 'city_admin' and u.authority_id = find_authority(i.location))
             as theirs_to_skip
      from review_items r join issues i on i.id = r.issue_id
     where r.status = 'open' or r.resolved_at > now() - interval '30 days'
  ),
  areas as (
    select a.id, area_label(a.name) as area, a.short_name, false as outside
      from authorities a where a.kind = 'city_corporation' and a.is_active
    union all
    select null, 'Outside every City Corporation', null, true
  )
  select ar.id, ar.area, ar.short_name,
         coalesce((select jsonb_agg(jsonb_build_object('username', p.username, 'full_name', p.full_name) order by u.granted_at)
                     from user_roles u join profiles p on p.id = u.user_id
                    where u.role = 'city_admin' and u.authority_id = ar.id), '[]'::jsonb),
         (select count(*)::int from cases c where c.status = 'open' and c.area_id is not distinct from ar.id
             and (ar.outside or not c.theirs_to_skip)),
         (select count(*)::int from cases c where c.status = 'open' and c.area_id is not distinct from ar.id
             and (ar.outside or not c.theirs_to_skip)
             and c.clock_from < now() - make_interval(hours => s.city_admin_hours)),
         case when ar.outside then 0 else
           (select count(*)::int from emergency_alerts e
             where e.review_status = 'pending' and find_authority(e.location) = ar.id) end,
         (select count(*)::int from cases c
           where c.status = 'resolved' and c.area_id = ar.id
             and c.resolved_by in (select user_id from user_roles where role = 'city_admin' and authority_id = ar.id)),
         (select round((avg(extract(epoch from c.resolved_at - c.clock_from)) / 3600)::numeric, 1) from cases c
           where c.status = 'resolved' and c.area_id = ar.id
             and c.resolved_by in (select user_id from user_roles where role = 'city_admin' and authority_id = ar.id)),
         (select max(l.created_at) from admin_actions l
           where l.admin_id in (select user_id from user_roles where role = 'city_admin' and authority_id = ar.id))
    from areas ar
   order by ar.outside, ar.area;
end $$;

-- =====================================================================
-- O. Filter the Activity log in the database
-- =====================================================================
-- Same as 0037, plus p_who (super admins only): null = everyone, 'super' =
-- super admins, otherwise an area's name ("Dhaka North") = that area's admins.
drop function if exists get_admin_log(int);
drop function if exists get_admin_log(int, text);
create function get_admin_log(p_limit int default 100, p_who text default null)
returns table (id bigint, admin_username text, action text, issue_id uuid, issue_title text,
               target_username text, reason text, data jsonb, created_at timestamptz, admin_city text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_any_admin();
  v_city uuid := city_admin_authority(v_user);
begin
  return query
  select l.id, a.username, l.action, l.issue_id, i.title, t.username, l.reason, l.data, l.created_at, w.area
    from admin_actions l
    left join profiles a on a.id = l.admin_id
    left join profiles t on t.id = l.target_user
    left join issues i on i.id = l.issue_id
    left join lateral (select area_label(au.name) as area from user_roles ur join authorities au on au.id = ur.authority_id
                        where ur.user_id = l.admin_id and ur.role = 'city_admin') w on true
   where (is_admin(v_user)
          or l.admin_id = v_user
          or find_authority(i.location) = v_city
          or find_authority((select e.location from emergency_alerts e where e.id = (l.data ->> 'alert_id')::uuid)) = v_city
          or l.data ->> 'authority' = (select x.short_name from authorities x where x.id = v_city))
     and (p_who is null or not is_admin(v_user)
          or (p_who = 'super' and is_admin(l.admin_id))
          or (p_who <> 'super' and w.area = p_who))
   order by l.created_at desc
   limit least(greatest(p_limit, 1), 500);
end $$;

-- ---------- Permissions -----------------------------------------------
revoke execute on function
  guard_own_request(), reported_by_area_admin(uuid), require_issue_admin(uuid), other_area_admin_exists(uuid),
  case_has_free_area_admin(bigint), rehome_open_cases(), rehome_cases_after_role_change(),
  get_review_queue(), get_admin_log(int, text)
from public, anon, authenticated;
grant execute on function get_review_queue(), get_admin_log(int, text) to authenticated;

-- Today's data
do $$ begin perform rehome_open_cases(); end $$;
