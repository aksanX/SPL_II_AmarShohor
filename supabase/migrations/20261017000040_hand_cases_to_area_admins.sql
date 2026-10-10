-- =====================================================================
-- AmarShohor — 40. Cases follow the area admins
--
-- 0037 sent a case to the super admins when its area had no admin, and kept
-- it there even after an admin was appointed. Now:
--   - An area that gets its first admin hands them its open cases, with a
--     fresh city_admin_hours clock (old cases don't bounce straight back up).
--   - An area left with no admin (removed, or moved to another area) sends
--     its open cases to the super admins.
--   - The review queue says why a case is with the super admins
--     (super_reason), and from when the area admin's clock runs (clock_from).
-- Also fixes cases already sent up in areas that now have an admin.
-- =====================================================================

set search_path = public, extensions;

-- When the current area admins' clock started on this case; null = when it was opened.
alter table review_items add column if not exists area_admin_since timestamptz;

-- ---------- Cases follow the area admins ------------------------------
create or replace function city_admin_cases_follow() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  n int;
begin
  -- An area that just got its first admin: its open cases are theirs now.
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'city_admin'
     and (tg_op = 'INSERT' or old.authority_id is distinct from new.authority_id)
     and not exists (select 1 from user_roles
                      where role = 'city_admin' and authority_id = new.authority_id and user_id <> new.user_id) then
    update review_items x set passed_up_at = null, area_admin_since = now()
      from issues i
     where i.id = x.issue_id and x.status = 'open' and find_authority(i.location) = new.authority_id;
    get diagnostics n = row_count;
    if n > 0 then
      perform notify(new.user_id, 'review_needed', null, null,
        format('%s open case%s in %s %s now yours to decide.', n, case when n = 1 then '' else 's' end,
               (select area_label(name) from authorities where id = new.authority_id), case when n = 1 then 'is' else 'are' end));
    end if;
  end if;
  -- An area left with no admin: its open cases go to the super admins.
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'city_admin'
     and (tg_op = 'DELETE' or old.authority_id is distinct from new.authority_id)
     and not exists (select 1 from user_roles where role = 'city_admin' and authority_id = old.authority_id) then
    update review_items x set passed_up_at = now()
      from issues i
     where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is null
       and find_authority(i.location) = old.authority_id;
  end if;
  return null;
end $$;

drop trigger if exists user_roles_cases_follow on user_roles;
create trigger user_roles_cases_follow after insert or update of authority_id or delete on user_roles
  for each row execute function city_admin_cases_follow();

-- ---------- The clock runs from when the area admins got the case ------
-- Same as 0037 otherwise.
create or replace function pass_up_waiting_reviews() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  r record;
  n int := 0;
begin
  select * into s from app_settings where id = 1;
  for r in
    select x.id, x.issue_id, x.kind, i.title, area_label(a.name) as area
      from review_items x
      join issues i on i.id = x.issue_id
      left join authorities a on a.id = find_authority(i.location)
     where x.status = 'open' and x.passed_up_at is null
       and coalesce(x.area_admin_since, x.created_at) < now() - make_interval(hours => s.city_admin_hours)
     order by x.created_at
       for update of x skip locked
  loop
    update review_items set passed_up_at = now() where id = r.id;
    perform notify_admins('review_needed', r.issue_id, null,
      format('Waiting over %s hours for the %s admin (%s): "%s". You can decide it.',
             s.city_admin_hours, coalesce(r.area, 'area'), replace(r.kind::text, '_', ' '), r.title));
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- The queue says why a case is with the super admins --------
-- Same as 0037, plus at the end:
--   super_reason  null (with the area admin), 'no_city_corporation', 'no_admin' or 'waited'
--   clock_from    when the area admin's city_admin_hours started
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

-- ---------- Overview: over-time counted from the same clock ------------
-- Same as 0039 otherwise.
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
           coalesce(r.area_admin_since, r.created_at) as clock_from
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

-- ---------- Cases already sent up in areas that now have an admin -----
-- Sent up because nobody covered the area then, not because its admin waited:
-- the admin gets them now, with a fresh clock.
update review_items x set passed_up_at = null, area_admin_since = now()
  from issues i, app_settings s
 where s.id = 1 and i.id = x.issue_id and x.status = 'open' and x.passed_up_at is not null
   and exists (select 1 from user_roles u where u.role = 'city_admin' and u.authority_id = find_authority(i.location))
   and x.passed_up_at - coalesce(x.area_admin_since, x.created_at) < make_interval(hours => s.city_admin_hours);

-- ---------- Permissions -----------------------------------------------
revoke execute on function city_admin_cases_follow(), get_review_queue() from public, anon, authenticated;
grant execute on function get_review_queue() to authenticated;
