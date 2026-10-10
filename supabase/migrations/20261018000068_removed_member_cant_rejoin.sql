-- =====================================================================
-- AmarShohor — 68. A member the leader removed can't rejoin
--
-- 0067 let the leader remove a member who never came, but join_team simply
-- re-activates anyone who left, so the removed member could join again at
-- once. Now a removal is remembered (removed_at) and rejoining that task's
-- team is refused. Members who left on their own can still come back.
-- =====================================================================

set search_path = public, extensions;

alter table assignment_members add column if not exists removed_at timestamptz;

-- Same as 0067, plus removed_at.
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
  perform log_event(p_issue, a.volunteer_id, 'team_removed', null, jsonb_build_object('user_id', p_user));
  perform notify(p_user, 'team_removed', p_issue, a.volunteer_id,
    format('The leader removed you from the team for "%s". No penalty.', v_title));
end $$;

-- join_team re-activates a member who left (on conflict ... set left_at = null): refuse it after a removal.
create or replace function guard_removed_member_rejoin() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if old.removed_at is not null and old.left_at is not null and new.left_at is null then
    raise exception 'The leader removed you from this team, so you can''t join it again' using hint = 'REMOVED_FROM_TEAM';
  end if;
  return new;
end $$;

drop trigger if exists assignment_members_no_rejoin on assignment_members;
create trigger assignment_members_no_rejoin before update on assignment_members
  for each row execute function guard_removed_member_rejoin();

-- ---------- Who may run what (0041) -------------------------------------
revoke execute on function guard_removed_member_rejoin() from public, anon, authenticated;
