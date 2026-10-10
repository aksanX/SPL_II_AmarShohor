-- =====================================================================
-- AmarShohor — 34. Time filter on the map: last 7 / 30 days
--
-- The map can now show only issues reported in the last N days. Every map
-- function gets one new optional input, p_days (null = all time, as before):
--   map_issues, heatmap_hex, heatmap_points, hex_issues, area_heat_summary.
-- All five use the same rule, so a hexagon's number, its list of issues and
-- the dropped pin's summary always agree with each other.
--
-- A new input changes a function's signature, and two versions of one name
-- would make calls without p_days ambiguous. So each old version is dropped,
-- the new one created, and its permission granted again.
-- Bodies are the newest versions (0013, 0029, 0027, 0030, 0013) plus the
-- one time condition. N is kept between 1 and 3650 days.
-- =====================================================================

set search_path = public, extensions;

-- Reported within the last p_days days? Null = no time limit.
create or replace function reported_within(p_created timestamptz, p_days int) returns boolean
language sql stable as $$
  select p_days is null or p_created >= now() - make_interval(days => least(greatest(p_days, 1), 3650))
$$;

drop function if exists map_issues(double precision, double precision, double precision, double precision, text, text[]);
drop function if exists heatmap_hex(double precision, double precision, double precision, double precision, int, text);
drop function if exists heatmap_points(double precision, double precision, double precision, double precision, text);
drop function if exists hex_issues(jsonb, int, text, int);
drop function if exists area_heat_summary(double precision, double precision, int, text);

-- ---------- pins ----------
create function map_issues(
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision,
  p_category text default null,
  p_layers text[] default array['active'],
  p_days int default null
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
    and reported_within(i.created_at, p_days)
    and (
      ('unverified' = any(p_layers) and i.status = 'community_review')
      or ('active' = any(p_layers) and i.status in ('validated', 'escalated', 'under_review', 'assigned', 'in_progress', 'resolution_submitted'))
      or ('resolved' = any(p_layers) and i.status = 'closed')
    )
  order by i.created_at desc
  limit 2000
$$;

-- ---------- hexagons ----------
create function heatmap_hex(
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision,
  p_cell_m int default 250,
  p_category text default null,
  p_days int default null
) returns table (hex jsonb, weight numeric, issue_count int, top_category text)
language sql stable security definer set search_path = public, extensions as $$
  with params as (
    select hex_size_3857(p_cell_m) as size_3857,
           -- one hexagon width (2 × edge) in degrees, a little extra for safety
           2.2 * greatest(p_cell_m, 25) / 111320.0 as margin_lat,
           2.2 * greatest(p_cell_m, 25) / (111320.0 * greatest(cos(radians((p_min_lat + p_max_lat) / 2)), 0.1)) as margin_lng,
           ST_Transform(ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326), 3857) as view_3857
  ),
  pts as (
    select ST_Transform(i.location::geometry, 3857) as g,
           issue_heat_weight(i.severity, i.confirmation_count, i.upvote_count,
                             coalesce(i.validated_at, i.created_at)) as w,
           -- the main group the map shows (ungrouped categories stand for themselves)
           coalesce(sg.parent_slug, sg.slug, i.category) as category
    from issues i
    cross join params
    left join categories c on c.slug = i.category
    left join category_groups sg on sg.slug = c.group_slug
    where i.status in ('validated', 'escalated', 'under_review', 'assigned', 'in_progress', 'resolution_submitted')
      and (p_category is null or i.category in (select categories_in(p_category)))
      and reported_within(i.created_at, p_days)
      and ST_Intersects(i.location, ST_MakeEnvelope(
            p_min_lng - params.margin_lng, p_min_lat - params.margin_lat,
            p_max_lng + params.margin_lng, p_max_lat + params.margin_lat, 4326)::geography)
  ),
  snapped as (
    select h.i, h.j, h.geom, pts.w, pts.category
    from pts, params
    cross join lateral hex_of(params.size_3857, pts.g) h
  )
  select ST_AsGeoJSON(ST_Transform(s.geom, 4326), 6)::jsonb,
         round(sum(s.w), 2), count(*)::int,
         mode() within group (order by s.category)
  from snapped s, params
  where ST_Intersects(s.geom, params.view_3857)
  group by s.i, s.j, s.geom
$$;

