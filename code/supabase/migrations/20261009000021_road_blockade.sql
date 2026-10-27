-- =====================================================================
-- AmarShohor — 0021: "Road Blockade" category
--
-- A road closed off by barricades, a protest, an event or dumped material,
-- under 1.3 Parking & Obstructions. City Corporation work and never on the
-- volunteer board: clearing a blockade can mean confronting people.
-- A blockade that stops ambulances or fire trucks is still
-- "Blocked Emergency Access Route" (critical).
-- =====================================================================

set search_path = public, extensions;

insert into categories (slug, name, name_bn, icon, color, resolver, default_severity, sort_order,
                        volunteer_allowed, duplicate_group, group_slug)
values ('road_blockade', 'Road Blockade', 'সড়ক অবরোধ', 'construction', '#b45309', 'authority', 'high', 11,
        false, null, 'roads_parking')
on conflict (slug) do nothing;
