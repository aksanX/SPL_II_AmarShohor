-- =====================================================================
-- AmarShohor — 30. The issues behind one hexagon, from the server
--
-- Clicking a hexagon listed its issues by loading every issue in the
-- hexagon's bounding box into the browser. A zoomed-out hexagon over Dhaka
-- holds 1,000+ issues: slow, and past 2,000 rows map_issues stops, so the
-- most serious ones could be missing. hex_issues returns only the top
-- issues (most serious first) plus the exact total.
--
-- Exactness: each issue is placed with hex_of(), the very rule heatmap_hex
-- uses, and compared with the clicked hexagon's grid position. (Testing
-- the point against the hexagon's GeoJSON shape is not exact: its
-- coordinates are rounded to ~10 cm.) So the total always equals the
-- number on the hexagon. Same status and category rules as heatmap_hex.
-- =====================================================================

set search_path = public, extensions;

create or replace function hex_issues(p_hex jsonb, p_cell_m int, p_category text default null, p_limit int default 20)
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

grant execute on function hex_issues(jsonb, int, text, int) to anon, authenticated;
