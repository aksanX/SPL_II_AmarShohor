-- =====================================================================
-- AmarShohor — 3. Read API (views + feed/map/heatmap functions) and security
--
-- Security model:
--   * Clients get NO direct access to tables except a few public ones.
--   * Reads go through views that hide private data (anonymous reporters,
--     home locations). Views run as their owner, so each one filters itself.
--   * Writes go only through the functions in 0002.
-- =====================================================================

set search_path = public, extensions;

-- ---------- Views ---------------------------------------------------

create or replace view issues_v as
select
  i.id, i.title, i.description, i.category,
  c.name as category_name, c.name_bn as category_name_bn, c.icon as category_icon,
  c.color as category_color, c.resolver,
  i.severity,
  ST_Y(i.location::geometry) as lat,
  ST_X(i.location::geometry) as lng,
  i.location_accuracy_m, i.location_source, i.address,
  i.status, i.is_anonymous,
  -- anonymous reporters are hidden from everyone except themselves
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else i.reporter_id end as reporter_id,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else rp.username end as reporter_username,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else rp.full_name end as reporter_full_name,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else rp.avatar_url end as reporter_avatar_url,
  coalesce(i.reporter_id = auth.uid(), false) as is_mine,
  i.upvote_count, i.confirmation_count, i.comment_count, i.follower_count, i.flag_count,
  i.validation_score, i.validation_threshold,
  i.volunteer_id, vp.username as volunteer_username, vp.full_name as volunteer_full_name,
  vp.avatar_url as volunteer_avatar_url,
  i.assigned_at, i.lock_expires_at, i.resolution_note, i.resolution_submitted_at,
  i.validated_at, i.closed_at, i.created_at, i.updated_at, i.last_activity_at,
  exists (select 1 from votes v where v.issue_id = i.id and v.user_id = auth.uid()) as my_vote,
  exists (select 1 from confirmations x where x.issue_id = i.id and x.user_id = auth.uid()) as my_confirmed,
  exists (select 1 from flags f where f.issue_id = i.id and f.user_id = auth.uid()) as my_flagged,
  exists (select 1 from follows f where f.issue_id = i.id and f.user_id = auth.uid()) as my_following,
  (select s.severity from severity_votes s where s.issue_id = i.id and s.user_id = auth.uid()) as my_severity_vote,
  (select r.is_fixed from resolution_reviews r where r.assignment_id = i.assignment_id and r.user_id = auth.uid()) as my_resolution_review,
  exists (select 1 from ratings r where r.assignment_id = i.assignment_id) as is_rated,
  coalesce((
    select json_agg(json_build_object('id', m.id, 'kind', m.kind, 'media_type', m.media_type, 'path', m.storage_path)
                    order by (m.kind = 'report') desc, m.created_at)
      from (select * from issue_media m2
             where m2.issue_id = i.id and m2.kind in ('report', 'confirmation')
             order by (m2.kind = 'report') desc, m2.created_at limit 6) m
  ), '[]'::json) as media
from issues i
join categories c on c.slug = i.category
join profiles rp on rp.id = i.reporter_id
left join profiles vp on vp.id = i.volunteer_id;

create or replace view issue_media_v as
select m.id, m.issue_id, m.kind, m.media_type, m.storage_path, m.event_id, m.created_at,
       case when i.is_anonymous and m.uploader_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else m.uploader_id end as uploader_id
from issue_media m join issues i on i.id = m.issue_id;

create or replace view issue_events_v as
select e.id, e.issue_id, e.type, e.note, e.data, e.created_at,
       case when i.is_anonymous and e.actor_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else e.actor_id end as actor_id,
       case when i.is_anonymous and e.actor_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else p.username end as actor_username,
       case when i.is_anonymous and e.actor_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else p.full_name end as actor_full_name,
       case when i.is_anonymous and e.actor_id = i.reporter_id and i.reporter_id is distinct from auth.uid()
            then null else p.avatar_url end as actor_avatar_url,
       coalesce((
         select json_agg(json_build_object('id', m.id, 'kind', m.kind, 'media_type', m.media_type, 'path', m.storage_path)
                         order by m.created_at)
           from issue_media m where m.event_id = e.id
       ), '[]'::json) as media
from issue_events e
join issues i on i.id = e.issue_id
left join profiles p on p.id = e.actor_id;

