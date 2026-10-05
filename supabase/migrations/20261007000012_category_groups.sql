-- =====================================================================
-- AmarShohor — 0012: category groups
--
-- Categories get two levels above them:
--   group (e.g. "1. Roads, Mobility & Transportation")
--     → subgroup (e.g. "1.1 Road & Sidewalk Conditions")
--       → category (e.g. "Pothole / Road Damage"), which is what an issue has.
-- The feed filters by any set of categories (get_feed p_categories); the app
-- turns the groups and subgroups a citizen picks into that set.
--
-- Old categories keep their slugs, so existing issues and rules still work.
-- The ones that don't fit the new list are made inactive but still get a
-- subgroup, so their old issues show up under the right filter.
-- =====================================================================

set search_path = public, extensions;

create table category_groups (
  slug        text primary key check (slug ~ '^[a-z0-9_]{2,40}$'),
  parent_slug text references category_groups(slug) on delete cascade,  -- null = top-level group
  code        text not null,                -- "1", "1.1"
  name        text not null check (char_length(name) between 2 and 80),
  name_bn     text not null default '',
  description text not null default '' check (char_length(description) <= 200),
  icon        text not null default 'circle-help',
  color       text not null default '#64748b',
  sort_order  int  not null default 0
);
create index category_groups_parent_idx on category_groups (parent_slug);

-- The subgroup a category belongs to (null = ungrouped, e.g. "Other").
alter table categories add column group_slug text references category_groups(slug) on delete set null;
create index categories_group_idx on categories (group_slug);

alter table category_groups enable row level security;
create policy "category groups are public" on category_groups for select using (true);
grant select on category_groups to anon, authenticated;

-- ---------- Groups and subgroups ------------------------------------
insert into category_groups (slug, parent_slug, code, name, name_bn, description, icon, color, sort_order) values
  ('roads',       null, '1', 'Roads, Mobility & Transportation', 'সড়ক, চলাচল ও পরিবহন',
   'Daily commutes, pedestrian safety and traffic.',                       'traffic-cone',   '#b45309', 1),
  ('utilities',   null, '2', 'Utilities & Public Works',         'ইউটিলিটি ও গণপূর্ত',
   'Broken infrastructure that disrupts daily services.',                  'droplets',       '#0369a1', 2),
  ('environment', null, '3', 'Environment, Parks & Pollution',   'পরিবেশ, পার্ক ও দূষণ',
   'Ecological hazards and problems in public green spaces.',              'tree-pine',      '#15803d', 3),
  ('housing',     null, '4', 'Housing & Built Environment',      'আবাসন ও নির্মিত পরিবেশ',
   'Structural safety, decaying property and land use.',                   'building-2',     '#7c3aed', 4),
  ('safety',      null, '5', 'Public Safety & Health Hazards',   'জননিরাপত্তা ও স্বাস্থ্য ঝুঁকি',
   'Urgent risks to the safety and well-being of citizens.',               'triangle-alert', '#dc2626', 5),

  ('roads_surface',        'roads',       '1.1', 'Road & Sidewalk Conditions', 'রাস্তা ও ফুটপাতের অবস্থা',  '', 'construction',   '#b45309', 1),
  ('roads_traffic',        'roads',       '1.2', 'Traffic & Transit Control',  'ট্রাফিক ও গণপরিবহন নিয়ন্ত্রণ', '', 'traffic-cone', '#b45309', 2),
  ('roads_parking',        'roads',       '1.3', 'Parking & Obstructions',     'পার্কিং ও প্রতিবন্ধকতা',      '', 'car',            '#b45309', 3),
  ('utilities_water',      'utilities',   '2.1', 'Water & Drainage',           'পানি ও নিষ্কাশন',             '', 'droplets',       '#0369a1', 1),
  ('utilities_power',      'utilities',   '2.2', 'Power & Lighting',           'বিদ্যুৎ ও আলো',               '', 'zap',            '#0369a1', 2),
  ('utilities_waste',      'utilities',   '2.3', 'Waste Management',           'বর্জ্য ব্যবস্থাপনা',           '', 'trash-2',        '#0369a1', 3),
  ('environment_green',    'environment', '3.1', 'Public Spaces & Greenery',   'উন্মুক্ত স্থান ও সবুজায়ন',      '', 'trees',          '#15803d', 1),
  ('environment_nuisance', 'environment', '3.2', 'Environmental Nuisances',    'পরিবেশগত উপদ্রব',            '', 'wind',           '#15803d', 2),
  ('housing_structural',   'housing',     '4.1', 'Structural Risks',           'কাঠামোগত ঝুঁকি',              '', 'building-2',     '#7c3aed', 1),
  ('housing_visual',       'housing',     '4.2', 'Visual & Public Nuisances',  'দৃশ্যমান ও জনউপদ্রব',          '', 'spray-can',      '#7c3aed', 2),
  ('safety_immediate',     'safety',      '5.1', 'Immediate Hazards',          'তাৎক্ষণিক ঝুঁকি',             '', 'triangle-alert', '#dc2626', 1),
  ('safety_social',        'safety',      '5.2', 'Social Safety Concerns',     'সামাজিক নিরাপত্তা উদ্বেগ',     '', 'shield-alert',   '#dc2626', 2)
