-- =====================================================================
-- AmarShohor — 39. Admin report of uploads nobody uses
--
-- A photo is uploaded first and attached to a report after. If the report
-- is then refused (or the browser closes), the file stays in Storage and
-- counts against the free plan's 1 GB. The app now deletes such files
-- itself when it can; this report shows the admin what is left.
-- Files younger than a day are skipped: someone may be posting right now.
-- Deleting goes through the Storage API (the admin page does that), never
-- by deleting rows here, which would leave the files behind.
-- =====================================================================

set search_path = public, extensions;

create or replace function admin_unused_uploads(p_limit int default 200)
returns table (path text, size_bytes bigint, uploaded_at timestamptz)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform require_admin();
  return query
  select o.name, coalesce((o.metadata ->> 'size')::bigint, 0), o.created_at
    from storage.objects o
   where o.bucket_id = 'media'
     and o.created_at < now() - interval '1 day'
     and not media_in_use(o.name)
   order by o.created_at
   limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end $$;

revoke execute on function admin_unused_uploads(int) from public, anon;
grant execute on function admin_unused_uploads(int) to authenticated;
