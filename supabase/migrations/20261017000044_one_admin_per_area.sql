-- =====================================================================
-- AmarShohor — 44. One area admin per area
--
-- Each area (a City Corporation's map area) has exactly one area admin.
-- Appointing a second one is refused: remove the current one first.
--
-- Fixes from the fourth round of testing:
--   Q. Area admins don't see cases reported or requested by another area
--      admin (only super admins decide those). They used to see them marked
--      "an area admin reported this", which gave away who made an anonymous
--      report.
--   R. "N open cases are now yours" counts only cases the new admin may decide.
--   S. A clearer message when a decision also closes a case that only the
--      super admin may decide.
-- =====================================================================

set search_path = public, extensions;

-- ---------- One per area -----------------------------------------------
-- Areas that already have more than one keep the admin appointed first.
do $$
declare r record;
begin
  for r in
    select user_id, authority_id from (
      select user_id, authority_id, row_number() over (partition by authority_id order by granted_at, user_id) as n
        from user_roles where role = 'city_admin') x
     where n > 1
  loop
    delete from user_roles where user_id = r.user_id and role = 'city_admin';
    raise notice 'Removed a second area admin of %: each area keeps one', (select short_name from authorities where id = r.authority_id);
  end loop;
end $$;

create unique index if not exists user_roles_one_admin_per_area on user_roles (authority_id) where role = 'city_admin';

-- Same as 0042, plus a clear message when the area already has its admin.
create or replace function guard_role_mix() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_current text;
begin
  if new.role = 'city_admin' then
    if exists (select 1 from user_roles where user_id = new.user_id and role = 'official') then
      raise exception 'Officials can''t be area admins: an area admin judges complaints about the officials'' work. Remove their official role first.'
        using hint = 'ROLE_CONFLICT';
    end if;
    if exists (select 1 from user_roles where user_id = new.user_id and role = 'admin') then
      raise exception 'This person is a super admin, which already covers every area' using hint = 'ALREADY_ADMIN';
    end if;
    if not exists (select 1 from authorities where id = new.authority_id and kind = 'city_corporation' and is_active) then
      raise exception 'Area admins are for active City Corporation areas, not other agencies' using hint = 'BAD_AUTHORITY';
    end if;
    select p.username into v_current
      from user_roles u join profiles p on p.id = u.user_id
     where u.role = 'city_admin' and u.authority_id = new.authority_id and u.user_id <> new.user_id;
    if v_current is not null then
      raise exception '% already has an area admin (@%). Each area has one: remove them first.',
        (select area_label(name) from authorities where id = new.authority_id), v_current
        using hint = 'AREA_TAKEN';
    end if;
  elsif new.role = 'official' then
    if exists (select 1 from user_roles where user_id = new.user_id and role in ('city_admin', 'admin')) then
      raise exception 'Admins can''t be City Corporation officials: officials'' work is judged by the admins.'
        using hint = 'ROLE_CONFLICT';
    end if;
  elsif new.role = 'admin' then
    if exists (select 1 from user_roles where user_id = new.user_id and role = 'official') then
      raise exception 'City Corporation officials can''t be super admins. Remove their official role first.'
        using hint = 'ROLE_CONFLICT';
    end if;
  end if;
  return new;
end $$;

-- =====================================================================
-- Q. Area admins don't see other area admins' reports and requests
-- =====================================================================
-- Same as 0043, except that an area admin no longer gets cases reported or
-- requested by another area admin (their own still show, marked as theirs).
drop function if exists get_review_queue();
create function get_review_queue()
returns table (
  id bigint, kind review_kind, note text, data jsonb, created_at timestamptz,
  requester_username text, requester_full_name text, issue jsonb, evidence jsonb,
  city_id uuid, city_short_name text, passed_up_at timestamptz, needs_super_admin boolean, city_area text,
  super_reason text, clock_from timestamptz
)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_any_admin();
  v_super boolean := is_admin(v_user);
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
             coalesce(r.area_admin_since, r.created_at) as clock_from,
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
-- R. A new admin is told only about cases they may decide
-- =====================================================================
-- Same as 0041, but cases only the super admins may decide stay with them.
create or replace function city_admin_cases_follow() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  n int;
begin
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'city_admin'
     and (tg_op = 'INSERT' or old.authority_id is distinct from new.authority_id)
     and not exists (select 1 from user_roles
                      where role = 'city_admin' and authority_id = new.authority_id and user_id <> new.user_id) then
    update review_items x set passed_up_at = null, area_admin_since = now(), reminded_at = null
      from issues i
     where i.id = x.issue_id and x.status = 'open' and find_authority(i.location) = new.authority_id
       and case_has_free_area_admin(x.id);
    get diagnostics n = row_count;
    if n > 0 then
      perform notify(new.user_id, 'review_needed', null, null,
        format('%s open case%s in %s %s now yours to decide.', n, case when n = 1 then '' else 's' end,
               (select area_label(name) from authorities where id = new.authority_id), case when n = 1 then 'is' else 'are' end));
    end if;
  end if;
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

-- =====================================================================
-- S. A clearer refusal
-- =====================================================================
-- Same as 0043. One decision can close several cases of the same issue; say
-- which one stopped it.
create or replace function guard_own_request() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.status = 'open' and new.status = 'resolved' and new.resolved_by is not null then
    if new.resolved_by = old.requested_by then
      raise exception 'You made this request yourself, so the super admin decides it.' using hint = 'OWN_REQUEST';
    end if;
    if not is_admin(new.resolved_by)
       and exists (select 1 from user_roles where user_id = old.requested_by and role = 'city_admin') then
      raise exception 'This issue has a case an area admin asked for, which only the super admin can decide. Leave the issue to the super admin.'
        using hint = 'OWN_REQUEST';
    end if;
  end if;
  return new;
end $$;

-- ---------- Permissions -----------------------------------------------
revoke execute on function guard_role_mix(), city_admin_cases_follow(), guard_own_request(), get_review_queue()
from public, anon, authenticated;
grant execute on function get_review_queue() to authenticated;