on conflict (slug) do nothing;

-- ---------- New categories ------------------------------------------
-- volunteer_allowed = false: too dangerous for volunteers, always an authority job.
insert into categories (slug, name, name_bn, icon, color, resolver, default_severity, sort_order,
                        volunteer_allowed, duplicate_group, group_slug) values
  -- 1.1 Road & Sidewalk Conditions (pothole already exists)
  ('broken_sidewalk',          'Broken / Blocked Sidewalk',            'ভাঙা / বন্ধ ফুটপাত',                  'footprints',     '#b45309', 'authority', 'medium',   2,  true,  null,    'roads_surface'),
  ('faded_crosswalk',          'Missing / Faded Crosswalk',            'জেব্রা ক্রসিং নেই / মুছে গেছে',         'footprints',     '#b45309', 'authority', 'medium',   3,  true,  null,    'roads_surface'),
  ('damaged_guardrail',        'Damaged Guardrail / Median',           'ক্ষতিগ্রস্ত রেলিং / সড়ক বিভাজক',         'fence',          '#b45309', 'authority', 'high',     4,  true,  null,    'roads_surface'),
  -- 1.2 Traffic & Transit Control
  ('broken_traffic_light',     'Broken Traffic Light',                 'নষ্ট ট্রাফিক সিগন্যাল',                 'traffic-cone',   '#b45309', 'authority', 'high',     5,  true,  null,    'roads_traffic'),
  ('missing_street_sign',      'Missing / Obscured Street Sign',       'রাস্তার সাইন নেই / ঢাকা পড়েছে',         'signpost',       '#b45309', 'authority', 'low',      6,  true,  null,    'roads_traffic'),
  ('blocked_bike_lane',        'Blocked Bike Lane',                    'সাইকেল লেন বন্ধ',                     'bike',           '#b45309', 'authority', 'low',      7,  true,  null,    'roads_traffic'),
  ('damaged_bus_stop',         'Damaged Bus Stop / Transit Shelter',   'ক্ষতিগ্রস্ত বাস স্টপ / যাত্রী ছাউনি',       'bus',            '#b45309', 'authority', 'medium',   8,  true,  null,    'roads_traffic'),
  -- 1.3 Parking & Obstructions
  ('abandoned_vehicle',        'Illegal / Abandoned Vehicle',          'অবৈধ / পরিত্যক্ত যানবাহন',              'car',            '#b45309', 'authority', 'low',      9,  true,  null,    'roads_parking'),
  ('construction_obstruction', 'Construction Site Obstruction',        'নির্মাণস্থলের প্রতিবন্ধকতা',              'hard-hat',       '#b45309', 'authority', 'medium',   10, true,  null,    'roads_parking'),
  ('double_parking',           'Double Parking Bottleneck',            'ডাবল পার্কিংয়ে যানজট',                  'car',            '#b45309', 'authority', 'low',      11, true,  null,    'roads_parking'),
  -- 2.1 Water & Drainage (drainage already exists)
  ('water_main_leak',          'Water Main Leak / Burst Pipe',         'পানির লাইন ফেটে যাওয়া / লিক',             'droplet',        '#0369a1', 'authority', 'high',     12, true,  null,    'utilities_water'),
  ('open_manhole',             'Open / Missing Manhole Cover',         'খোলা / ঢাকনাবিহীন ম্যানহোল',             'triangle-alert', '#0369a1', 'authority', 'critical', 14, false, null,    'utilities_water'),
  ('sewage_overflow',          'Sewage Overflow',                      'পয়ঃনিষ্কাশন উপচে পড়া',                  'waves',          '#0369a1', 'authority', 'high',     15, true,  'water', 'utilities_water'),
  -- 2.2 Power & Lighting (streetlight already exists)
  ('downed_power_line',        'Downed Power Lines',                   'ছিঁড়ে পড়া বিদ্যুতের তার',                 'zap',            '#0369a1', 'authority', 'critical', 17, false, 'power', 'utilities_power'),
  ('exposed_wiring',           'Exposed Electrical Wiring',            'খোলা বৈদ্যুতিক তার',                    'cable',          '#0369a1', 'authority', 'critical', 18, false, 'power', 'utilities_power'),
  -- 2.3 Waste Management (illegal_dumping, garbage already exist)
  ('uncollected_waste',        'Uncollected Municipal Waste',          'অসংগৃহীত পৌর বর্জ্য',                   'trash-2',        '#0369a1', 'authority', 'medium',   21, true,  'waste', 'utilities_waste'),
  -- 3.1 Public Spaces & Greenery
  ('overgrown_trees',          'Overgrown Trees / Blocked Visibility', 'অতিবৃদ্ধ গাছ / দৃষ্টি বাধাগ্রস্ত',           'trees',          '#15803d', 'community', 'low',      22, true,  null,    'environment_green'),
  ('fallen_tree',              'Fallen Tree / Large Debris',           'উপড়ে পড়া গাছ / বড় ধ্বংসাবশেষ',            'tree-pine',      '#15803d', 'authority', 'high',     23, true,  null,    'environment_green'),
  ('vandalized_park',          'Vandalized Park Equipment',            'ভাঙচুর হওয়া পার্কের সরঞ্জাম',              'trees',          '#15803d', 'authority', 'low',      24, true,  null,    'environment_green'),
  -- 3.2 Environmental Nuisances (dengue_breeding already exists)
  ('air_pollution',            'Excessive Industrial Smoke / Air Pollution', 'অতিরিক্ত কারখানার ধোঁয়া / বায়ুদূষণ',   'factory',        '#15803d', 'authority', 'high',     25, true,  null,    'environment_nuisance'),
  ('noise_pollution',          'Severe Noise Pollution',               'তীব্র শব্দদূষণ',                        'volume-2',       '#15803d', 'authority', 'medium',   26, true,  null,    'environment_nuisance'),
  ('chemical_spill',           'Chemical / Oil Spill',                 'রাসায়নিক / তেল ছড়িয়ে পড়া',                'biohazard',      '#15803d', 'authority', 'critical', 28, false, null,    'environment_nuisance'),
  -- 4.1 Structural Risks
  ('unsafe_structure',         'Unsafe / Collapsing Structure',        'ঝুঁকিপূর্ণ / ধসে পড়া ভবন',                'building-2',     '#7c3aed', 'authority', 'critical', 29, false, null,    'housing_structural'),
  ('abandoned_property',       'Abandoned / Blighted Property',        'পরিত্যক্ত / জরাজীর্ণ সম্পত্তি',             'house',          '#7c3aed', 'authority', 'low',      30, true,  null,    'housing_structural'),
  ('construction_violation',   'Construction Safety Violation',        'নির্মাণ নিরাপত্তা লঙ্ঘন',                 'hard-hat',       '#7c3aed', 'authority', 'high',     31, false, null,    'housing_structural'),
  -- 4.2 Visual & Public Nuisances
  ('graffiti',                 'Graffiti / Property Vandalism',        'দেয়াললিখন / সম্পত্তি ভাঙচুর',              'spray-can',      '#7c3aed', 'community', 'low',      32, true,  null,    'housing_visual'),
  ('encroachment',             'Excessive Encroachment on Public Land','সরকারি জায়গা অবৈধ দখল',                 'fence',          '#7c3aed', 'authority', 'medium',   33, true,  null,    'housing_visual'),
  ('informal_setup',           'Unsanctioned / Hazardous Informal Setups', 'অননুমোদিত / ঝুঁকিপূর্ণ অস্থায়ী স্থাপনা',  'store',          '#7c3aed', 'authority', 'medium',   34, true,  null,    'housing_visual'),
  -- 5.1 Immediate Hazards
  ('fire_hazard',              'Fire Hazard / Dry Brush Accumulation', 'আগুনের ঝুঁকি / শুকনো ঝোপঝাড়',             'flame',          '#dc2626', 'authority', 'high',     35, true,  null,    'safety_immediate'),
  ('stray_animals',            'Aggressive / Stray Animal Pack',       'হিংস্র / বেওয়ারিশ পশুর দল',                'dog',            '#dc2626', 'authority', 'high',     36, false, null,    'safety_immediate'),
  ('blocked_emergency_access', 'Blocked Emergency Access Route',       'জরুরি চলাচলের পথ বন্ধ',                 'siren',          '#dc2626', 'authority', 'critical', 37, true,  null,    'safety_immediate'),
  -- 5.2 Social Safety Concerns
  ('active_vandalism',         'Active Vandalism in Progress',         'চলমান ভাঙচুর',                         'shield-alert',   '#dc2626', 'authority', 'critical', 38, false, null,    'safety_social'),
  ('unlit_passageway',         'Unlit / High-Risk Pedestrian Passageway', 'অন্ধকার / ঝুঁকিপূর্ণ পথচারী পথ',         'lamp',           '#dc2626', 'authority', 'high',     39, true,  'dark',  'safety_social')
