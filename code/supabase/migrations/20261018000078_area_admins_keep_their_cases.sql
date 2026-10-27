-- =====================================================================
-- AmarShohor — 78. Area admins keep their cases
--
-- A case an area admin left for city_admin_hours (24) went to the super
-- admins, who then did the area admin's work while the area admin did
-- nothing. Now the case stays with the area admin:
--   * Each time the limit passes it counts as a missed deadline for that
--     admin (area_admin_misses), the case gets a fresh clock, and the area
--     admin is told it is still theirs.
--   * From city_admin_miss_warning (3) missed deadlines in 30 days the area
--     admin is warned that they may be replaced.
--   * On reaching city_admin_miss_alert (5) in 30 days the super admins get
--     one message: consider replacing them. They don't decide the cases.
--   * The Area admins overview shows each area's missed deadlines, and its
--     "late" cases are the open ones that already missed one.
-- Cases still go to the super admins when nobody in the area may decide
-- them (no City Corporation, no area admin, or the area admin's own report
-- or request). Cases passed up for waiting before this go back to their
-- area admin.
-- =====================================================================

set search_path = public, extensions;

alter table app_settings add column if not exists city_admin_miss_warning int not null default 3;
alter table app_settings add column if not exists city_admin_miss_alert int not null default 5;

-- How many times this case passed the limit undecided.
alter table review_items add column if not exists missed_count int not null default 0;

create table if not exists area_admin_misses (
  id           bigserial primary key,
  admin_id     uuid not null references profiles(id) on delete cascade,
  authority_id uuid not null references authorities(id) on delete cascade,
  review_id    bigint references review_items(id) on delete set null,
  missed_at    timestamptz not null default now()
);
create index if not exists area_admin_misses_admin_idx on area_admin_misses (admin_id, missed_at);
create index if not exists area_admin_misses_area_idx on area_admin_misses (authority_id, missed_at);
alter table area_admin_misses enable row level security;  -- only reached through the functions below

-- =====================================================================
-- 1. The hourly pass: remind, then count a miss and restart the clock
-- =====================================================================
-- Same reminder as 0050 (worded for a deadline, not a hand-over). Returns
-- the number of cases that missed their deadline in this pass.
create or replace function pass_up_waiting_reviews() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  r record;
  n int := 0;
begin
  select * into s from app_settings where id = 1;

  if s.city_admin_hours > s.city_admin_reminder_hours then
    for r in
      with due as (
        update review_items x set reminded_at = now()
          from issues i
         where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is null and x.reminded_at is null
           and coalesce(x.area_admin_since, x.created_at)
                 < now() - make_interval(hours => s.city_admin_hours - s.city_admin_reminder_hours)
        returning find_authority(i.location) as area_id, i.reporter_id
      )
      select d.area_id, u.user_id, count(*)::int as cases
        from due d join user_roles u on u.role = 'city_admin' and u.authority_id = d.area_id and u.user_id <> d.reporter_id
       group by d.area_id, u.user_id
    loop
      perform notify(r.user_id, 'review_needed', null, null,
        format('%s case%s in %s %s due in about %s hours. Decide %s in the Review queue.',
               r.cases, case when r.cases = 1 then '' else 's' end, (select area_label(name) from authorities where id = r.area_id),
               case when r.cases = 1 then 'is' else 'are' end, s.city_admin_reminder_hours,
               case when r.cases = 1 then 'it' else 'them' end));
    end loop;
  end if;

  -- Missed: one miss per case for the area admin who may decide it (one per area, 0052), and a
  -- fresh clock. The misses are written in the same statement, so `total` adds this pass's to
  -- the ones already counted.
  for r in
    with late as (
      update review_items x set missed_count = x.missed_count + 1, area_admin_since = now(), reminded_at = null
        from issues i
       where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is null
         and coalesce(x.area_admin_since, x.created_at) < now() - make_interval(hours => s.city_admin_hours)
         and case_has_free_area_admin(x.id)
      returning x.id, find_authority(i.location) as area_id, i.reporter_id, x.requested_by
    ),
    missed as (
      insert into area_admin_misses (admin_id, authority_id, review_id)
      select u.user_id, l.area_id, l.id
        from late l join user_roles u on u.role = 'city_admin' and u.authority_id = l.area_id
       where u.user_id <> l.reporter_id and u.user_id is distinct from l.requested_by
      returning admin_id, authority_id
    )
    select m.admin_id, m.authority_id as area_id, count(*)::int as cases,
           count(*)::int + (select count(*)::int from area_admin_misses o
                             where o.admin_id = m.admin_id and o.missed_at > now() - interval '30 days') as total,
           (select area_label(name) from authorities where id = m.authority_id) as area,
           (select username from profiles where id = m.admin_id) as username
      from missed m
     group by m.admin_id, m.authority_id
  loop
    n := n + r.cases;
    perform notify(r.admin_id, 'review_needed', null, null,
      format('%s case%s in %s passed the %s-hour limit without a decision. %s still yours: decide %s in the Review queue. '
             || 'Missed deadlines in the last 30 days: %s.%s',
             r.cases, case when r.cases = 1 then '' else 's' end, r.area, s.city_admin_hours,
             case when r.cases = 1 then 'It is' else 'They are' end, case when r.cases = 1 then 'it' else 'them' end, r.total,
             case when r.total >= s.city_admin_miss_warning
                  then ' If this goes on, a super admin may replace you as the area admin.' else '' end));
    -- Once, when this pass takes them to the alert level.
    if r.total >= s.city_admin_miss_alert and r.total - r.cases < s.city_admin_miss_alert then
      perform notify_admins('review_needed', null, null,
        format('%s''s admin @%s missed %s deadlines in 30 days. Consider replacing them (Admin → People). '
               || 'See the Area admins overview in the Review queue.', r.area, r.username, r.total));
    end if;
  end loop;
  return n;
