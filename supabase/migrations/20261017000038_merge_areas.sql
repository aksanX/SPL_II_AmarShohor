-- =====================================================================
-- AmarShohor — 38. A service area from thanas
--
-- The area drawer in Admin → City Corporations can build an area from Dhaka's
-- thana outlines (bundled with the web app, from geoBoundaries / BBS): the
-- super admin picks thanas and this joins them into one outline.
--
-- Neighbouring thanas' shared edges don't line up exactly in the source data,
-- so gaps of up to ~30 m are closed, holes are filled, and only the biggest
-- piece is kept. Returns that outline as a GeoJSON Polygon for the drawer,
-- which the admin then checks and saves as usual (admin_save_authority).
-- =====================================================================

set search_path = public, extensions;

-- p_areas: a JSON array of GeoJSON Polygons / MultiPolygons.
create or replace function merge_areas(p_areas jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_union geometry;
  v_main geometry;
begin
  perform require_admin();
  if jsonb_typeof(p_areas) is distinct from 'array' or jsonb_array_length(p_areas) not between 1 and 100 then
    raise exception 'Pick between 1 and 100 areas' using hint = 'BAD_AREA';
  end if;
  begin
    select ST_Union(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(a::text), 4326))) into v_union
      from jsonb_array_elements(p_areas) a;
  exception when others then
    raise exception 'One of the areas is not a valid map shape' using hint = 'BAD_AREA';
  end;
  -- Close the slivers between neighbours: grow by ~30 m, then shrink back.
  v_union := ST_Buffer(ST_Buffer(v_union, 0.0003), -0.0003);
  select d.geom into v_main from ST_Dump(v_union) d
   where GeometryType(d.geom) = 'POLYGON'
   order by ST_Area(d.geom) desc limit 1;
  if v_main is null then
    raise exception 'The picked areas don''t make a shape' using hint = 'BAD_AREA';
  end if;
  v_main := ST_SimplifyPreserveTopology(ST_MakePolygon(ST_ExteriorRing(v_main)), 0.0001);
  return ST_AsGeoJSON(v_main, 6)::jsonb;
end $$;

revoke execute on function merge_areas(jsonb) from public, anon, authenticated;
grant execute on function merge_areas(jsonb) to authenticated;
