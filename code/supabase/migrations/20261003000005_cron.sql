-- =====================================================================
-- AmarShohor — 5. Scheduled maintenance
-- Every 15 minutes: lock reminders, expired volunteer locks, auto-closing
-- undisputed resolutions, expiring never-validated reports.
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('amarshohor-maintenance', '*/15 * * * *', 'select public.run_maintenance()');
  else
    raise notice 'pg_cron is not available. Enable it (Dashboard → Database → Extensions) and re-run this file.';
  end if;
end $$;
