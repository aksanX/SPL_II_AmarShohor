-- =====================================================================
-- AmarShohor v2 — 9. Read API and security
-- Views gain routing, City Corporation, team and badge fields (new columns
-- are appended so existing ones keep their order). Then every function is
-- locked down again and the public ones re-granted, as in 0003.
-- =====================================================================

set search_path = public, extensions;

-- ---------- Views ---------------------------------------------------

create or replace view issues_v as
select
  i.id, i.title, i.description, i.category,
  coalesce(c.name, 'Uncategorised') as category_name, coalesce(c.name_bn, '') as category_name_bn,
  coalesce(c.icon, 'circle-help') as category_icon, coalesce(c.color, '#64748b') as category_color,
  c.resolver,
  i.severity,
  ST_Y(i.location::geometry) as lat,
  ST_X(i.location::geometry) as lng,
  i.location_accuracy_m, i.location_source, i.address,
  i.status, i.is_anonymous,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else i.reporter_id end as reporter_id,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else rp.username end as reporter_username,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else rp.full_name end as reporter_full_name,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else rp.avatar_url end as reporter_avatar_url,
  coalesce(i.reporter_id = auth.uid(), false) as is_mine,
  i.upvote_count, i.confirmation_count, i.comment_count, i.follower_count, i.flag_count,
  i.validation_score, i.validation_threshold,
  i.volunteer_id, vp.username as volunteer_username, vp.full_name as volunteer_full_name,
  vp.avatar_url as volunteer_avatar_url,
  i.assigned_at, i.lock_expires_at, i.resolution_note, i.resolution_submitted_at,
  i.validated_at, i.closed_at, i.created_at, i.updated_at, i.last_activity_at,
  exists (select 1 from votes v where v.issue_id = i.id and v.user_id = auth.uid()) as my_vote,
  exists (select 1 from confirmations x where x.issue_id = i.id and x.user_id = auth.uid()) as my_confirmed,
  exists (select 1 from flags f where f.issue_id = i.id and f.user_id = auth.uid()) as my_flagged,
  exists (select 1 from follows f where f.issue_id = i.id and f.user_id = auth.uid()) as my_following,
  (select s.severity from severity_votes s where s.issue_id = i.id and s.user_id = auth.uid()) as my_severity_vote,
  (select r.is_fixed from resolution_reviews r where r.assignment_id = i.assignment_id and r.user_id = auth.uid()) as my_resolution_review,
  exists (select 1 from ratings r where r.assignment_id = i.assignment_id) as is_rated,
  coalesce((
    select json_agg(json_build_object('id', m.id, 'kind', m.kind, 'media_type', m.media_type, 'path', m.storage_path)
                    order by (m.kind = 'report') desc, m.created_at)
      from (select * from issue_media m2
             where m2.issue_id = i.id and m2.kind in ('report', 'confirmation')
             order by (m2.kind = 'report') desc, m2.created_at limit 6) m
  ), '[]'::json) as media,
  -- v2: routing
  i.size, i.route, i.route_source,
  -- v2: City Corporation
  i.authority_id, au.name as authority_name, au.short_name as authority_short_name,
  au.hotline as authority_hotline, au.complaint_url as authority_complaint_url,
  i.escalated_at, i.due_at,
  coalesce(i.due_at < now() and i.status in ('escalated', 'assigned', 'in_progress', 'resolution_submitted'), false) as is_overdue,
  i.complaint_ref,
  coalesce(a.role, 'volunteer') as assignee_role,
  coalesce(official_authority(auth.uid()) = i.authority_id, false) as i_am_official_here,
  -- v2: teams
  coalesce(a.team_size, 1) as team_size,
  (select count(*)::int from assignment_members m where m.assignment_id = a.id and m.left_at is null) as team_count,
  coalesce(is_team_member(a.id, auth.uid()), false) as my_team_member,
  exists (select 1 from assignment_members m where m.assignment_id = a.id and m.user_id = auth.uid()
           and m.left_at is null and m.checked_in_at is not null) as my_checked_in,
  coalesce(a.lead_offer_open, false) as lead_offer_open,
  coalesce(a.lead_offer_to = auth.uid(), false) as lead_offer_to_me,
  -- v2: waiting for an admin
  exists (select 1 from review_items r where r.issue_id = i.id and r.status = 'open') as pending_review
