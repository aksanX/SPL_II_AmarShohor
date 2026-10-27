-- =====================================================================
-- AmarShohor — 0015: fixes for category groups
--
-- 1. heatmap_hex: "Mostly: …" on a hexagon now names the main group with the
--    most issues. Before, it took the most common detailed category and the
--    map showed that category's group, so 3 Roads issues of different kinds
--    could lose to 2 garbage reports and the hexagon said "Utilities".
--    top_category is now a main group slug (or the category slug for
--    categories outside any group).
-- 2. admin_save_category takes the subgroup (p_group_slug), so categories
--    the admin adds show up under the Reported issues filters.
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
    select greatest(p_cell_m, 25)
           / greatest(cos(radians((p_min_lat + p_max_lat) / 2)), 0.1) as size_3857
  ),
  pts as (
    select ST_Transform(i.location::geometry, 3857) as g,
           issue_heat_weight(i.severity, i.confirmation_count, i.upvote_count,
                             coalesce(i.validated_at, i.created_at)) as w,
           -- the main group the map shows (ungrouped categories stand for themselves)
           coalesce(sg.parent_slug, sg.slug, i.category) as category
    from issues i
    left join categories c on c.slug = i.category
    left join category_groups sg on sg.slug = c.group_slug
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

-- ---------- Admin: category form with a subgroup ---------------------
drop function if exists admin_save_category(text, text, text, text, text, resolver_type, severity_level, int, boolean, boolean, text);
create function admin_save_category(
  p_slug text, p_name text, p_name_bn text, p_icon text, p_color text,
  p_resolver resolver_type, p_default_severity severity_level, p_sort_order int, p_is_active boolean,
  p_volunteer_allowed boolean default true, p_duplicate_group text default null,
  p_group_slug text default null
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_slug text := coalesce(nullif(p_slug, ''), slugify(p_name));
  v_group text := nullif(slugify(p_duplicate_group), '');
  v_sub text := nullif(p_group_slug, '');
begin
  if char_length(coalesce(trim(p_name), '')) < 2 then
    raise exception 'Give the category a name' using hint = 'BAD_CATEGORY';
  end if;
  if v_slug = '' then v_slug := 'category_' || floor(random() * 100000)::int; end if;
  if p_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'Colour must look like #1a2b3c' using hint = 'BAD_COLOR';
  end if;
  if not coalesce(p_volunteer_allowed, true) and p_resolver = 'community' then
    raise exception 'A category that is too dangerous for volunteers must be fixed by the City Corporation'
      using hint = 'UNSAFE_FOR_VOLUNTEERS';
  end if;
  -- Categories sit in a subgroup (e.g. "1.1 Road & Sidewalk Conditions"), not directly in a main group.
  if v_sub is not null and not exists (select 1 from category_groups where slug = v_sub and parent_slug is not null) then
    raise exception 'Pick a subcategory group such as "1.1 Road & Sidewalk Conditions"' using hint = 'BAD_GROUP';
  end if;
  insert into categories (slug, name, name_bn, icon, color, resolver, default_severity, sort_order, is_active,
                          volunteer_allowed, duplicate_group, group_slug)
  values (v_slug, trim(p_name), coalesce(trim(p_name_bn), ''), coalesce(nullif(p_icon, ''), 'circle-help'), p_color,
          p_resolver, p_default_severity, coalesce(p_sort_order, 0), coalesce(p_is_active, true),
          coalesce(p_volunteer_allowed, true), v_group, v_sub)
  on conflict (slug) do update
    set name = excluded.name, name_bn = excluded.name_bn, icon = excluded.icon, color = excluded.color,
        resolver = excluded.resolver, default_severity = excluded.default_severity,
        sort_order = excluded.sort_order, is_active = excluded.is_active,
        volunteer_allowed = excluded.volunteer_allowed, duplicate_group = excluded.duplicate_group,
        group_slug = excluded.group_slug;
  perform log_admin(v_admin, 'save_category', null, null, 'Updated category',
    jsonb_build_object('slug', v_slug, 'volunteer_allowed', coalesce(p_volunteer_allowed, true),
                       'duplicate_group', v_group, 'group', v_sub));
  return v_slug;
end $$;

revoke execute on function admin_save_category(text, text, text, text, text, resolver_type, severity_level, int, boolean, boolean, text, text) from public, anon;
grant execute on function admin_save_category(text, text, text, text, text, resolver_type, severity_level, int, boolean, boolean, text, text) to authenticated;
