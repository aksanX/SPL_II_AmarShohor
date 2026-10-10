-- =====================================================================
-- AmarShohor — 43. Run the notification cleanup every week
-- (Sunday 03:30 Dhaka time = 21:30 UTC on Saturday.)
-- =====================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('amarshohor-weekly-cleanup', '30 21 * * 6', 'select public.cleanup_old_notifications()');
  else
    raise notice 'pg_cron is not enabled: schedule public.cleanup_old_notifications() to run weekly.';
  end if;
end $$;