from issues i
left join categories c on c.slug = i.category
join profiles rp on rp.id = i.reporter_id
left join profiles vp on vp.id = i.volunteer_id
left join authorities au on au.id = i.authority_id
left join assignments a on a.id = i.assignment_id;

create or replace view issue_events_v as
select e.id, e.issue_id, e.type, e.note, e.data, e.created_at,
       case when i.is_anonymous and e.actor_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else e.actor_id end as actor_id,
       case when i.is_anonymous and e.actor_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else p.username end as actor_username,
       case when i.is_anonymous and e.actor_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else p.full_name end as actor_full_name,
       case when i.is_anonymous and e.actor_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else p.avatar_url end as actor_avatar_url,
       coalesce((
         select json_agg(json_build_object('id', m.id, 'kind', m.kind, 'media_type', m.media_type, 'path', m.storage_path)
                         order by m.created_at)
           from issue_media m where m.event_id = e.id
       ), '[]'::json) as media,
       (select a.short_name from user_roles r join authorities a on a.id = r.authority_id
         where r.user_id = e.actor_id and r.role = 'official') as actor_official_of,
       coalesce(is_admin(e.actor_id), false) as actor_is_admin
from issue_events e
join issues i on i.id = e.issue_id
left join profiles p on p.id = e.actor_id;

create or replace view comments_v as
select c.id, c.issue_id, c.parent_id, c.author_id,
       p.username as author_username, p.full_name as author_full_name, p.avatar_url as author_avatar_url,
       case when c.deleted_at is not null or c.is_hidden then null else c.body end as body,
       c.deleted_at is not null as is_deleted, c.is_hidden, c.is_update, c.edited_at, c.created_at,
       coalesce(c.author_id = i.volunteer_id and i.route <> 'authority', false) as is_volunteer,
       (c.author_id = i.reporter_id and not i.is_anonymous) as is_reporter,
       exists (select 1 from comment_flags f where f.comment_id = c.id and f.user_id = auth.uid()) as my_flagged,
       (select a.short_name from user_roles r join authorities a on a.id = r.authority_id
         where r.user_id = c.author_id and r.role = 'official') as author_official_of
from comments c
join profiles p on p.id = c.author_id
join issues i on i.id = c.issue_id;

create or replace view notifications_v as
select n.id, n.type, n.issue_id, n.message, n.read_at, n.created_at,
       n.actor_id, p.username as actor_username, p.full_name as actor_full_name, p.avatar_url as actor_avatar_url,
       n.alert_id
from notifications n
left join profiles p on p.id = n.actor_id
where n.user_id = auth.uid();

-- Public: who is an admin or an official (for badges).
create or replace view roles_v as
select r.user_id, p.username, p.full_name, p.avatar_url, r.role, r.authority_id, a.short_name as authority_short_name, r.granted_at
from user_roles r
join profiles p on p.id = r.user_id
left join authorities a on a.id = r.authority_id;

-- Public: City Corporations with their service area as GeoJSON.
create or replace view authorities_v as
select id, name, short_name, ST_AsGeoJSON(area, 6)::jsonb as area, hotline, complaint_url, emergency_contacts,
       due_days_critical, due_days_high, due_days_medium, due_days_low, is_active, created_at
from authorities;

