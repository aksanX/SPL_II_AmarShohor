-- =====================================================================
-- AmarShohor — demo data for DEVELOPMENT ONLY
-- The real system starts empty: the admin creates categories and City
-- Corporations from the admin panel. Run this on your own test database to
-- skip that setup. Safe to run more than once.
-- =====================================================================

set search_path = public, extensions;

insert into categories (slug, name, name_bn, icon, color, resolver, default_severity, sort_order) values
  ('pothole',            'Pothole / Road Damage',  'রাস্তার গর্ত',        'construction',   '#b45309', 'authority', 'high',     1),
  ('waterlogging',       'Waterlogging',           'জলাবদ্ধতা',          'waves',          '#0369a1', 'authority', 'high',     2),
  ('drainage',           'Drainage Blockage',      'ড্রেন বন্ধ',          'droplets',       '#0f766e', 'community', 'high',     3),
  ('garbage',            'Overflowing Garbage',    'ময়লার স্তূপ',        'trash-2',        '#4d7c0f', 'community', 'medium',   4),
  ('illegal_dumping',    'Illegal Dumping',        'অবৈধ ময়লা ফেলা',     'package-x',      '#65a30d', 'community', 'medium',   5),
  ('dengue_breeding',    'Dengue Breeding Site',   'ডেঙ্গু প্রজননস্থল',   'bug',            '#be123c', 'community', 'critical', 6),
  ('streetlight',        'Broken Streetlight',     'নষ্ট স্ট্রিটলাইট',     'lamp',           '#a16207', 'authority', 'medium',   7),
  ('safety_hazard',      'Public Safety Hazard',   'জননিরাপত্তা ঝুঁকি',   'triangle-alert', '#dc2626', 'authority', 'critical', 8),
  ('infrastructure',     'Infrastructure Damage',  'অবকাঠামো ক্ষতি',      'building-2',     '#7c3aed', 'authority', 'high',     9),
  ('other',              'Other',                  'অন্যান্য',            'circle-help',    '#64748b', 'community', 'low',     10)
on conflict (slug) do nothing;

-- Rough rectangles for testing only. They are NOT the real DNCC / DSCC
-- boundaries; redraw them in the admin panel before real use.
-- (Skipped on a v1 database, which has no City Corporations.)
do $$
begin
  if to_regclass('public.authorities') is null then return; end if;
  insert into authorities (name, short_name, area, hotline)
  select 'Dhaka North City Corporation', 'DNCC',
         ST_Multi(ST_GeomFromText('POLYGON((90.33 23.765, 90.46 23.765, 90.46 23.90, 90.33 23.90, 90.33 23.765))', 4326))::geography,
         '16106'
  where not exists (select 1 from authorities where short_name = 'DNCC');
  insert into authorities (name, short_name, area, hotline)
  select 'Dhaka South City Corporation', 'DSCC',
         ST_Multi(ST_GeomFromText('POLYGON((90.35 23.68, 90.46 23.68, 90.46 23.765, 90.35 23.765, 90.35 23.68))', 4326))::geography,
         '01709900703'
  where not exists (select 1 from authorities where short_name = 'DSCC');
end $$;