create or replace view comments_v as
select c.id, c.issue_id, c.parent_id, c.author_id,
       p.username as author_username, p.full_name as author_full_name, p.avatar_url as author_avatar_url,
       case when c.deleted_at is not null or c.is_hidden then null else c.body end as body,
       c.deleted_at is not null as is_deleted, c.is_hidden, c.is_update, c.edited_at, c.created_at,
       coalesce(c.author_id = i.volunteer_id, false) as is_volunteer,
       (c.author_id = i.reporter_id and not i.is_anonymous) as is_reporter,
       exists (select 1 from comment_flags f where f.comment_id = c.id and f.user_id = auth.uid()) as my_flagged
from comments c
join profiles p on p.id = c.author_id
join issues i on i.id = c.issue_id;

create or replace view ratings_v as
select r.id, r.issue_id, i.title as issue_title, r.volunteer_id, r.stars, r.review, r.created_at,
       case when i.is_anonymous then null else r.rater_id end as rater_id,
       case when i.is_anonymous then null else p.username end as rater_username
from ratings r
join issues i on i.id = r.issue_id
join profiles p on p.id = r.rater_id;

create or replace view leaderboard_v as
select p.id, p.username, p.full_name, p.avatar_url, p.area_name,
       p.reputation, p.tasks_completed, p.tasks_expired, p.tasks_reopened, p.rating_count,
       case when p.rating_count > 0 then round(p.rating_sum::numeric / p.rating_count, 2) end as avg_rating,
       rank() over (order by p.reputation desc, p.tasks_completed desc) as rank
from profiles p
join user_settings us on us.user_id = p.id
where (p.is_volunteer or p.tasks_completed > 0) and us.show_on_leaderboard;

create or replace view my_settings_v as
select us.user_id,
       ST_Y(us.home_location::geometry) as home_lat,
       ST_X(us.home_location::geometry) as home_lng,
       us.default_anonymous, us.show_on_leaderboard
from user_settings us
where us.user_id = auth.uid();

create or replace view notifications_v as
select n.id, n.type, n.issue_id, n.message, n.read_at, n.created_at,
       n.actor_id, p.username as actor_username, p.full_name as actor_full_name, p.avatar_url as actor_avatar_url
from notifications n
left join profiles p on p.id = n.actor_id
where n.user_id = auth.uid();

-- ---------- Feed ----------------------------------------------------
-- p_sort:  hot | new | top | near
-- p_scope: all | unverified | validated | resolved | mine | following
create or replace function get_feed(
  p_sort text default 'hot',
  p_scope text default 'all',
  p_category text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_m int default 5000,
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0
) returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select v.*
  from issues_v v
  where (p_category is null or v.category = p_category)
    and case p_scope
          when 'mine'       then v.is_mine
          when 'following'  then v.my_following and v.status not in ('hidden', 'expired')
          when 'unverified' then v.status = 'community_review'
          when 'validated'  then v.status in ('validated', 'assigned', 'in_progress', 'resolution_submitted')
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
    -- Reddit-style "hot": engagement decays with age
    case when p_sort = 'hot'
         then (v.upvote_count + 2 * v.confirmation_count + 0.5 * v.comment_count + 1)
              / power(extract(epoch from now() - v.created_at) / 3600 + 2, 1.5) end desc nulls last,
    v.created_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
$$;

create or replace function get_issue(p_issue uuid) returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select * from issues_v where id = p_issue
$$;

-- A user's public reports (anonymous ones never show up on their profile).
create or replace function get_user_issues(p_username text, p_limit int default 20, p_offset int default 0)
returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select v.* from issues_v v
  join issues i on i.id = v.id
  join profiles p on p.id = i.reporter_id
  where p.username = p_username
    and (not i.is_anonymous or i.reporter_id = auth.uid())
    and (i.status not in ('hidden', 'expired') or i.reporter_id = auth.uid())
  order by v.created_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
$$;

-- ---------- Volunteer board -----------------------------------------
create or replace function get_open_tasks(
  p_lat double precision default null, p_lng double precision default null,
  p_radius_m int default 10000, p_category text default null
) returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select v.* from issues_v v
  where v.status = 'validated'
    and (p_category is null or v.category = p_category)
    and (p_lat is null or ST_DWithin(make_point(v.lat, v.lng), make_point(p_lat, p_lng), p_radius_m))
  order by
    severity_weight(v.severity) desc,
    case when p_lat is not null then ST_Distance(make_point(v.lat, v.lng), make_point(p_lat, p_lng)) end asc nulls last,
    v.validated_at asc
  limit 100
