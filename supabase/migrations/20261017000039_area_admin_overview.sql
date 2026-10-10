-- =====================================================================
-- AmarShohor — 39. Super admins oversee the area admins
--
-- With an admin per area (0037), the super admin no longer works through
-- every case. Instead they check that each area admin keeps up: one row per
-- area with its admins, open cases, cases waiting longer than
-- city_admin_hours, verified emergencies waiting for a look, how many cases
-- the area's admins decided in the last 30 days and how fast, and when they
-- last acted. A last row counts cases outside every City Corporation.
-- =====================================================================

set search_path = public, extensions;

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
    select r.status, r.created_at, r.resolved_at, r.resolved_by, find_authority(i.location) as area_id
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
         (select count(*)::int from cases c where c.status = 'open' and c.area_id is not distinct from ar.id),
         (select count(*)::int from cases c where c.status = 'open' and c.area_id is not distinct from ar.id
             and c.created_at < now() - make_interval(hours => s.city_admin_hours)),
         case when ar.outside then 0 else
           (select count(*)::int from emergency_alerts e
             where e.review_status = 'pending' and find_authority(e.location) = ar.id) end,
         -- Decisions by this area's own (current) admins.
         (select count(*)::int from cases c
           where c.status = 'resolved' and c.area_id = ar.id
             and c.resolved_by in (select user_id from user_roles where role = 'city_admin' and authority_id = ar.id)),
         (select round((avg(extract(epoch from c.resolved_at - c.created_at)) / 3600)::numeric, 1) from cases c
           where c.status = 'resolved' and c.area_id = ar.id
             and c.resolved_by in (select user_id from user_roles where role = 'city_admin' and authority_id = ar.id)),
         (select max(l.created_at) from admin_actions l
           where l.admin_id in (select user_id from user_roles where role = 'city_admin' and authority_id = ar.id))
    from areas ar
   order by ar.outside, ar.area;
end $$;

revoke execute on function get_area_overview() from public, anon, authenticated;
grant execute on function get_area_overview() to authenticated;