-- Public record: facts only, no star ratings.
create or replace view authority_record_v as
select a.id, a.name, a.short_name, a.hotline, a.complaint_url,
       count(i.id) filter (where i.escalated_at is not null)::int as escalated,
       count(i.id) filter (where i.status = 'closed' and i.escalated_at is not null)::int as resolved,
       count(i.id) filter (where i.status in ('escalated', 'assigned', 'in_progress', 'resolution_submitted'))::int as open,
       count(i.id) filter (where i.due_at < now()
                             and i.status in ('escalated', 'assigned', 'in_progress', 'resolution_submitted'))::int as overdue,
       round((avg(extract(epoch from i.closed_at - i.escalated_at) / 86400)
                filter (where i.status = 'closed' and i.escalated_at is not null))::numeric, 1) as avg_days_to_resolve
from authorities a
left join issues i on i.authority_id = a.id and i.route = 'authority'
where a.is_active
group by a.id;

-- ---------- Feed, tasks, map (replace 0003) -------------------------
create or replace function get_feed(
  p_sort text default 'hot',
  p_scope text default 'all',
  p_category text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_m int default 5000,
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0
) returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select v.*
  from issues_v v
  where (p_category is null or v.category = p_category)
    and case p_scope
          when 'mine'       then v.is_mine
          when 'following'  then v.my_following and v.status not in ('hidden', 'expired')
          when 'unverified' then v.status = 'community_review'
          when 'validated'  then v.status in ('validated', 'escalated', 'under_review', 'assigned', 'in_progress', 'resolution_submitted')
          when 'resolved'   then v.status = 'closed'
          else v.status not in ('hidden', 'expired')
        end
    and (p_sort <> 'near' or p_lat is null
         or ST_DWithin(make_point(v.lat, v.lng), make_point(p_lat, p_lng), p_radius_m))
    and (p_sort <> 'top' or v.created_at > now() - interval '30 days')
    and (coalesce(trim(p_search), '') = ''
         or v.title ilike '%' || trim(p_search) || '%'
         or v.description ilike '%' || trim(p_search) || '%'
         or v.address ilike '%' || trim(p_search) || '%')
  order by
    case when p_sort = 'near' and p_lat is not null
         then ST_Distance(make_point(v.lat, v.lng), make_point(p_lat, p_lng)) end asc nulls last,
    case when p_sort = 'top' then v.upvote_count + 2 * v.confirmation_count end desc nulls last,
    case when p_sort = 'hot'
         then (v.upvote_count + 2 * v.confirmation_count + 0.5 * v.comment_count + 1)
              / power(extract(epoch from now() - v.created_at) / 3600 + 2, 1.5) end desc nulls last,
    v.created_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
$$;

create or replace function get_issue(p_issue uuid) returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select * from issues_v where id = p_issue
$$;

create or replace function get_user_issues(p_username text, p_limit int default 20, p_offset int default 0)
returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select v.* from issues_v v
  join issues i on i.id = v.id
  join profiles p on p.id = i.reporter_id
  where p.username = p_username
    and (not i.is_anonymous or i.reporter_id = auth.uid())
    and (i.status not in ('hidden', 'expired') or i.reporter_id = auth.uid())
  order by v.created_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
$$;

-- Volunteer board: community issues only.
create or replace function get_open_tasks(
  p_lat double precision default null, p_lng double precision default null,
  p_radius_m int default 10000, p_category text default null
) returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select v.* from issues_v v
  where v.status = 'validated' and v.route = 'community'
    and (p_category is null or v.category = p_category)
    and (p_lat is null or ST_DWithin(make_point(v.lat, v.lng), make_point(p_lat, p_lng), p_radius_m))
  order by
    severity_weight(v.severity) desc,
    case when p_lat is not null then ST_Distance(make_point(v.lat, v.lng), make_point(p_lat, p_lng)) end asc nulls last,
    v.validated_at asc
  limit 100
$$;

