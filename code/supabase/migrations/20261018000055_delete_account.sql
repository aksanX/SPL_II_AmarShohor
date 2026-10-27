-- =====================================================================
-- AmarShohor — 55. "Delete my account"
--
-- People must be able to leave and take their personal details with them.
-- Deleting the login outright (auth.users) would cascade through
-- profiles and erase every report, photo, confirmation and vote the
-- person ever made, including issues that neighbours are still
-- following and volunteers are fixing. So instead the account is
-- emptied and closed:
--   * the profile loses its name, picture, bio and area and gets a
--     meaningless username (deleted_xxxxxxxxxx);
--   * their reports become anonymous; comments, votes and photos stay,
--     no longer tied to a name;
--   * home location, notifications, roles and pending live-photo codes
--     are removed;
--   * the login is closed: email and password are wiped, so the same
--     email can sign up again as a new person, and sessions end.
-- Someone who is fixing an issue must finish or release it first, so a
-- task is never left locked by a ghost. The last admin can't leave.
-- =====================================================================

set search_path = public, extensions;

alter table profiles add column deleted_at timestamptz;

-- Same as 0002, and a deleted account can no longer act (its last
-- access token keeps working for up to an hour after deletion).
create or replace function require_user() returns uuid
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v uuid := auth.uid();
  v_deleted timestamptz;
begin
  if v is null then
    raise exception 'Please log in first' using hint = 'NOT_AUTHENTICATED';
  end if;
  select deleted_at into v_deleted from profiles where id = v;
  if not found then
    raise exception 'Your profile is missing. Please log out and in again.' using hint = 'NO_PROFILE';
  end if;
  if v_deleted is not null then
    raise exception 'This account was deleted' using hint = 'ACCOUNT_DELETED';
  end if;
  return v;
end $$;

create or replace function delete_my_account(p_confirm text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  v_name text;
begin
  select username into v_name from profiles where id = v_user;
  if p_confirm is distinct from v_name then
    raise exception 'Type your username to confirm' using hint = 'CONFIRM_MISMATCH';
  end if;
  if exists (select 1 from assignments where volunteer_id = v_user and outcome = 'active')
     or exists (select 1 from assignment_members m join assignments a on a.id = m.assignment_id
                 where m.user_id = v_user and m.left_at is null and a.outcome = 'active') then
    raise exception 'You are working on a task. Finish it, release it or leave the team first.' using hint = 'HAS_TASKS';
  end if;
  if exists (select 1 from user_roles where user_id = v_user and role = 'admin')
     and (select count(*) from user_roles r join profiles p on p.id = r.user_id
           where r.role = 'admin' and p.deleted_at is null) <= 1 then
    raise exception 'You are the only admin. Make someone else an admin first.' using hint = 'LAST_ADMIN';
  end if;

  update profiles
     set username = 'deleted_' || substr(md5(v_user::text), 1, 10),
         full_name = '', avatar_url = null, bio = '', area_name = '',
         is_volunteer = false, deleted_at = now()
   where id = v_user;
  update user_settings set home_location = null, show_on_leaderboard = false, default_anonymous = true
   where user_id = v_user;
  update issues set is_anonymous = true where reporter_id = v_user;
  delete from notifications where user_id = v_user;
  delete from capture_tokens where user_id = v_user;
  delete from user_roles where user_id = v_user;

  -- Close the login. Supabase's auth tables; skipped where they don't exist (local tests).
  update auth.users set email = v_user || '@deleted.invalid', raw_user_meta_data = '{}'::jsonb where id = v_user;
  begin
    execute 'update auth.users set phone = null, encrypted_password = '''',
               banned_until = now() + interval ''100 years'' where id = $1' using v_user;
    execute 'delete from auth.identities where user_id = $1' using v_user;
    execute 'delete from auth.sessions where user_id = $1' using v_user;
  exception when undefined_column or undefined_table then
    null;
  end;
end $$;

revoke execute on function delete_my_account(text) from public, anon;
grant execute on function delete_my_account(text) to authenticated;
