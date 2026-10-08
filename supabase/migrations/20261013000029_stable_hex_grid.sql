-- =====================================================================
-- AmarShohor — 29. Hexagons stay in place while the map moves
--
-- heatmap_hex sized its hexagons for the latitude in the middle of the
-- screen (to undo Web-Mercator stretch). The grid is anchored at the
-- projection origin, thousands of hexagons away, so even a tiny change in
-- that latitude moved the whole grid: panning 1 km north at the same zoom
-- gave a completely different set of hexagons, and issues jumped between
-- them. The stretch is now corrected for one fixed latitude, the middle of
-- the service area (Bangladesh, about 23.6°), so the grid never moves.
-- Hexagons are within 0.1% of their nominal size around Dhaka and within
-- about 2.5% at the far ends of the country.
-- Otherwise identical to 0023.
-- =====================================================================

set search_path = public, extensions;

-- Hexagon edge length in Web-Mercator units for a real-world edge of p_cell_m metres.
-- Shared by heatmap_hex and hex_issues, so both use exactly the same grid.
create or replace function hex_size_3857(p_cell_m int) returns double precision
language sql stable set search_path = public, extensions as $$
  select greatest(p_cell_m, 25) / greatest(cos(radians((s.min_lat + s.max_lat) / 2)), 0.1)
  from app_settings s where s.id = 1
$$;

-- The hexagon (grid indices i, j and shape) a point belongs to. A point exactly on an
-- edge goes to the first hexagon in (i, j) order, so it is counted once.
create or replace function hex_of(p_size double precision, p_point geometry)
returns table (i int, j int, geom geometry)
language sql immutable set search_path = public, extensions as $$
  select hg.i, hg.j, hg.geom
    from ST_HexagonGrid(p_size, p_point) hg
   where ST_Intersects(hg.geom, p_point)
   order by hg.i, hg.j
   limit 1
$$;

create or replace function heatmap_hex(
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision,
  p_cell_m int default 250,
  p_category text default null
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

revoke execute on function hex_size_3857(int), hex_of(double precision, geometry) from public, anon, authenticated;
