-- =====================================================================
-- 0006: Area heat summary for the map's search pin.
-- The user searches a place (or drops a pin) and the map explains how
-- "hot" the circle around that point is, using exactly the same rules
-- as the heatmap: only validated, still-open issues add heat, and each
-- issue's heat comes from issue_heat_weight().
-- =====================================================================

create or replace function area_heat_summary(
  p_lat double precision, p_lng double precision,
  p_radius_m int default 1000,
  p_category text default null
) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  with r as (
    select least(greatest(coalesce(p_radius_m, 1000), 100), 10000) as m  -- 100 m … 10 km
  ),
  near as (
    select i.id, i.title, i.category, i.status,
           ST_Distance(i.location, make_point(p_lat, p_lng)) as dist,
           case when i.status in ('validated', 'assigned', 'in_progress', 'resolution_submitted')
                then issue_heat_weight(i.severity, i.confirmation_count, i.upvote_count,
                                       coalesce(i.validated_at, i.created_at))
                else 0 end as w
    from issues i, r
    where ST_DWithin(i.location, make_point(p_lat, p_lng), r.m)
      and (p_category is null or i.category = p_category)
      and i.status not in ('hidden', 'expired')
  ),
  active as (
    select * from near where status in ('validated', 'assigned', 'in_progress', 'resolution_submitted')
  )
  select jsonb_build_object(
    'radius_m',     (select m from r),
    'active',       (select count(*) from active),
    'unverified',   (select count(*) from near where status = 'community_review'),
    'resolved',     (select count(*) from near where status = 'closed'),
    'heat',         coalesce((select round(sum(w), 2) from active), 0),
    -- heat per km², so circles of different sizes can be compared
    'heat_per_km2', coalesce((select round(sum(w) / (pi() * r.m * r.m / 1e6)::numeric, 2) from active, r group by r.m), 0),
    'categories',   coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'count', n, 'heat', h) order by h desc)
      from (select category, count(*) as n, round(sum(w), 2) as h from active group by category) c
    ), '[]'::jsonb),
    'hottest',      coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', id, 'title', title, 'category', category, 'status', status,
               'heat', round(w, 2), 'distance_m', round(dist::numeric)) order by w desc)
      from (select * from active order by w desc limit 5) t
    ), '[]'::jsonb)
  )
$$;

revoke execute on function area_heat_summary(double precision, double precision, int, text) from public;
grant execute on function area_heat_summary(double precision, double precision, int, text) to anon, authenticated;
