-- =====================================================================
-- AmarShohor — 0018: an issue can turn into an emergency
--
-- Any open issue can get worse (an open manhole someone fell into, a
-- leaning building that starts to crack, a dangling wire that starts
-- sparking). Anyone can then raise an emergency alert from the issue:
--   - the alert is placed at the issue's location and linked to it,
--   - the issue's followers are warned too, wherever they live,
--   - one active alert per issue (the next person confirms that one).
-- The issue keeps its normal flow; the alert ends on its own as usual.
-- =====================================================================

set search_path = public, extensions;

alter table emergency_alerts add column issue_id uuid references issues(id) on delete set null;
create index emergency_alerts_issue_idx on emergency_alerts (issue_id) where issue_id is not null;

-- ---------- Raise an alert (optionally from an issue) ----------------
drop function if exists create_emergency_alert(emergency_kind, text, double precision, double precision, text, jsonb);
create function create_emergency_alert(
  p_kind emergency_kind, p_note text, p_lat double precision, p_lng double precision,
  p_address text, p_media jsonb default '[]', p_issue uuid default null
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  m record;
  i issues;
  v_point geography;
  v_address text := coalesce(trim(p_address), '');
  v_radius int;
  v_id uuid;
  v_where text;
begin
  select * into s from app_settings where id = 1;
  if (select count(*) from emergency_alerts where reporter_id = v_user and created_at > now() - interval '24 hours')
     >= s.emergency_max_per_day then
    raise exception 'You can raise at most % emergency alerts a day. Call 999.', s.emergency_max_per_day using hint = 'RATE_LIMIT';
  end if;

  if p_issue is not null then
    select * into i from issues where id = p_issue;
    if not found or i.status in ('hidden', 'expired', 'closed') then
      raise exception 'This issue is no longer open' using hint = 'BAD_ISSUE';
    end if;
    if exists (select 1 from emergency_alerts where issue_id = p_issue and status = 'active') then
      raise exception 'An emergency alert is already active for this issue. Confirm it instead.' using hint = 'ALREADY_ALERTED';
    end if;
    -- The emergency is where the issue is, not where the person raising it stands.
    v_point := i.location;
    if v_address = '' then v_address := i.address; end if;
  else
    perform assert_in_service_area(p_lat, p_lng);
    v_point := make_point(p_lat, p_lng);
  end if;

  if jsonb_array_length(coalesce(p_media, '[]')) > 3 then
    raise exception 'You can attach up to 3 files' using hint = 'BAD_MEDIA';
  end if;
  for m in select * from jsonb_to_recordset(coalesce(p_media, '[]'::jsonb)) as x(path text, type text) loop
    if m.path is null or position(v_user::text || '/' in m.path) <> 1 or m.type not in ('image', 'video') then
      raise exception 'Invalid media file' using hint = 'BAD_MEDIA';
    end if;
  end loop;

  -- Brand-new accounts warn a smaller area until someone confirms.
  v_radius := case when (select created_at from profiles where id = v_user) > now() - make_interval(hours => s.new_account_hours)
                   then s.emergency_new_account_radius_m else s.emergency_radius_m end;

  insert into emergency_alerts (reporter_id, kind, note, location, address, media, notify_radius_m, expires_at, issue_id)
  values (v_user, p_kind, coalesce(trim(p_note), ''), v_point, v_address,
          coalesce(p_media, '[]'), v_radius, now() + make_interval(hours => s.emergency_hours), p_issue)
  returning id into v_id;

  v_where := coalesce(nullif(v_address, ''), 'your area');
  insert into notifications (user_id, type, alert_id, message)
  select us.user_id, 'emergency', v_id,
         format('%s reported near %s. Stay away and keep the road clear for emergency services.',
                emergency_label(p_kind), v_where)
    from user_settings us
   where us.user_id <> v_user and us.home_location is not null
     and ST_DWithin(us.home_location, v_point, v_radius);
  -- Followers of the issue care about it even if they live further away.
  if p_issue is not null then
    insert into notifications (user_id, type, alert_id, issue_id, message)
    select f.user_id, 'emergency', v_id, p_issue,
           format('An issue you follow is now an emergency: %s near %s. Stay away.', emergency_label(p_kind), v_where)
      from follows f
     where f.issue_id = p_issue and f.user_id <> v_user
       and not exists (select 1 from notifications n where n.alert_id = v_id and n.user_id = f.user_id);
  end if;
  insert into notifications (user_id, type, alert_id, actor_id, message)
  select user_id, 'emergency_admin', v_id, v_user,
         format('Emergency alert raised: %s near %s.', emergency_label(p_kind), v_where)
    from user_roles where role = 'admin' and user_id <> v_user;
  return v_id;
end $$;

-- ---------- Reads: alerts carry their issue ---------------------------
drop function if exists get_active_alerts(double precision, double precision, int);
create function get_active_alerts(
  p_lat double precision default null, p_lng double precision default null, p_radius_m int default 25000
) returns table (
  id uuid, kind emergency_kind, note text, lat double precision, lng double precision, address text,
  media jsonb, status text, confirm_count int, deny_count int, over_count int,
  created_at timestamptz, expires_at timestamptz, distance_m double precision, is_mine boolean, my_response text,
  issue_id uuid
)
language sql stable security definer set search_path = public, extensions as $$
  select e.id, e.kind, e.note, ST_Y(e.location::geometry), ST_X(e.location::geometry), e.address,
         e.media, e.status, e.confirm_count, e.deny_count, e.over_count, e.created_at, e.expires_at,
         case when p_lat is null then null else ST_Distance(e.location, make_point(p_lat, p_lng)) end,
         coalesce(e.reporter_id = auth.uid(), false),
         (select r.response from emergency_responses r where r.alert_id = e.id and r.user_id = auth.uid()),
         e.issue_id
    from emergency_alerts e
   where e.status = 'active'
     and (p_lat is null or ST_DWithin(e.location, make_point(p_lat, p_lng), p_radius_m))
   order by e.created_at desc
   limit 50
$$;

drop function if exists get_alert(uuid);
create function get_alert(p_alert uuid)
returns table (
  id uuid, kind emergency_kind, note text, lat double precision, lng double precision, address text,
  media jsonb, status text, confirm_count int, deny_count int, over_count int,
  created_at timestamptz, expires_at timestamptz, ended_at timestamptz, is_mine boolean, my_response text,
  emergency_contacts jsonb, authority_short_name text, issue_id uuid, issue_title text
)
language sql stable security definer set search_path = public, extensions as $$
  select e.id, e.kind, e.note, ST_Y(e.location::geometry), ST_X(e.location::geometry), e.address,
         case when e.status = 'hidden' and e.reporter_id is distinct from auth.uid() then '[]'::jsonb else e.media end,
         e.status, e.confirm_count, e.deny_count, e.over_count, e.created_at, e.expires_at, e.ended_at,
         coalesce(e.reporter_id = auth.uid(), false),
         (select r.response from emergency_responses r where r.alert_id = e.id and r.user_id = auth.uid()),
         coalesce(a.emergency_contacts, '[]'::jsonb), a.short_name,
         i.id, i.title
    from emergency_alerts e
    left join authorities a on a.id = find_authority(e.location)
    left join issues i on i.id = e.issue_id and i.status not in ('hidden')
   where e.id = p_alert
$$;

-- The active alert on an issue, if any (shown as a banner on the issue).
create function get_issue_alert(p_issue uuid)
returns table (id uuid, kind emergency_kind, confirm_count int, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select e.id, e.kind, e.confirm_count, e.created_at
    from emergency_alerts e
   where e.issue_id = p_issue and e.status = 'active'
   order by e.created_at desc
   limit 1
$$;

revoke execute on function
  get_active_alerts(double precision, double precision, int),
  get_alert(uuid),
  get_issue_alert(uuid),
  create_emergency_alert(emergency_kind, text, double precision, double precision, text, jsonb, uuid)
from public, anon, authenticated;
grant execute on function
  get_active_alerts(double precision, double precision, int),
  get_alert(uuid),
  get_issue_alert(uuid)
to anon, authenticated;
grant execute on function
  create_emergency_alert(emergency_kind, text, double precision, double precision, text, jsonb, uuid)
to authenticated;