-- Teams that still need people.
create or replace function get_open_teams(
  p_lat double precision default null, p_lng double precision default null, p_radius_m int default 10000
) returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select v.* from issues_v v
  where v.status in ('assigned', 'in_progress') and v.route = 'community'
    and v.team_size > v.team_count + 1
    and v.volunteer_id is distinct from auth.uid() and not v.my_team_member
    and (p_lat is null or ST_DWithin(make_point(v.lat, v.lng), make_point(p_lat, p_lng), p_radius_m))
  order by case when p_lat is not null then ST_Distance(make_point(v.lat, v.lng), make_point(p_lat, p_lng)) end asc nulls last,
           v.assigned_at desc
  limit 50
$$;

-- Tasks I lead or am a team member of.
create or replace function get_my_tasks() returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select v.* from issues_v v
  where (v.volunteer_id = auth.uid() or v.my_team_member)
    and v.status in ('assigned', 'in_progress', 'resolution_submitted', 'closed')
  order by (v.status = 'closed'), v.lock_expires_at asc nulls last, v.closed_at desc nulls last
  limit 100
$$;

-- Official dashboard. p_tab: new | active | overdue | done
create or replace function get_authority_tasks(p_tab text default 'new') returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select v.* from issues_v v
  where v.authority_id = official_authority(auth.uid()) and v.route = 'authority'
    and case p_tab
          when 'new'     then v.status = 'escalated'
          when 'active'  then v.status in ('assigned', 'in_progress', 'resolution_submitted')
          when 'overdue' then v.is_overdue
          when 'done'    then v.status = 'closed'
          else false
        end
  order by v.is_overdue desc, v.due_at asc nulls last, v.closed_at desc nulls last
  limit 200
$$;

create or replace function get_team(p_issue uuid)
returns table (user_id uuid, username text, full_name text, avatar_url text, is_leader boolean,
               joined_at timestamptz, checked_in_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.username, p.full_name, p.avatar_url, true, a.accepted_at, null::timestamptz
    from issues i join assignments a on a.id = i.assignment_id join profiles p on p.id = a.volunteer_id
   where i.id = p_issue
  union all
  select p.id, p.username, p.full_name, p.avatar_url, false, m.joined_at, m.checked_in_at
    from issues i join assignment_members m on m.assignment_id = i.assignment_id and m.left_at is null
    join profiles p on p.id = m.user_id
   where i.id = p_issue
  order by 5 desc, 6
$$;

create or replace function map_issues(
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision,
  p_category text default null,
  p_layers text[] default array['active']
) returns table (
  id uuid, title text, category text, category_color text, category_icon text,
  severity severity_level, status issue_status, lat double precision, lng double precision,
  upvote_count int, confirmation_count int, validation_score numeric, validation_threshold numeric,
  created_at timestamptz, thumb_path text, thumb_type media_type
)
language sql stable security definer set search_path = public, extensions as $$
  select i.id, i.title, i.category, coalesce(c.color, '#64748b'), coalesce(c.icon, 'circle-help'), i.severity, i.status,
         ST_Y(i.location::geometry), ST_X(i.location::geometry),
         i.upvote_count, i.confirmation_count, i.validation_score, i.validation_threshold,
         i.created_at, m.storage_path, m.media_type
  from issues i
  left join categories c on c.slug = i.category
  left join lateral (
    select storage_path, media_type from issue_media
     where issue_id = i.id and kind = 'report' order by created_at limit 1
  ) m on true
  where ST_Intersects(i.location, ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography)
    and (p_category is null or i.category = p_category)
    and (
      ('unverified' = any(p_layers) and i.status = 'community_review')
      or ('active' = any(p_layers) and i.status in ('validated', 'escalated', 'under_review', 'assigned', 'in_progress', 'resolution_submitted'))
      or ('resolved' = any(p_layers) and i.status = 'closed')
    )
  order by i.created_at desc
  limit 2000
$$;

create or replace function heatmap_hex(
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision,
  p_cell_m int default 250,
  p_category text default null
) returns table (hex jsonb, weight numeric, issue_count int, top_category text)
language sql stable security definer set search_path = public, extensions as $$
  with params as (
    select greatest(p_cell_m, 25)
           / greatest(cos(radians((p_min_lat + p_max_lat) / 2)), 0.1) as size_3857
  ),
  pts as (
    select ST_Transform(i.location::geometry, 3857) as g,
           issue_heat_weight(i.severity, i.confirmation_count, i.upvote_count,
                             coalesce(i.validated_at, i.created_at)) as w,
           i.category
    from issues i
    where i.status in ('validated', 'escalated', 'under_review', 'assigned', 'in_progress', 'resolution_submitted')
      and (p_category is null or i.category = p_category)
      and ST_Intersects(i.location, ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography)
  ),
  snapped as (
    select h.i, h.j, h.geom, pts.w, pts.category
    from pts, params
    cross join lateral (
      select hg.i, hg.j, hg.geom
        from ST_HexagonGrid(params.size_3857, pts.g) hg
       where ST_Intersects(hg.geom, pts.g)
       order by hg.i, hg.j
       limit 1
    ) h
  )
  select ST_AsGeoJSON(ST_Transform(geom, 4326), 6)::jsonb,
         round(sum(w), 2), count(*)::int,
         mode() within group (order by category)
  from snapped
  group by i, j, geom
$$;

create or replace function heatmap_points(
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision,
  p_category text default null
) returns table (lat double precision, lng double precision, weight numeric)
language sql stable security definer set search_path = public, extensions as $$
  select ST_Y(i.location::geometry), ST_X(i.location::geometry),
         issue_heat_weight(i.severity, i.confirmation_count, i.upvote_count, coalesce(i.validated_at, i.created_at))
  from issues i
  where i.status in ('validated', 'escalated', 'under_review', 'assigned', 'in_progress', 'resolution_submitted')
    and (p_category is null or i.category = p_category)
    and ST_Intersects(i.location, ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography)
$$;

create or replace function platform_stats() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'reported',   (select count(*) from issues where status not in ('hidden', 'expired')),
    'validated',  (select count(*) from issues where status in ('validated', 'escalated', 'under_review', 'assigned', 'in_progress', 'resolution_submitted')),
    'in_progress',(select count(*) from issues where status in ('assigned', 'in_progress', 'resolution_submitted')),
    'resolved',   (select count(*) from issues where status = 'closed'),
    'volunteers', (select count(*) from profiles where is_volunteer),
    'escalated',  (select count(*) from issues where route = 'authority' and status in ('escalated', 'assigned', 'in_progress', 'resolution_submitted'))
  )