-- ---------- heat ----------
create function heatmap_points(
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision,
  p_category text default null,
  p_days int default null
) returns table (lat double precision, lng double precision, weight numeric, issue_count int)
language sql stable security definer set search_path = public, extensions as $$
  with pts as materialized (
    select ST_X(i.location::geometry) as x, ST_Y(i.location::geometry) as y,
           issue_heat_weight(i.severity, i.confirmation_count, i.upvote_count,
                             coalesce(i.validated_at, i.created_at))::float8 as w
    from issues i
    where i.status in ('validated', 'escalated', 'under_review', 'assigned', 'in_progress', 'resolution_submitted')
      and (p_category is null or i.category in (select categories_in(p_category)))
      and reported_within(i.created_at, p_days)
      and ST_Intersects(i.location, ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography)
  ),
  -- candidate cell sizes in degrees, from fine to coarse
  sizes as (
    select n, greatest(p_max_lng - p_min_lng, p_max_lat - p_min_lat, 1e-6) / n as s
    from unnest(array[512, 256, 128, 64, 32, 16]) n
  ),
  cell as (
    select coalesce(
      (select s.s from sizes s
        where (select count(distinct (floor(p.x / s.s), floor(p.y / s.s))) from pts p) <= 1000
        order by s.n desc limit 1),
      (select max(s) from sizes)) as s
  )
  -- one point per cell, at the heat-weighted centre of its issues
  select sum(p.y * p.w) / nullif(sum(p.w), 0),
         sum(p.x * p.w) / nullif(sum(p.w), 0),
         round(sum(p.w)::numeric, 3),
         count(*)::int
  from pts p, cell c
  group by floor(p.x / c.s), floor(p.y / c.s)
  having sum(p.w) > 0
$$;

-- ---------- the issues behind one hexagon ----------
create function hex_issues(p_hex jsonb, p_cell_m int, p_category text default null, p_limit int default 20, p_days int default null)
returns table (
  id uuid, title text, category text, category_color text, category_icon text,
  severity severity_level, status issue_status, lat double precision, lng double precision,
  upvote_count int, confirmation_count int, validation_score numeric, validation_threshold numeric,
  created_at timestamptz, thumb_path text, thumb_type media_type, total int
)
language sql stable security definer set search_path = public, extensions as $$
  with target as (
    select ST_SetSRID(ST_GeomFromGeoJSON(p_hex::text), 4326) as g4326, hex_size_3857(p_cell_m) as size
  ),
  cell as (  -- grid position of the clicked hexagon, from its centre (never near an edge)
    select h.i, h.j, t.g4326, t.size
    from target t cross join lateral hex_of(t.size, ST_Centroid(ST_Transform(t.g4326, 3857))) h
  ),
  inside as (
    select i.*
    from issues i, cell
    cross join lateral hex_of(cell.size, ST_Transform(i.location::geometry, 3857)) h
    -- candidates: the hexagon's box plus ~1 m, using the spatial index
    where i.location && ST_Expand(ST_Envelope(cell.g4326), 0.00001)::geography
      and h.i = cell.i and h.j = cell.j
      and i.status in ('validated', 'escalated', 'under_review', 'assigned', 'in_progress', 'resolution_submitted')
      and (p_category is null or i.category in (select categories_in(p_category)))
      and reported_within(i.created_at, p_days)
  )
  select i.id, i.title, i.category, coalesce(c.color, '#64748b'), coalesce(c.icon, 'circle-help'), i.severity, i.status,
         ST_Y(i.location::geometry), ST_X(i.location::geometry),
         i.upvote_count, i.confirmation_count, i.validation_score, i.validation_threshold,
         i.created_at, m.storage_path, m.media_type,
         (select count(*) from inside)::int
  from inside i
  left join categories c on c.slug = i.category
  left join lateral (
    select storage_path, media_type from issue_media
     where issue_id = i.id and kind = 'report' order by created_at limit 1
  ) m on true
  order by severity_weight(i.severity) desc, i.confirmation_count desc, i.upvote_count desc, i.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100)
$$;

-- ---------- the dropped pin's summary ----------
create function area_heat_summary(
  p_lat double precision, p_lng double precision,
  p_radius_m int default 1000,
  p_category text default null,
  p_days int default null
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
      and reported_within(i.created_at, p_days)
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

-- The browser may call the five map functions; the helper is only used inside them.
revoke execute on function reported_within(timestamptz, int) from public, anon, authenticated;
revoke execute on function
  map_issues(double precision, double precision, double precision, double precision, text, text[], int),
  heatmap_hex(double precision, double precision, double precision, double precision, int, text, int),
  heatmap_points(double precision, double precision, double precision, double precision, text, int),
  hex_issues(jsonb, int, text, int, int),
  area_heat_summary(double precision, double precision, int, text, int)
from public;
grant execute on function
  map_issues(double precision, double precision, double precision, double precision, text, text[], int),
  heatmap_hex(double precision, double precision, double precision, double precision, int, text, int),
  heatmap_points(double precision, double precision, double precision, double precision, text, int),
  hex_issues(jsonb, int, text, int, int),
  area_heat_summary(double precision, double precision, int, text, int)
to anon, authenticated;
