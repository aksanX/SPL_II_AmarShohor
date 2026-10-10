-- =====================================================================
-- AmarShohor — 37. Live emergency photos: same ownership check as other uploads
--
-- Same as 0019, except the uploader is checked with owns_upload() (0036),
-- so live photos with untraceable names ("u/<random>.jpg") are accepted.
-- =====================================================================

set search_path = public, extensions;

create or replace function take_live_media(p_media jsonb, p_user uuid, p_point geography)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  m record;
  t capture_tokens;
  v_uploaded timestamptz;
  v_out jsonb := '[]';
begin
  select * into s from app_settings where id = 1;
  if jsonb_array_length(coalesce(p_media, '[]')) > 3 then
    raise exception 'You can attach up to 3 files' using hint = 'BAD_MEDIA';
  end if;
  for m in select * from jsonb_to_recordset(coalesce(p_media, '[]'::jsonb)) as x(path text, type text, token text) loop
    if not owns_upload(m.path, p_user) or m.type not in ('image', 'video') then
      raise exception 'Invalid media file' using hint = 'BAD_MEDIA';
    end if;
    if m.token is null or m.token !~ '^[0-9a-f-]{36}$' then
      raise exception 'Only live photos or videos taken with the in-app camera can be attached' using hint = 'NOT_LIVE';
    end if;
    select * into t from capture_tokens where id = m.token::uuid and user_id = p_user for update;
    if not found or t.used_at is not null or t.created_at < now() - interval '30 minutes' then
      raise exception 'This live photo has expired or was already used. Take a new one.' using hint = 'NOT_LIVE';
    end if;
    select o.created_at into v_uploaded from storage.objects o where o.bucket_id = 'media' and o.name = m.path;
    if v_uploaded is null or v_uploaded < t.created_at
       or v_uploaded > t.created_at + make_interval(secs => s.live_capture_seconds) then
      raise exception 'Live photos must be taken and sent within % seconds. Take a new one.', s.live_capture_seconds
        using hint = 'NOT_LIVE';
    end if;
    if not ST_DWithin(t.location, p_point, s.emergency_verify_radius_m) then
      raise exception 'This photo was taken more than % m from the emergency', s.emergency_verify_radius_m
        using hint = 'TOO_FAR';
    end if;
    update capture_tokens set used_at = now() where id = t.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'path', m.path, 'type', m.type, 'live', true, 'code', t.code, 'taken_at', t.created_at));
  end loop;
  return v_out;
end $$;
