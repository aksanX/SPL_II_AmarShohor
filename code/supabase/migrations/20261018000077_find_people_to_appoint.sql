-- =====================================================================
-- AmarShohor — 77. Find the person to appoint
--
-- Appointing an area admin needed the person's exact username. Super admins
-- can now type part of a username or name and pick the person from a list
-- (photo, name, @username, area, and any role they already have). Deleted
-- accounts aren't listed. Only super admins can search: ordinary users
-- can't list everyone.
-- =====================================================================

set search_path = public, extensions;

create or replace function admin_find_people(p_query text)
returns table (username text, full_name text, avatar_url text, area_name text, roles text, pending_official boolean)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_q text := lower(trim(coalesce(p_query, '')));
  v_like text;
begin
  perform require_admin();
  if char_length(v_q) < 2 then return; end if;
  -- Typed % and _ are letters here, not wildcards.
  v_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select p.username, coalesce(p.full_name, ''), p.avatar_url, coalesce(p.area_name, ''),
           (select string_agg(r.role::text, ',' order by r.role::text) from user_roles r where r.user_id = p.id),
           is_pending_official(p.id)
      from profiles p
     where p.deleted_at is null
       and (p.username like v_like || '%' or lower(coalesce(p.full_name, '')) like '%' || v_like || '%')
     order by p.username = v_q desc, p.username like v_like || '%' desc, p.username
     limit 8;
end $$;

revoke execute on function admin_find_people(text) from public, anon;
grant execute on function admin_find_people(text) to authenticated;
