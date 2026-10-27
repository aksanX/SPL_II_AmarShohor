-- =====================================================================
-- AmarShohor — 23. Complete hexagons at the edge of the map
--
-- heatmap_hex only counted issues inside the requested area, but a
-- hexagon on the edge of that area also covers ground outside it. Those
-- edge hexagons were undercounted (drawn paler than they should be), and
-- their count didn't match the list of issues shown when one is clicked.
--
-- Fix: collect issues from the area plus a margin of one hexagon width,
-- then return only hexagons that touch the requested area. Every hexagon
-- returned is now complete. Otherwise identical to 0015.
-- =====================================================================

set search_path = public, extensions;

create or replace function heatmap_hex(
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision,
  p_cell_m int default 250,
  p_category text default null
) returns table (hex jsonb, weight numeric, issue_count int, top_category text)
language sql stable security definer set search_path = public, extensions as $$
  with params as (
    select greatest(p_cell_m, 25) / greatest(cos(radians((p_min_lat + p_max_lat) / 2)), 0.1) as size_3857,
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
    cross join lateral (
      select hg.i, hg.j, hg.geom
        from ST_HexagonGrid(params.size_3857, pts.g) hg
       where ST_Intersects(hg.geom, pts.g)
       order by hg.i, hg.j
       limit 1
    ) h
  )
  select ST_AsGeoJSON(ST_Transform(s.geom, 4326), 6)::jsonb,
         round(sum(s.w), 2), count(*)::int,
         mode() within group (order by s.category)
  from snapped s, params
  where ST_Intersects(s.geom, params.view_3857)
  group by s.i, s.j, s.geom
$$;
