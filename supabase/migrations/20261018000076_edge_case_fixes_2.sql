-- =====================================================================
-- AmarShohor — 76. Edge cases found in review (second round)
--
-- 1. An issue is never left with a switched-off City Corporation. "Leave as
--    is" on an official's send-back, or an official releasing it as busy,
--    used to put it back with a City Corporation switched off in the
--    meantime: its officials can't take it and no admin case was left, so
--    it waited forever. Now it goes to an active City Corporation that
--    covers the place, or waits in the admin queue ("No City Corporation"),
--    the same as when a City Corporation is switched off (0033).
-- 2. Remove (Admin → Officials & admins) closes the account the way
--    "Delete my account" does (0055) instead of deleting it. Deleting it
--    erased the person's tasks: a fix waiting for residents could no longer
--    be confirmed, and the City Corporation's public record lost every fix
--    the official made. The person also leaves any volunteer team.
-- 3. Nobody becomes an official or an admin while working on a volunteer
--    task (leading it or in its team). They finish, release or leave it
--    first, as when turning volunteer mode off.
-- 4. A deleted account can't get a role, and deleting an account closes
--    its pending official sign-up, so an admin can't approve it.
-- 5. A City Corporation's official email domain can't be a public email
--    provider (gmail.com, yahoo.com, ...): every citizen with that provider
--    would be refused at sign-up. gov.bd and its subdomains stay allowed.
-- 6. The issue says whether its team is still looking for people
--    (recruiting, 0074), so the app shows "Ask for more volunteers" after
--    the leader removes a no-show from a closed team.
-- 7. Removing a member also withdraws a lead offer made to them.
-- Same as 0069 (admin_delete_account), 0068 (remove_team_member) and 0031
-- (issues_v) otherwise.
-- =====================================================================

set search_path = public, extensions;

-- ---------- 1. Not with a switched-off City Corporation ----------------
create or replace function reroute_off_inactive_authority() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare a authorities;
begin
  select * into a from authorities where id = new.authority_id;
  if not found or a.is_active then return null; end if;
  update issues set authority_id = null, due_at = null, overdue_notified = false where id = new.id;
  perform escalate_issue(new.id, null, format('%s is switched off in AmarShohor', a.short_name));
  return null;
end $$;

drop trigger if exists issues_reroute_off_inactive on issues;
create trigger issues_reroute_off_inactive
  after insert or update of status, authority_id on issues
  for each row when (new.status = 'escalated' and new.route = 'authority' and new.authority_id is not null)
  execute function reroute_off_inactive_authority();