$$;

create or replace function get_my_tasks() returns setof issues_v
language sql stable security definer set search_path = public, extensions as $$
  select v.* from issues_v v
  where v.volunteer_id = auth.uid()
    and v.status in ('assigned', 'in_progress', 'resolution_submitted', 'closed')
  order by (v.status = 'closed'), v.lock_expires_at asc nulls last, v.closed_at desc nulls last
  limit 100
$$;

-- ---------- Map & heatmap -------------------------------------------

-- How much an issue heats its area:
--   severity (1–4) × evidence (on-site confirmations count most)
--   × freshness (halves every heat_half_life_days, never below heat_min_decay
--     because an unresolved problem is still a problem).
create or replace function issue_heat_weight(
  p_severity severity_level, p_confirmations int, p_upvotes int, p_since timestamptz
) returns numeric
language sql stable set search_path = public, extensions as $$
  select round((
    severity_weight(p_severity)
    * (1 + ln(1 + p_confirmations) + 0.25 * ln(1 + p_upvotes))
    * greatest(s.heat_min_decay,
               power(0.5, extract(epoch from now() - p_since) / 86400 / s.heat_half_life_days))
  )::numeric, 3)
  from app_settings s where s.id = 1
$$;

-- Markers. p_layers: any of 'unverified', 'active', 'resolved'.
create or replace function map_issues(
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision,
  p_category text default null,
  p_layers text[] default array['active']
) returns table (
  id uuid, title text, category text, category_color text, category_icon text,
  severity severity_level, status issue_status, lat double precision, lng double precision,
  upvote_count int, confirmation_count int, validation_score numeric, validation_threshold numeric,
  created_at timestamptz, thumb_path text, thumb_type media_type
)
language sql stable security definer set search_path = public, extensions as $$
  select i.id, i.title, i.category, c.color, c.icon, i.severity, i.status,
         ST_Y(i.location::geometry), ST_X(i.location::geometry),
         i.upvote_count, i.confirmation_count, i.validation_score, i.validation_threshold,
         i.created_at, m.storage_path, m.media_type
  from issues i
  join categories c on c.slug = i.category
  left join lateral (
    select storage_path, media_type from issue_media
     where issue_id = i.id and kind = 'report' order by created_at limit 1
  ) m on true
  where ST_Intersects(i.location, ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography)
    and (p_category is null or i.category = p_category)
    and (
      ('unverified' = any(p_layers) and i.status = 'community_review')
      or ('active' = any(p_layers) and i.status in ('validated', 'assigned', 'in_progress', 'resolution_submitted'))
      or ('resolved' = any(p_layers) and i.status = 'closed')
    )
  order by i.created_at desc
  limit 2000
$$;

-- Hexagon heatmap. Only validated, still-open issues count.
-- Each issue is snapped to the hexagon that contains it. The grid is anchored
-- at the projection origin, so hexagons stay in the same place while panning
-- and zooming (no "jumping" hotspots). p_cell_m is the real-world hexagon
-- edge length in metres; it is corrected for Web-Mercator stretch at this
-- latitude so a 250 m hexagon really is 250 m on the ground.
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
           i.category
    from issues i
    where i.status in ('validated', 'assigned', 'in_progress', 'resolution_submitted')
      and (p_category is null or i.category = p_category)
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
       limit 1               -- a point exactly on an edge counts once
    ) h
  )
  select ST_AsGeoJSON(ST_Transform(geom, 4326), 6)::jsonb,
         round(sum(w), 2), count(*)::int,
         mode() within group (order by category)
  from snapped
  group by i, j, geom
$$;

-- Weighted points for the smooth "heat" layer (same rules as heatmap_hex).
create or replace function heatmap_points(
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision,
  p_category text default null
) returns table (lat double precision, lng double precision, weight numeric)
language sql stable security definer set search_path = public, extensions as $$
  select ST_Y(i.location::geometry), ST_X(i.location::geometry),
         issue_heat_weight(i.severity, i.confirmation_count, i.upvote_count, coalesce(i.validated_at, i.created_at))
  from issues i
  where i.status in ('validated', 'assigned', 'in_progress', 'resolution_submitted')
    and (p_category is null or i.category = p_category)
    and ST_Intersects(i.location, ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography)