on conflict (slug) do nothing;

-- ---------- Existing categories: new names and places ---------------
update categories set group_slug = 'roads_surface',        sort_order = 1,  color = '#b45309' where slug = 'pothole';
update categories set group_slug = 'utilities_water',      sort_order = 13, color = '#0369a1',
       name = 'Clogged Storm Drain / Street Flooding', name_bn = 'ড্রেন বন্ধ / রাস্তায় জলাবদ্ধতা'  where slug = 'drainage';
update categories set group_slug = 'utilities_power',      sort_order = 16, color = '#0369a1', duplicate_group = 'dark',
       name = 'Broken Streetlight / Dark Area', name_bn = 'নষ্ট স্ট্রিটলাইট / অন্ধকার এলাকা'        where slug = 'streetlight';
update categories set group_slug = 'utilities_waste',      sort_order = 19, color = '#0369a1',
       name = 'Illegal Dumping / Fly-Tipping'                                                     where slug = 'illegal_dumping';
update categories set group_slug = 'utilities_waste',      sort_order = 20, color = '#0369a1',
       name = 'Overflowing Public Trash Can', name_bn = 'উপচে পড়া ডাস্টবিন'                         where slug = 'garbage';
update categories set group_slug = 'environment_nuisance', sort_order = 27, color = '#15803d',
       name = 'Stagnant Water / Mosquito Breeding Site', name_bn = 'জমে থাকা পানি / মশার প্রজননস্থল'  where slug = 'dengue_breeding';
update categories set sort_order = 99, group_slug = null                                          where slug = 'other';

-- Folded into the new list: no longer offered, but old issues keep them.
update categories set is_active = false, group_slug = 'utilities_water',    sort_order = 90 where slug = 'waterlogging';
update categories set is_active = false, group_slug = 'housing_structural', sort_order = 91 where slug = 'infrastructure';
update categories set is_active = false, group_slug = 'safety_immediate',   sort_order = 92 where slug = 'safety_hazard';

-- ---------- Feed: filter by several categories ----------------------
-- p_categories: issues in any of these categories (null = no filter).
-- p_category is kept for old links such as /feed?category=pothole.
drop function if exists get_feed(text, text, text, double precision, double precision, int, text, int, int);
create function get_feed(
  p_sort text default 'hot',
  p_scope text default 'all',
  p_category text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_m int default 5000,
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0,
  p_categories text[] default null
) returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select v.*
  from issues_v v
  where (p_category is null or v.category = p_category)
    and (p_categories is null or v.category = any(p_categories))
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

revoke execute on function get_feed(text, text, text, double precision, double precision, int, text, int, int, text[]) from public;
grant execute on function get_feed(text, text, text, double precision, double precision, int, text, int, int, text[]) to anon, authenticated;