$$;

-- Storage: emergency photos are evidence too.
create or replace function media_in_use(p_path text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from issue_media where storage_path = p_path)
      or exists (select 1 from emergency_alerts where media @> jsonb_build_array(jsonb_build_object('path', p_path)))
$$;

-- ---------- Emergency alerts (read) ---------------------------------
-- The reporter's name is never shown publicly.
create or replace function get_active_alerts(
  p_lat double precision default null, p_lng double precision default null, p_radius_m int default 25000
) returns table (
  id uuid, kind emergency_kind, note text, lat double precision, lng double precision, address text,
  media jsonb, status text, confirm_count int, deny_count int, over_count int,
  created_at timestamptz, expires_at timestamptz, distance_m double precision, is_mine boolean, my_response text
)
language sql stable security definer set search_path = public, extensions as $$
  select e.id, e.kind, e.note, ST_Y(e.location::geometry), ST_X(e.location::geometry), e.address,
         e.media, e.status, e.confirm_count, e.deny_count, e.over_count, e.created_at, e.expires_at,
         case when p_lat is null then null else ST_Distance(e.location, make_point(p_lat, p_lng)) end,
         coalesce(e.reporter_id = auth.uid(), false),
         (select r.response from emergency_responses r where r.alert_id = e.id and r.user_id = auth.uid())
    from emergency_alerts e
   where e.status = 'active'
     and (p_lat is null or ST_DWithin(e.location, make_point(p_lat, p_lng), p_radius_m))
   order by e.created_at desc
   limit 50
$$;