$$;

-- Numbers for the sidebar / profile.
create or replace function platform_stats() returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object(
    'reported',   (select count(*) from issues where status not in ('hidden', 'expired')),
    'validated',  (select count(*) from issues where status in ('validated', 'assigned', 'in_progress', 'resolution_submitted')),
    'in_progress',(select count(*) from issues where status in ('assigned', 'in_progress', 'resolution_submitted')),
    'resolved',   (select count(*) from issues where status = 'closed'),
    'volunteers', (select count(*) from profiles where is_volunteer)
  )
$$;

-- ---------- Profile & notifications writes --------------------------
create or replace function update_my_profile(
  p_username text, p_full_name text, p_bio text, p_area_name text, p_avatar_url text
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_user uuid := require_user();
begin
  if p_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must be 3–24 characters: lowercase letters, numbers, underscore' using hint = 'BAD_USERNAME';
  end if;
  if exists (select 1 from profiles where username = p_username and id <> v_user) then
    raise exception 'That username is taken' using hint = 'USERNAME_TAKEN';
  end if;
  update profiles
     set username = p_username, full_name = left(coalesce(trim(p_full_name), ''), 80),
         bio = left(coalesce(trim(p_bio), ''), 280), area_name = left(coalesce(trim(p_area_name), ''), 80),
         avatar_url = nullif(trim(p_avatar_url), '')
   where id = v_user;
end $$;

create or replace function mark_notifications_read(p_ids bigint[] default null) returns void
language sql security definer set search_path = public, extensions as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null
     and (p_ids is null or id = any(p_ids))
$$;

-- Lets Storage policies check whether a file is still used as evidence.
create or replace function media_in_use(p_path text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from issue_media where storage_path = p_path)
$$;

-- ---------- Lock everything down, then open what's needed -----------

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Public reference data
grant select on categories, app_settings, profiles to anon, authenticated;
create policy "categories are public"   on categories   for select using (true);
create policy "settings are public"     on app_settings for select using (true);
create policy "profiles are public"     on profiles     for select using (true);

-- Own notifications (direct table access is needed for Realtime)
grant select on notifications to authenticated;
create policy "read own notifications" on notifications for select to authenticated using (user_id = auth.uid());

-- Read views
grant select on issues_v, issue_media_v, issue_events_v, comments_v, ratings_v, leaderboard_v to anon, authenticated;
grant select on my_settings_v, notifications_v to authenticated;

-- Read functions (also for logged-out visitors)
grant execute on function
  get_feed(text, text, text, double precision, double precision, int, text, int, int),
  get_issue(uuid),
  get_user_issues(text, int, int),
  get_open_tasks(double precision, double precision, int, text),
  map_issues(double precision, double precision, double precision, double precision, text, text[]),
  heatmap_hex(double precision, double precision, double precision, double precision, int, text),
  heatmap_points(double precision, double precision, double precision, double precision, text),
  find_nearby_duplicates(double precision, double precision, text),
  platform_stats()
to anon, authenticated;

-- Write functions (logged-in users only)
grant execute on function
  get_my_tasks(),
  create_issue(text, text, text, double precision, double precision, real, text, text, boolean, jsonb, boolean),
  update_issue(uuid, text, text, text, text),
  delete_issue(uuid),
  toggle_vote(uuid, double precision, double precision),
  confirm_issue(uuid, double precision, double precision, real, text, jsonb),
  flag_issue(uuid, flag_reason, text),
  unflag_issue(uuid),
  vote_severity(uuid, severity_level),
  toggle_follow(uuid),
  add_comment(uuid, text, uuid, boolean),
  edit_comment(uuid, text),
  delete_comment(uuid),
  flag_comment(uuid),
  set_volunteer_mode(boolean),
  accept_task(uuid),
  post_progress(uuid, text, jsonb),
  release_task(uuid, text),
  submit_resolution(uuid, text, double precision, double precision, real, jsonb),
  review_resolution(uuid, boolean, double precision, double precision),
  rate_volunteer(uuid, int, text),
  update_my_settings(double precision, double precision, boolean, boolean),
  update_my_profile(text, text, text, text, text),
  mark_notifications_read(bigint[]),
  media_in_use(text)
to authenticated;

-- Realtime: push new notifications to the browser instantly.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;