-- ---------- 2. Remove closes the account ------------------------------
-- The same as delete_my_account (0055) does after its checks.
create or replace function close_account(p_user uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update profiles
     set username = 'deleted_' || substr(md5(p_user::text), 1, 10),
         full_name = '', avatar_url = null, bio = '', area_name = '',
         is_volunteer = false, deleted_at = now()
   where id = p_user;
  update user_settings set home_location = null, show_on_leaderboard = false, default_anonymous = true
   where user_id = p_user;
  update issues set is_anonymous = true where reporter_id = p_user;
  delete from notifications where user_id = p_user;
  delete from capture_tokens where user_id = p_user;
  delete from user_roles where user_id = p_user;

  -- Close the login. Supabase's auth tables; skipped where they don't exist (local tests).
  update auth.users set email = p_user || '@deleted.invalid', raw_user_meta_data = '{}'::jsonb where id = p_user;
  begin
    execute 'update auth.users set phone = null, encrypted_password = '''',
               banned_until = now() + interval ''100 years'' where id = $1' using p_user;
    execute 'delete from auth.identities where user_id = $1' using p_user;
    execute 'delete from auth.sessions where user_id = $1' using p_user;
  exception when undefined_column or undefined_table then
    null;
  end;
end $$;

create or replace function admin_delete_account(p_username text, p_role app_role) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_any_admin();
  v_target uuid;
  v_username text;
  v_authority uuid;
  t record;
begin
  select id, username into v_target, v_username from profiles where username = lower(trim(p_username));
  if v_target is null then raise exception 'No user with that username' using hint = 'NOT_FOUND'; end if;
  if v_target = v_admin then raise exception 'You can''t remove yourself' using hint = 'NOT_ALLOWED'; end if;
  select authority_id into v_authority from user_roles where user_id = v_target and role = p_role;
  if not found then raise exception 'That user doesn''t have this role' using hint = 'NOT_FOUND'; end if;
  if p_role = 'official' then
    if not is_admin(v_admin) then  -- super admins may remove any official
      perform require_area_admin_of(v_admin, v_authority);
    end if;
    if exists (select 1 from user_roles where user_id = v_target and role <> 'official') then
      raise exception 'Only super admins can remove admins and city admins' using hint = 'NOT_ADMIN';
    end if;
  elsif not is_admin(v_admin) then
    raise exception 'Only super admins can remove admins and city admins' using hint = 'NOT_ADMIN';
  end if;
  if exists (select 1 from user_roles where user_id = v_target and role = 'admin')
     and (select count(*) from user_roles where role = 'admin') <= 1 then
    raise exception 'There must always be at least one admin' using hint = 'LAST_ADMIN';
  end if;

  for t in select id from issues where volunteer_id = v_target and status in ('assigned', 'in_progress') loop
    perform end_assignment(t.id, 'released');
    perform return_to_pool(t.id);
    perform log_event(t.id, v_admin, 'released', 'The person working on it was removed', null);
  end loop;
  -- Teams they joined go on without them.
  for t in select a.id, a.issue_id from assignment_members m join assignments a on a.id = m.assignment_id
            where m.user_id = v_target and m.left_at is null and a.outcome = 'active' loop
    update assignment_members set left_at = now() where assignment_id = t.id and user_id = v_target;
    perform shrink_closed_team(t.id);
    perform log_event(t.issue_id, v_admin, 'team_left', 'The member''s account was removed', null);
  end loop;

  -- Roles first, so the user_roles triggers hand their open cases on (0048, 0051).
  delete from user_roles where user_id = v_target;
  if p_role = 'city_admin'
     and not exists (select 1 from user_roles where role = 'city_admin' and authority_id = v_authority) then
    update review_items x set passed_up_at = now()
      from issues i
     where i.id = x.issue_id and x.status = 'open' and x.passed_up_at is null
       and find_authority(i.location) = v_authority;
  end if;

  perform log_admin(v_admin, 'delete_' || p_role, null, null, null,
    jsonb_build_object('username', v_username)
      || case when v_authority is null then '{}'::jsonb
              else jsonb_build_object('authority', (select short_name from authorities where id = v_authority)) end);
  -- Closed, not deleted: their fixes, reports and the City Corporation's record stay.
  perform close_account(v_target);
end $$;

-- ---------- 3 + 4. Who can get a role ---------------------------------
create or replace function guard_new_role() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if exists (select 1 from profiles where id = new.user_id and deleted_at is not null) then
    raise exception 'This account was deleted' using hint = 'ACCOUNT_DELETED';
  end if;
  if exists (select 1 from assignments where volunteer_id = new.user_id and outcome = 'active' and role = 'volunteer')
     or exists (select 1 from assignment_members m join assignments a on a.id = m.assignment_id
                 where m.user_id = new.user_id and m.left_at is null and a.outcome = 'active') then
    raise exception 'This person is working on a volunteer task. They need to finish, release or leave it first.'
      using hint = 'HAS_ACTIVE_TASKS';
  end if;
  return new;
end $$;

drop trigger if exists user_roles_guard_new_role on user_roles;
create trigger user_roles_guard_new_role before insert on user_roles
  for each row execute function guard_new_role();

-- A deleted account's pending official sign-up is closed.
create or replace function close_requests_of_deleted_account() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  update role_requests set status = 'rejected', decided_at = now(), decision_note = 'The account was deleted'
   where user_id = new.id and status = 'pending';
  return null;
end $$;

drop trigger if exists profiles_close_requests_when_deleted on profiles;
create trigger profiles_close_requests_when_deleted
  after update of deleted_at on profiles
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function close_requests_of_deleted_account();

-- Pending requests of accounts deleted before this.
update role_requests q set status = 'rejected', decided_at = now(), decision_note = 'The account was deleted'
  from profiles p
 where p.id = q.user_id and p.deleted_at is not null and q.status = 'pending';

-- ---------- 5. No public email providers as an official domain ---------
create or replace function guard_authority_email_domain() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if lower(coalesce(new.email_domain, '')) in (
       'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com',
       'msn.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'zoho.com',
       'yandex.com', 'mail.com', 'gmx.com') then
    raise exception '% is a public email provider. Use the City Corporation''s official domain, e.g. dncc.gov.bd',
      new.email_domain using hint = 'BAD_DOMAIN';
  end if;
  return new;
end $$;

drop trigger if exists authorities_guard_email_domain on authorities;
create trigger authorities_guard_email_domain before insert or update of email_domain on authorities
  for each row execute function guard_authority_email_domain();

-- ---------- 7. Removing a member withdraws a lead offer to them --------
create or replace function remove_team_member(p_issue uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  a assignments := require_task_leader(p_issue);
  m assignment_members;
  v_title text := (select title from issues where id = p_issue);
begin
  select * into m from assignment_members where assignment_id = a.id and user_id = p_user and left_at is null for update;
  if not found then raise exception 'They are not in your team' using hint = 'NOT_MEMBER'; end if;
  if m.checked_in_at is not null then
    raise exception 'They came to the site, so they keep their place in the team' using hint = 'CHECKED_IN';
  end if;
  update assignment_members set left_at = now(), removed_at = now() where assignment_id = a.id and user_id = p_user;
  update assignments set lead_offer_to = null where id = a.id and lead_offer_to = p_user;
  perform log_event(p_issue, a.volunteer_id, 'team_removed', null, jsonb_build_object('user_id', p_user));
  perform notify(p_user, 'team_removed', p_issue, a.volunteer_id,
    format('The leader removed you from the team for "%s". No penalty.', v_title));
end $$;

-- ---------- 6. The issue says whether its team is recruiting -----------
-- Same view as 0031, plus `recruiting` at the end.
create or replace view issues_v as
select
  i.id, i.title, i.description, i.category,
  coalesce(c.name, 'Uncategorised') as category_name, coalesce(c.name_bn, '') as category_name_bn,
  coalesce(c.icon, 'circle-help') as category_icon, coalesce(c.color, '#64748b') as category_color,
  c.resolver,
  i.severity,
  ST_Y(i.location::geometry) as lat,
  ST_X(i.location::geometry) as lng,
  i.location_accuracy_m, i.location_source, i.address,
  i.status, i.is_anonymous,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else i.reporter_id end as reporter_id,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else rp.username end as reporter_username,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else rp.full_name end as reporter_full_name,
  case when i.is_anonymous and i.reporter_id is distinct from auth.uid() then null else rp.avatar_url end as reporter_avatar_url,
  coalesce(i.reporter_id = auth.uid(), false) as is_mine,
  i.upvote_count, i.confirmation_count, i.comment_count, i.follower_count, i.flag_count,
  i.validation_score, i.validation_threshold,
  i.volunteer_id, vp.username as volunteer_username, vp.full_name as volunteer_full_name,
  vp.avatar_url as volunteer_avatar_url,
  i.assigned_at, i.lock_expires_at, i.resolution_note, i.resolution_submitted_at,
  i.validated_at, i.closed_at, i.created_at, i.updated_at, i.last_activity_at,
  exists (select 1 from votes v where v.issue_id = i.id and v.user_id = auth.uid()) as my_vote,
  exists (select 1 from confirmations x where x.issue_id = i.id and x.user_id = auth.uid()) as my_confirmed,
  exists (select 1 from flags f where f.issue_id = i.id and f.user_id = auth.uid()) as my_flagged,
  exists (select 1 from follows f where f.issue_id = i.id and f.user_id = auth.uid()) as my_following,
  (select s.severity from severity_votes s where s.issue_id = i.id and s.user_id = auth.uid()) as my_severity_vote,
  (select r.is_fixed from resolution_reviews r where r.assignment_id = i.assignment_id and r.user_id = auth.uid()) as my_resolution_review,
  exists (select 1 from ratings r where r.assignment_id = i.assignment_id) as is_rated,
  coalesce((
    select json_agg(json_build_object('id', m.id, 'kind', m.kind, 'media_type', m.media_type, 'path', m.storage_path)
                    order by (m.kind = 'report') desc, m.created_at)
      from (select * from issue_media m2
             where m2.issue_id = i.id and m2.kind in ('report', 'confirmation')
             order by (m2.kind = 'report') desc, m2.created_at limit 6) m
  ), '[]'::json) as media,
  -- v2: routing
  i.size, i.route, i.route_source,
  -- v2: City Corporation
  i.authority_id, au.name as authority_name, au.short_name as authority_short_name,
  au.hotline as authority_hotline, au.complaint_url as authority_complaint_url,
  i.escalated_at, i.due_at,
  coalesce(i.due_at < now() and i.status in ('escalated', 'assigned', 'in_progress', 'resolution_submitted'), false) as is_overdue,
  i.complaint_ref,
  coalesce(a.role, 'volunteer') as assignee_role,
  coalesce(official_authority(auth.uid()) = i.authority_id, false) as i_am_official_here,
  -- v2: teams
  coalesce(a.team_size, 1) as team_size,
  (select count(*)::int from assignment_members m where m.assignment_id = a.id and m.left_at is null) as team_count,
  coalesce(is_team_member(a.id, auth.uid()), false) as my_team_member,
  exists (select 1 from assignment_members m where m.assignment_id = a.id and m.user_id = auth.uid()
           and m.left_at is null and m.checked_in_at is not null) as my_checked_in,
  coalesce(a.lead_offer_open, false) as lead_offer_open,
  coalesce(a.lead_offer_to = auth.uid(), false) as lead_offer_to_me,
  -- v2: waiting for an admin
  exists (select 1 from review_items r where r.issue_id = i.id and r.status = 'open') as pending_review,
  -- 0031: the viewer is an official of this issue's City Corporation or area
  coalesce(official_covers(auth.uid(), i.authority_id, i.location), false) as my_authority_covers,
  -- 0076: the team is still looking for people (0074)
  coalesce(a.recruiting, false) as recruiting
from issues i
left join categories c on c.slug = i.category
join profiles rp on rp.id = i.reporter_id
left join profiles vp on vp.id = i.volunteer_id
left join authorities au on au.id = i.authority_id
left join assignments a on a.id = i.assignment_id;

-- ---------- Who may run what (0041) -------------------------------------
revoke execute on function
  reroute_off_inactive_authority(), close_account(uuid), guard_new_role(),
  close_requests_of_deleted_account(), guard_authority_email_domain()
  from public, anon, authenticated;