create or replace function get_alert(p_alert uuid)
returns table (
  id uuid, kind emergency_kind, note text, lat double precision, lng double precision, address text,
  media jsonb, status text, confirm_count int, deny_count int, over_count int,
  created_at timestamptz, expires_at timestamptz, ended_at timestamptz, is_mine boolean, my_response text,
  emergency_contacts jsonb, authority_short_name text
)
language sql stable security definer set search_path = public, extensions as $$
  select e.id, e.kind, e.note, ST_Y(e.location::geometry), ST_X(e.location::geometry), e.address,
         case when e.status = 'hidden' and e.reporter_id is distinct from auth.uid() then '[]'::jsonb else e.media end,
         e.status, e.confirm_count, e.deny_count, e.over_count, e.created_at, e.expires_at, e.ended_at,
         coalesce(e.reporter_id = auth.uid(), false),
         (select r.response from emergency_responses r where r.alert_id = e.id and r.user_id = auth.uid()),
         coalesce(a.emergency_contacts, '[]'::jsonb), a.short_name
    from emergency_alerts e
    left join authorities a on a.id = find_authority(e.location)
   where e.id = p_alert
$$;

-- Local emergency numbers for a spot (shown with 999 before reporting).
create or replace function emergency_contacts_at(p_lat double precision, p_lng double precision)
returns table (authority_short_name text, emergency_contacts jsonb)
language sql stable security definer set search_path = public, extensions as $$
  select a.short_name, a.emergency_contacts from authorities a where a.id = find_authority(make_point(p_lat, p_lng))
$$;

-- ---------- Admin reads ---------------------------------------------

create or replace function get_review_queue()
returns table (
  id bigint, kind review_kind, note text, data jsonb, created_at timestamptz,
  requester_username text, requester_full_name text, issue jsonb, evidence jsonb
)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform require_admin();
  return query
  select r.id, r.kind, r.note, r.data, r.created_at, p.username, p.full_name, to_jsonb(v),
         coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'media_type', m.media_type, 'path', m.storage_path))
                     from issue_media m where m.event_id = (r.data ->> 'event')::bigint), '[]'::jsonb)
    from review_items r
    join issues_v v on v.id = r.issue_id
    left join profiles p on p.id = r.requested_by
   where r.status = 'open'
   order by r.created_at;
end $$;

create or replace function get_role_requests(p_status text default 'pending')
returns table (
  id bigint, user_id uuid, username text, full_name text, account_created_at timestamptz,
  authority_short_name text, designation text, office text, message text, status text,
  created_at timestamptz, decision_note text
)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform require_admin();
  return query
  select r.id, r.user_id, p.username, p.full_name, p.created_at, a.short_name, r.designation, r.office,
         r.message, r.status, r.created_at, r.decision_note
    from role_requests r join profiles p on p.id = r.user_id join authorities a on a.id = r.authority_id
   where r.status = p_status
   order by r.created_at desc
   limit 200;
end $$;

