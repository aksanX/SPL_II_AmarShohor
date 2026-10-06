-- =====================================================================
-- AmarShohor — 22. Dangerous work never stays with volunteers
--
-- 0011 stops anyone from *sending* a dangerous issue to volunteers. Since
-- 0020 the category itself can change later (community corrections, admin
-- category decisions), so an issue can also *become* dangerous while it is
-- with volunteers, for example an admin sent "garbage" to volunteers and
-- neighbours then correct it to "open manhole". It can also come back to
-- the volunteer pool after an admin rejects an escalation request.
--
-- Rule: at the end of every operation, an issue that is with volunteers
-- (open, or being worked on) in a category too dangerous for volunteers is
-- sent to the City Corporation. A volunteer already on it is told to stop,
-- with no penalty.
-- =====================================================================

set search_path = public, extensions;

-- Fire hazards (dry brush, gas cylinders, ...) need trained crews.
update categories set volunteer_allowed = false, resolver = 'authority' where slug = 'fire_hazard';

create or replace function move_unsafe_to_authority(p_issue uuid) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  i issues;
  v_name text;
begin
  select * into i from issues where id = p_issue for update;
  if not found or i.route <> 'community' or not is_unsafe_for_volunteers(i.category) then
    return false;
  end if;
  select name into v_name from categories where slug = i.category;

  if i.status = 'community_review' then
    update issues set route = 'authority' where id = p_issue;  -- escalates on validation
    return true;
  end if;
  if i.status not in ('validated', 'assigned', 'in_progress') then
    -- fix already submitted, under admin review, or finished: leave it to that process
    return false;
  end if;

  if i.status in ('assigned', 'in_progress') then
    perform end_assignment(p_issue, 'rerouted');
    insert into notifications (user_id, type, issue_id, message)
    select u, 'rerouted', p_issue,
           format('Please stop work on "%s": it is now listed as %s, which is too dangerous for volunteers. '
                  'It went to the City Corporation. No penalty.', i.title, v_name)
      from (select i.volunteer_id as u
            union
            select m.user_id from assignment_members m where m.assignment_id = i.assignment_id and m.left_at is null) x
     where u is not null;
  end if;

  perform escalate_issue(p_issue, null, format('%s is too dangerous for volunteers', v_name));
  return true;
end $$;

-- Runs at the end of the operation, after functions like admin_set_route or
-- change_issue_category have finished their own routing, so nothing is
-- escalated twice.
create or replace function enforce_safe_route() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform move_unsafe_to_authority(new.id);
  return null;
end $$;

create constraint trigger issues_enforce_safe_route
  after update of category, status, route on issues
  deferrable initially deferred
  for each row execute function enforce_safe_route();

-- Existing issues in categories that are now too dangerous.
do $$
declare r record;
begin
  for r in
    select i.id from issues i join categories c on c.slug = i.category
     where not c.volunteer_allowed and i.route = 'community'
       and i.status in ('community_review', 'validated', 'assigned', 'in_progress')
  loop
    perform move_unsafe_to_authority(r.id);
  end loop;
end $$;

revoke execute on function move_unsafe_to_authority(uuid), enforce_safe_route() from public, anon, authenticated;
