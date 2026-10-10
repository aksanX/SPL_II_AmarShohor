-- =====================================================================
-- AmarShohor — 42. Old notifications are cleared
--
-- Every vote, comment and status change notifies several people, and
-- nothing was ever deleted, so the table only grew. Now:
--   read notifications older than notification_read_days (90)   are deleted;
--   unread ones older than notification_unread_days (365)        too.
-- Issues, timelines and admin logs are not touched: they are the record.
-- =====================================================================

set search_path = public, extensions;

alter table app_settings
  add column notification_read_days   int not null default 90  check (notification_read_days >= 7),
  add column notification_unread_days int not null default 365 check (notification_unread_days >= 30);

create index if not exists notifications_created_idx on notifications (created_at);

create or replace function cleanup_old_notifications() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  n int;
begin
  select * into s from app_settings where id = 1;
  delete from notifications
   where (read_at is not null and created_at < now() - make_interval(days => s.notification_read_days))
      or created_at < now() - make_interval(days => s.notification_unread_days);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function cleanup_old_notifications() from public, anon, authenticated;
