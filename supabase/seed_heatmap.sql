-- =====================================================================
-- AmarShohor — fake issues for testing the map and heatmap. DEVELOPMENT ONLY.
-- Never run this on the real database.
--
-- Inserts directly into the tables (as the SQL editor / postgres user), so it
-- skips the report rules (daily limit, duplicates, photos). That is the point:
-- it fills the map fast. Run after the migrations and seed.sql.
--
-- Covers 11 cities across Bangladesh and every active category. Each city
-- has busy hotspots plus a wide "spread" entry for scattered reports.
-- Coordinates are approximate neighbourhood centres, good enough for a map.
--
-- Change the numbers in the `cfg` block below. Run it again to add more.
-- Remove everything it made with the block at the bottom of this file.
-- =====================================================================

set search_path = public, extensions;

do $$
declare
  cfg_users     int := 80;     -- fake reporters
  cfg_issues    int := 8000;   -- fake issues
  cfg_min_each  int := 40;     -- every active category gets at least this many issues
  cfg_max_days  int := 120;    -- reports are spread over this many days back
  v_users uuid[];
  v_cats  int;
begin
  -- 1. Fake reporters. The on_auth_user_created trigger makes their profiles.
  --    They have no password, so nobody can log in as them.
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'seed_' || substr(md5(random()::text), 1, 10) || '@seed.amarshohor.test',
         jsonb_build_object('username', 'seed_' || substr(md5(random()::text), 1, 8),
                            'full_name', 'Demo citizen ' || g),
         now() - interval '200 days', now()
  from generate_series(1, cfg_users) g;

  select array_agg(id) into v_users from auth.users where email like '%@seed.amarshohor.test';
  select count(*) into v_cats from categories where is_active;

  -- 2. Fake issues.
  with hotspot(city, name, lat, lng, spread_m, share) as (values
    -- Dhaka: busy, flood-prone or crowded areas, plus scattered reports across the city
    ('Dhaka',       'Mirpur 10',          23.8069, 90.3687,  700, 0.050),
    ('Dhaka',       'Mohammadpur',        23.7590, 90.3580,  600, 0.036),
    ('Dhaka',       'Old Dhaka',          23.7104, 90.4074,  500, 0.050),
    ('Dhaka',       'Jatrabari',          23.7104, 90.4347,  600, 0.036),
    ('Dhaka',       'Badda',              23.7806, 90.4265,  600, 0.032),
    ('Dhaka',       'Uttara Sector 10',   23.8728, 90.3830,  500, 0.022),
    ('Dhaka',       'Farmgate',           23.7577, 90.3897,  400, 0.029),
    ('Dhaka',       'Malibagh',           23.7486, 90.4141,  450, 0.029),
    ('Dhaka',       'Rampura',            23.7614, 90.4205,  450, 0.025),
    ('Dhaka',       'Kamrangirchar',      23.7190, 90.3720,  500, 0.022),
    ('Dhaka',       'Gulshan',            23.7925, 90.4078,  400, 0.011),
    ('Dhaka',       'Dhanmondi',          23.7465, 90.3760,  400, 0.018),
    ('Dhaka',       'Dhaka (scattered)',  23.7800, 90.4000, 6000, 0.090),
    -- Chattogram
    ('Chattogram',  'Agrabad',            22.3245, 91.8113,  600, 0.035),
    ('Chattogram',  'GEC Circle',         22.3590, 91.8217,  500, 0.030),
    ('Chattogram',  'Bahaddarhat',        22.3667, 91.8433,  500, 0.025),
    ('Chattogram',  'Halishahar',         22.3330, 91.7780,  600, 0.020),
    ('Chattogram',  'Chattogram (scattered)', 22.3500, 91.8200, 5000, 0.040),
    -- Gazipur & Narayanganj (around Dhaka)
    ('Gazipur',     'Tongi',              23.8910, 90.4020,  600, 0.025),
    ('Gazipur',     'Gazipur Chowrasta',  23.9990, 90.4200,  700, 0.025),
    ('Narayanganj', 'Narayanganj',        23.6230, 90.5000,  900, 0.040),
    -- Divisional cities
    ('Khulna',      'Khulna Sadar',       22.8160, 89.5560,  600, 0.030),
    ('Khulna',      'Daulatpur',          22.8780, 89.5150,  600, 0.015),
    ('Khulna',      'Khulna (scattered)', 22.8400, 89.5500, 4000, 0.025),
    ('Rajshahi',    'Shaheb Bazar',       24.3650, 88.6000,  500, 0.025),
    ('Rajshahi',    'Rajshahi (scattered)', 24.3700, 88.6200, 3500, 0.035),
    ('Sylhet',      'Zindabazar',         24.8960, 91.8700,  500, 0.025),
    ('Sylhet',      'Sylhet (scattered)', 24.9000, 91.8700, 3500, 0.035),
    ('Barishal',    'Barishal',           22.7010, 90.3535, 2500, 0.030),
    ('Rangpur',     'Rangpur',            25.7460, 89.2510, 2500, 0.030),
    ('Mymensingh',  'Mymensingh',         24.7560, 90.4060, 2500, 0.030),
    ('Cumilla',     'Cumilla',            23.4610, 91.1850, 2500, 0.030)
  ),
  -- pick a hotspot per issue, weighted by share
  hs as (select *, sum(share) over (order by name) as cum, sum(share) over () as total from hotspot),
  draw as (
    select g, random() as pick,
           -- Box–Muller: a normal(0,1) distance, so reports bunch near the centre
           sqrt(-2 * ln(greatest(random(), 1e-9))) as r, 2 * pi() * random() as theta,
           random() as days_rand, random() as status_rand, random() as cat_rand
    from generate_series(1, cfg_issues) g
  ),
  placed as (
    select d.*,
           h.lat + (d.r * cos(d.theta) * h.spread_m) / 111320 as lat,
           h.lng + (d.r * sin(d.theta) * h.spread_m) / (111320 * cos(radians(h.lat))) as lng,
           h.name as area, h.city
    from draw d
    cross join lateral (select * from hs where hs.cum / hs.total >= d.pick order by hs.cum limit 1) h
  ),
  cats as (select array_agg(slug order by sort_order) as slugs from categories where is_active),
  gen as (
    select p.*,
           c.slug as category, c.name as category_name, c.resolver, c.default_severity,
           now() - (power(p.days_rand, 1.6) * cfg_max_days) * interval '1 day' as created
    from placed p, cats
    cross join lateral (
      select * from categories
       where slug = cats.slugs[
         case
           -- the first issues go round every category, so none is left out
           when p.g <= v_cats * cfg_min_each then 1 + (p.g - 1) % v_cats
           -- the rest lean towards the common, everyday ones (lower sort order)
           else 1 + floor(power(p.cat_rand, 1.4) * v_cats)::int
         end]
    ) c
  )
  insert into issues (
    reporter_id, title, description, category, severity, base_severity, location,
    location_accuracy_m, location_source, address, status, route, route_source,
    upvote_count, confirmation_count, validation_score, validated_at, escalated_at, closed_at,
    created_at, updated_at, last_activity_at
  )
  select
    v_users[1 + floor(random() * array_length(v_users, 1))::int],
    left('[demo] ' || category_name || ' near ' || area, 120),
    'Generated by seed_heatmap.sql for testing the heatmap.',
    category,
    -- mostly the category default, sometimes one step up or down
    (enum_range(null::severity_level))[least(4, greatest(1,
        array_position(enum_range(null::severity_level), default_severity)
        + case when random() < 0.15 then 1 when random() < 0.15 then -1 else 0 end))],
    default_severity,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
    5 + random() * 40, 'gps', left(replace(area, ' (scattered)', '') || ', ' || city, 200),
    st.status, st.route, 'category',
    floor(random() * 25)::int, floor(power(random(), 2) * 8)::int, 0,
    case when st.status <> 'community_review' then created + interval '6 hours' end,
    case when st.status = 'escalated' then created + interval '7 hours' end,
    case when st.status = 'closed' then created + interval '5 days' end,
    created, created, created
  from gen
  cross join lateral (
    -- 15% unverified, 10% resolved, the rest open (validated, or with an authority)
    select case
             when status_rand < 0.15 then 'community_review'
             when status_rand < 0.25 then 'closed'
             when resolver = 'authority' then 'escalated'
             else 'validated' end::issue_status as status,
           case when status_rand < 0.15 then 'pending'
                else resolver::text end::issue_route as route
  ) st;

  -- 3. Give authority issues to the City Corporation whose area covers them.
  --    Outside those areas they stay escalated with no City Corporation, as real reports would.
  if to_regclass('public.authorities') is not null then
    update issues i set authority_id = a.id
      from authorities a
     where i.title like '[demo]%' and i.route = 'authority' and i.authority_id is null
       and ST_Covers(a.area, i.location);
  end if;

  update profiles p set reports_count = (select count(*) from issues where reporter_id = p.id)
   where p.id = any(v_users);

  raise notice 'Done: % fake issues in total, % categories covered',
    (select count(*) from issues where title like '[demo]%'),
    (select count(distinct category) from issues where title like '[demo]%');
end $$;

-- ---------- Remove all fake data ------------------------------------
-- Deleting the users cascades to their profiles, issues and everything on them.
-- delete from auth.users where email like '%@seed.amarshohor.test';
