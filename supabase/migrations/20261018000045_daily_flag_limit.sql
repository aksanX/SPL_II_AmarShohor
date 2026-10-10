-- =====================================================================
-- AmarShohor — 45. A daily limit on flags
--
-- Reports, comments and emergencies already have rate limits; flags had
-- none. Flags weigh against a report (enough of them hide it, and a false
-- report costs its author reputation), so one account flagging everything
-- in sight could bury a whole area's reports in an evening.
--
-- Now each person can flag at most max_flags_per_day reports and comments
-- (together) in 24 hours. Changing the reason on a flag you already gave
-- doesn't count again.
-- =====================================================================

set search_path = public, extensions;

alter table app_settings add column max_flags_per_day int not null default 30;

create or replace function limit_daily_flags() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_max int;
  v_today int;
begin
  -- A flag that already exists is only being updated.
  if tg_table_name = 'flags' then
    if exists (select 1 from flags where issue_id = new.issue_id and user_id = new.user_id) then return new; end if;
  elsif exists (select 1 from comment_flags where comment_id = new.comment_id and user_id = new.user_id) then
    return new;
  end if;
  select max_flags_per_day into v_max from app_settings where id = 1;
  select (select count(*) from flags where user_id = new.user_id and created_at > now() - interval '1 day')
       + (select count(*) from comment_flags where user_id = new.user_id and created_at > now() - interval '1 day')
    into v_today;
  if v_today >= v_max then
    raise exception 'You can flag at most % posts a day. Try again tomorrow.', v_max using hint = 'RATE_LIMIT';
  end if;
  return new;
end $$;

create index if not exists flags_user_time_idx on flags (user_id, created_at desc);
create index if not exists comment_flags_user_time_idx on comment_flags (user_id, created_at desc);

create trigger flags_daily_limit before insert on flags
  for each row execute function limit_daily_flags();
create trigger comment_flags_daily_limit before insert on comment_flags
  for each row execute function limit_daily_flags();

revoke execute on function limit_daily_flags() from public, anon, authenticated;
