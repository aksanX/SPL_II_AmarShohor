-- =====================================================================
-- AmarShohor — 0014: heatmap points never hit the API row limit
--
-- The API returns at most 1000 rows per call (Supabase "Max rows"), so with
-- more than 1000 open issues in view the Heat mode silently dropped the rest.
-- heatmap_points now merges nearby issues into one weighted point per grid
-- cell. It uses the finest grid (up to 512 cells across the view) that still
-- gives at most 1000 points, so close up every issue is still its own point
-- and zoomed out the total heat is kept, just in fewer, heavier points.
-- Same parameters and result columns as before.
-- =====================================================================

set search_path = public, extensions;

create or replace function heatmap_points(
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision,
  p_category text default null
) returns table (lat double precision, lng double precision, weight numeric)
language sql stable security definer set search_path = public, extensions as $$
  with pts as materialized (
    select ST_X(i.location::geometry) as x, ST_Y(i.location::geometry) as y,
           issue_heat_weight(i.severity, i.confirmation_count, i.upvote_count,
                             coalesce(i.validated_at, i.created_at))::float8 as w
    from issues i
    where i.status in ('validated', 'escalated', 'under_review', 'assigned', 'in_progress', 'resolution_submitted')
      and (p_category is null or i.category in (select categories_in(p_category)))
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
         round(sum(p.w)::numeric, 3)
  from pts p, cell c
  group by floor(p.x / c.s), floor(p.y / c.s)
  having sum(p.w) > 0
$$;