end $$;

-- =====================================================================
-- 2. Cases go back to the area admins whenever one may decide them
-- =====================================================================
-- Same as 0051, without "unless it went up for waiting": waiting no longer
-- sends a case up.
create or replace function rehome_open_cases() returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update review_items x set passed_up_at = null, area_admin_since = now(), reminded_at = null
   where x.status = 'open' and x.passed_up_at is not null
     and case_has_free_area_admin(x.id);
  update review_items x set passed_up_at = now()
   where x.status = 'open' and x.passed_up_at is null
     and not case_has_free_area_admin(x.id);
end $$;

-- =====================================================================
-- 3. The review queue says how often a case missed its deadline
-- =====================================================================
-- Same as 0052, plus missed_count, and without super_reason 'waited'.
drop function if exists get_review_queue();
create function get_review_queue()
returns table (
  id bigint, kind review_kind, note text, data jsonb, created_at timestamptz,
  requester_username text, requester_full_name text, issue jsonb, evidence jsonb,
  city_id uuid, city_short_name text, passed_up_at timestamptz, needs_super_admin boolean, city_area text,
  super_reason text, clock_from timestamptz, missed_count int
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_any_admin();
  v_super boolean := is_admin(v_user);
begin
  return query
  select q.id, q.kind, q.note, q.data, q.created_at, q.username, q.full_name, q.issue, q.evidence,
         q.city_id, q.city_short_name, q.passed_up_at, q.reason is not null, q.city_area, q.reason, q.clock_from, q.missed_count
    from (
      select r.id, r.kind, r.note, r.data, r.created_at, p.username, p.full_name, to_jsonb(v) as issue,
             coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'media_type', m.media_type, 'path', m.storage_path))
                         from issue_media m where m.event_id = (r.data ->> 'event')::bigint), '[]'::jsonb) as evidence,
             c.id as city_id, c.short_name as city_short_name, r.passed_up_at, area_label(c.name) as city_area,
             case when c.id is null then 'no_city_corporation'
                  when not exists (select 1 from user_roles u where u.role = 'city_admin' and u.authority_id = c.id) then 'no_admin'
                  when not case_has_free_area_admin(r.id) then 'own_report'
             end as reason,
             coalesce(r.area_admin_since, r.created_at) as clock_from,
             r.missed_count,
             i.reporter_id, r.requested_by
        from review_items r
        join issues i on i.id = r.issue_id
        join issues_v v on v.id = r.issue_id
        left join profiles p on p.id = r.requested_by
        left join authorities c on c.id = find_authority(i.location)
       where r.status = 'open'
         and admin_covers(v_user, i.location)
    ) q
   where v_super
      or q.reporter_id = v_user or q.requested_by is not distinct from v_user
      or not exists (select 1 from user_roles a where a.role = 'city_admin' and a.user_id in (q.reporter_id, q.requested_by))
   order by q.created_at;
end $$;

-- =====================================================================
-- 4. The overview counts missed deadlines
-- =====================================================================
-- Same as 0051, plus missed_30d (this area's missed deadlines in the last
-- 30 days). overdue_cases is now the open cases that already missed one.
drop function if exists get_area_overview();
create function get_area_overview()
returns table (
  area_id uuid, area text, short_name text, admins jsonb,
  open_cases int, overdue_cases int, pending_emergencies int,
  decided_30d int, avg_hours_to_decide numeric, last_action_at timestamptz, missed_30d int
)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform require_admin();
  return query
  with cases as (
    select r.status, r.created_at, r.resolved_at, r.resolved_by, find_authority(i.location) as area_id,
           coalesce(r.area_admin_since, r.created_at) as clock_from, r.missed_count,
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
             and (ar.outside or not c.theirs_to_skip) and c.missed_count > 0),
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
           where l.admin_id in (select user_id from user_roles where role = 'city_admin' and authority_id = ar.id)),
         case when ar.outside then 0 else
           (select count(*)::int from area_admin_misses m
             where m.authority_id = ar.id and m.missed_at > now() - interval '30 days') end
    from areas ar
   order by ar.outside, ar.area;
end $$;

-- ---------- Permissions -----------------------------------------------
revoke execute on function pass_up_waiting_reviews(), rehome_open_cases(), get_review_queue(), get_area_overview()
from public, anon, authenticated;
grant execute on function get_review_queue(), get_area_overview() to authenticated;
revoke all on area_admin_misses from public, anon, authenticated;

-- Today's data: cases the super admins got for waiting go back to their area admin.
select rehome_open_cases();
