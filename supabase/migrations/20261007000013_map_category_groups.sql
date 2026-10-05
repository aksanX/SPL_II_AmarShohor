-- =====================================================================
-- AmarShohor — 0013: filter the map by main category group
--
-- The map's category filter now offers the main groups from 0012 (Roads,
-- Utilities, ...). map_issues, heatmap_hex, heatmap_points and
-- area_heat_summary keep their parameters: p_category may now be a
-- category, a subgroup or a main group. Old links such as
-- /map?category=pothole keep working.
-- Bodies are the 0010 versions with only the category condition changed.
-- =====================================================================

set search_path = public, extensions;

-- The category slugs a filter covers: the category itself, or every
-- category in the group / subgroup with that slug.
create or replace function categories_in(p_filter text) returns setof text
language sql stable set search_path = public, extensions as $$
  select p_filter
  union
  select c.slug
    from categories c
    join category_groups s on s.slug = c.group_slug
   where s.slug = p_filter or s.parent_slug = p_filter
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
    and (p_category is null or i.category in (select categories_in(p_category)))
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
      and (p_category is null or i.category in (select categories_in(p_category)))
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
    and (p_category is null or i.category in (select categories_in(p_category)))
    and ST_Intersects(i.location, ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography)
$$;

create or replace function area_heat_summary(
  p_lat double precision, p_lng double precision,
  p_radius_m int default 1000,
  p_category text default null
) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with r as (
    select least(greatest(coalesce(p_radius_m, 1000), 100), 10000) as m  -- 100 m … 10 km
  ),
  near as (
    select i.id, i.title, i.category, i.status,
           ST_Distance(i.location, make_point(p_lat, p_lng)) as dist,
           case when i.status in ('validated', 'escalated', 'under_review', 'assigned', 'in_progress', 'resolution_submitted')
                then issue_heat_weight(i.severity, i.confirmation_count, i.upvote_count,
                                       coalesce(i.validated_at, i.created_at))
                else 0 end as w
    from issues i, r
    where ST_DWithin(i.location, make_point(p_lat, p_lng), r.m)
      and (p_category is null or i.category in (select categories_in(p_category)))
      and i.status not in ('hidden', 'expired')
  ),
  active as (
    select * from near where status in ('validated', 'escalated', 'under_review', 'assigned', 'in_progress', 'resolution_submitted')
  )
  select jsonb_build_object(
    'radius_m',     (select m from r),
    'active',       (select count(*) from active),
    'unverified',   (select count(*) from near where status = 'community_review'),
    'resolved',     (select count(*) from near where status = 'closed'),
    'heat',         coalesce((select round(sum(w), 2) from active), 0),
    'heat_per_km2', coalesce((select round(sum(w) / (pi() * r.m * r.m / 1e6)::numeric, 2) from active, r group by r.m), 0),
    'categories',   coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'count', n, 'heat', h) order by h desc)
      from (select category, count(*) as n, round(sum(w), 2) as h from active group by category) c
    ), '[]'::jsonb),
    'hottest',      coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', id, 'title', title, 'category', category, 'status', status,
               'heat', round(w, 2), 'distance_m', round(dist::numeric)) order by w desc)
      from (select * from active order by w desc limit 5) t
    ), '[]'::jsonb)
  )
$$;

-- Only used inside the functions above (which run as their owner).
revoke execute on function categories_in(text) from public, anon, authenticated;