-- A user's own pending/last request (for the Settings page).
create or replace function get_my_role_request()
returns table (id bigint, authority_short_name text, designation text, status text, decision_note text, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select r.id, a.short_name, r.designation, r.status, r.decision_note, r.created_at
    from role_requests r join authorities a on a.id = r.authority_id
   where r.user_id = auth.uid()
   order by r.created_at desc limit 1
$$;

create or replace function get_admin_log(p_limit int default 100)
returns table (id bigint, admin_username text, action text, issue_id uuid, issue_title text,
               target_username text, reason text, data jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform require_admin();
  return query
  select l.id, a.username, l.action, l.issue_id, i.title, t.username, l.reason, l.data, l.created_at
    from admin_actions l
    left join profiles a on a.id = l.admin_id
    left join profiles t on t.id = l.target_user
    left join issues i on i.id = l.issue_id
   order by l.created_at desc
   limit least(greatest(p_limit, 1), 500);
end $$;

-- ---------- Lock everything down, then open what's needed -----------

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Public reference data (policies from 0003 still apply)
grant select on categories, app_settings, profiles to anon, authenticated;
grant select on notifications to authenticated;

-- Read views
grant select on issues_v, issue_media_v, issue_events_v, comments_v, ratings_v, leaderboard_v,
                roles_v, authorities_v, authority_record_v to anon, authenticated;
grant select on my_settings_v, notifications_v to authenticated;

-- Read functions (also for logged-out visitors). The first three are called
-- inside the views, which check function permissions as the viewer.
grant execute on function
  is_admin(uuid),
  official_authority(uuid),
  is_team_member(bigint, uuid),
  get_feed(text, text, text, double precision, double precision, int, text, int, int),
  get_issue(uuid),
  get_user_issues(text, int, int),
  get_open_tasks(double precision, double precision, int, text),
  get_open_teams(double precision, double precision, int),
  get_team(uuid),
  map_issues(double precision, double precision, double precision, double precision, text, text[]),
  heatmap_hex(double precision, double precision, double precision, double precision, int, text),
  heatmap_points(double precision, double precision, double precision, double precision, text),
  find_nearby_duplicates(double precision, double precision, text),
  platform_stats(),
  get_active_alerts(double precision, double precision, int),
  get_alert(uuid),
  emergency_contacts_at(double precision, double precision)
to anon, authenticated;

-- Functions for logged-in users (admin ones check the role themselves)
grant execute on function
  get_my_tasks(),
  get_authority_tasks(text),
  get_my_role_request(),
  create_issue(text, text, text, double precision, double precision, real, text, text, boolean, jsonb, boolean, text),
  update_issue(uuid, text, text, text, text),
  delete_issue(uuid),
  toggle_vote(uuid, double precision, double precision),
  confirm_issue(uuid, double precision, double precision, real, text, jsonb),
  flag_issue(uuid, flag_reason, text),
  unflag_issue(uuid),
  vote_severity(uuid, severity_level),
  toggle_follow(uuid),
  add_comment(uuid, text, uuid, boolean),
  edit_comment(uuid, text),
  delete_comment(uuid),
  flag_comment(uuid),
  set_volunteer_mode(boolean),
  accept_task(uuid, int),
  join_team(uuid),
  leave_team(uuid),
  check_in(uuid, double precision, double precision, real),
  offer_lead(uuid, uuid),
  accept_lead(uuid),
  post_progress(uuid, text, jsonb),
  release_task(uuid, text, text, jsonb, text),
  submit_resolution(uuid, text, double precision, double precision, real, jsonb),
  review_resolution(uuid, boolean, double precision, double precision),
  rate_volunteer(uuid, int, text),
  set_complaint_ref(uuid, text),
  request_send_back(uuid, text),
  request_official_role(uuid, text, text, text),
  create_emergency_alert(emergency_kind, text, double precision, double precision, text, jsonb),
  respond_emergency(uuid, text, double precision, double precision),
  update_my_settings(double precision, double precision, boolean, boolean),
  update_my_profile(text, text, text, text, text),
  mark_notifications_read(bigint[]),
  media_in_use(text),
  -- admin
  get_review_queue(),
  get_role_requests(text),
  get_admin_log(int),
  admin_set_route(uuid, issue_route, text, text),
  admin_decide_escalation(uuid, boolean, text),
  admin_decide_wrong_report(uuid, text, text),
  admin_dismiss_review(bigint, text),
  admin_remove_assignee(uuid, text),
  admin_request_help(uuid),
  admin_invite_volunteer(uuid, text),
  admin_decide_role_request(bigint, boolean, text),
  admin_grant_admin(text, text),
  admin_revoke_role(text, app_role, text),
  admin_save_authority(uuid, text, text, jsonb, text, text, jsonb, int, int, int, int, boolean),
  admin_save_category(text, text, text, text, text, resolver_type, severity_level, int, boolean),
  admin_update_settings(jsonb)
to authenticated;
