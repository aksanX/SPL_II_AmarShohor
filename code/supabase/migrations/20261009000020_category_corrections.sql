-- =====================================================================
-- AmarShohor — 0020: wrong categories ("pothole" with a photo of a fire)
--
-- The people who saw an issue decide what it is, an admin settles disputes.
--
-- 1. On-site confirmation asks "Is this a <category>?". "No, it's …" still
--    counts as support (the problem is there) and as a vote for the other
--    category.
-- 2. Anyone can report "wrong category / photo doesn't match" and pick what
--    it really shows. This is a correction, not a "fake" flag: it never
--    counts towards hiding the report.
-- 3. When recategorize_confirms on-site confirmers or recategorize_votes
--    people in total pick the same other category, and they outnumber the
--    confirmers who said the category is right, and no other suggestion ties
--    with it, the issue switches before anyone works on it: severity, route
--    (volunteers / City Corporation) and the volunteer safety rules follow
--    the new category. Automatic moves only ever go towards the City
--    Corporation, never back to volunteers.
--    Disputed suggestions, or issues already being worked on, go to the
--    admin as a "category_mismatch" review instead.
-- 4. After an admin decides, only suggestions made later count.
-- 5. Honest mistakes cost no reputation.
-- =====================================================================

set search_path = public, extensions;

alter table app_settings
  add column recategorize_confirms int not null default 2,
  add column recategorize_votes    int not null default 3;

alter table issues add column category_decided_at timestamptz;  -- last admin decision on the category

create table category_suggestions (
  issue_id   uuid not null references issues(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  category   text not null references categories(slug) on delete cascade,
  on_site    boolean not null default false,   -- given with an on-site confirmation
  note       text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);
create index category_suggestions_issue_idx on category_suggestions (issue_id, category);
alter table category_suggestions enable row level security;  -- read through get_category_votes

-- ---------- Switching category -----------------------------------------
-- Used by the community rule and by the admin. Keeps severity, route and
-- safety rules in step with the category.
create or replace function change_issue_category(p_issue uuid, p_category text, p_actor uuid, p_note text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  i issues;
  c categories;
  v_old text;
begin
  select * into i from issues where id = p_issue for update;
  select * into c from categories where slug = p_category and is_active;
  if not found then raise exception 'Unknown category' using hint = 'BAD_CATEGORY'; end if;
  if i.category = p_category then return; end if;
  v_old := i.category;

  -- base_severity follows the category; severity votes (3+) still win in recompute_issue.
  update issues set category = c.slug, base_severity = c.default_severity, updated_at = now() where id = p_issue;

  -- Route. An admin's choice stays. Otherwise follow the category, but only
  -- move work towards the City Corporation automatically.
  if i.route_source is distinct from 'admin' then
    if i.status = 'community_review' then
      -- default_unsafe_to_authority (0011) still turns unsafe work to the authority.
      update issues set route = c.resolver::text::issue_route, route_source = 'category' where id = p_issue;
    elsif i.status = 'validated' and i.route <> 'authority'
          and (c.resolver = 'authority' or not c.volunteer_allowed) then
      perform escalate_issue(p_issue, p_actor,
        format('Category changed to %s: this is City Corporation work', c.name));
    end if;
  end if;

  -- Suggestions for the new category are now satisfied; people who confirmed
  -- without a suggestion confirmed the old category.
  delete from category_suggestions where issue_id = p_issue and category = c.slug;
  insert into category_suggestions (issue_id, user_id, category, on_site, created_at)
  select x.issue_id, x.user_id, v_old, true, x.created_at
    from confirmations x
   where x.issue_id = p_issue and v_old is not null
     and not exists (select 1 from category_suggestions s where s.issue_id = p_issue and s.user_id = x.user_id)
  on conflict do nothing;

  perform log_event(p_issue, p_actor, 'recategorized', p_note,
    jsonb_build_object('from', v_old, 'to', c.slug));
  perform notify_audience(p_issue, 'recategorized', p_actor,
    format('"%s" is now listed as %s. %s', i.title, c.name, coalesce(p_note, '')));
  perform recompute_issue(p_issue);
end $$;

-- ---------- The community rule ------------------------------------------
create or replace function apply_category_votes(p_issue uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  i issues;
  v_yes int;          -- on-site confirmers who said the category is right
  v_total int;        -- all suggestions for other categories
  best record;
  v_second int;
  v_reached boolean;
  v_can_switch boolean;
  v_tally jsonb;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue;
  if not found or i.status in ('closed', 'hidden', 'expired') then return; end if;

  select count(*) into v_yes from confirmations x
   where x.issue_id = p_issue
     and not exists (select 1 from category_suggestions g
                      where g.issue_id = p_issue and g.user_id = x.user_id and g.category <> i.category);

  with t as (
    select category, count(*)::int as votes, count(*) filter (where on_site)::int as on_site
      from category_suggestions
     where issue_id = p_issue and category is distinct from i.category
       and created_at > coalesce(i.category_decided_at, '-infinity')
     group by category
  )
  select coalesce(sum(votes), 0)::int,
         coalesce(jsonb_agg(jsonb_build_object('category', category, 'votes', votes, 'on_site', on_site)
                            order by votes desc), '[]')
    into v_total, v_tally from t;
  if v_total = 0 then return; end if;

  select category, count(*)::int as votes, count(*) filter (where on_site)::int as on_site into best
    from category_suggestions
   where issue_id = p_issue and category is distinct from i.category
     and created_at > coalesce(i.category_decided_at, '-infinity')
   group by category
   order by count(*) desc, count(*) filter (where on_site) desc
   limit 1;
  select coalesce(max(n), 0) into v_second from (
    select count(*)::int as n from category_suggestions
     where issue_id = p_issue and category is distinct from i.category and category <> best.category
       and created_at > coalesce(i.category_decided_at, '-infinity')
     group by category) x;

  v_reached := best.on_site >= s.recategorize_confirms or best.votes >= s.recategorize_votes;
  v_can_switch := i.status in ('community_review', 'validated', 'escalated')
                  and best.votes > v_yes and best.votes > v_second;

  if v_reached and v_can_switch then
    perform change_issue_category(p_issue, best.category, null,
      format('Changed by neighbours: %s people say it is %s.', best.votes,
             (select name from categories where slug = best.category)));
    perform resolve_reviews(p_issue, array['category_mismatch']::review_kind[], null, 'community', 'Neighbours agreed on the category');
  elsif v_reached or v_total >= 2 then
    -- Disputed, or already being worked on: an admin looks at the photo and decides.
    perform open_review(p_issue, 'category_mismatch', null, null,
      jsonb_build_object('suggestions', v_tally, 'confirmed_as_is', v_yes));
    update review_items set data = jsonb_build_object('suggestions', v_tally, 'confirmed_as_is', v_yes)
     where issue_id = p_issue and kind = 'category_mismatch' and status = 'open';
  end if;
end $$;

-- ---------- Confirm on site, with "is this a <category>?" ----------------
-- Same as 0002, plus p_category: null or the issue's category = "yes, that's it",
-- another category = "no, it's actually …".
drop function if exists confirm_issue(uuid, double precision, double precision, real, text, jsonb);
create function confirm_issue(
  p_issue uuid, p_lat double precision, p_lng double precision, p_accuracy_m real,
  p_note text, p_media jsonb, p_category text default null
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  s app_settings;
  i issues;
  v_here geography := make_point(p_lat, p_lng);
  v_dist double precision;
  v_event bigint;
  v_other text;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.reporter_id = v_user then
    raise exception 'You reported this issue yourself' using hint = 'OWN_ISSUE';
  end if;
  if i.status not in ('community_review', 'validated', 'assigned', 'in_progress') then
    raise exception 'This issue can no longer be confirmed' using hint = 'LOCKED';
  end if;
  if exists (select 1 from confirmations where issue_id = p_issue and user_id = v_user) then
    raise exception 'You already confirmed this issue' using hint = 'ALREADY_CONFIRMED';
  end if;
  if v_here is null then
    raise exception 'Your location is needed to confirm an issue' using hint = 'LOCATION_REQUIRED';
  end if;
  v_other := nullif(p_category, i.category);
  if v_other is not null and not exists (select 1 from categories where slug = v_other and is_active) then
    raise exception 'Unknown category' using hint = 'BAD_CATEGORY';
  end if;

  v_dist := ST_Distance(v_here, i.location);
  if v_dist > s.confirm_radius_m + least(coalesce(p_accuracy_m, 0), 100) then
    raise exception 'You need to be within % m of the issue to confirm it (you are % m away)',
      s.confirm_radius_m, round(v_dist) using hint = 'TOO_FAR';
  end if;

  delete from votes where issue_id = p_issue and user_id = v_user;
  insert into confirmations (issue_id, user_id, note, distance_m, weight)
  values (p_issue, v_user, coalesce(trim(p_note), ''), v_dist,
          voter_weight(v_user, i.location, v_here) * s.confirmation_multiplier);

  v_event := log_event(p_issue, v_user, 'confirmed', nullif(trim(p_note), ''),
                       jsonb_build_object('distance_m', round(v_dist), 'says_category', v_other));
  perform attach_media(p_issue, v_user, 'confirmation', p_media, v_event, 1, true);

  if v_other is not null then
    insert into category_suggestions (issue_id, user_id, category, on_site, note)
    values (p_issue, v_user, v_other, true, coalesce(trim(p_note), ''))
    on conflict (issue_id, user_id) do update
      set category = excluded.category, on_site = true, note = excluded.note, created_at = now();
  else
    delete from category_suggestions where issue_id = p_issue and user_id = v_user;
  end if;

  insert into follows (issue_id, user_id) values (p_issue, v_user) on conflict do nothing;
  update issues set follower_count = (select count(*) from follows where issue_id = p_issue) where id = p_issue;

  perform notify(i.reporter_id, 'issue_confirmed', p_issue, v_user,
    case when v_other is null then format('Someone confirmed "%s" on-site with a photo.', i.title)
         else format('Someone confirmed "%s" on-site but says it is %s.', i.title,
                     (select name from categories where slug = v_other)) end);
  perform recompute_issue(p_issue);
  perform apply_category_votes(p_issue);
end $$;

-- ---------- "Wrong category / photo doesn't match" ----------------------
create or replace function suggest_category(p_issue uuid, p_category text, p_note text default '')
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
  v_on_site boolean;
begin
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if i.status in ('closed', 'hidden', 'expired') then
    raise exception 'This issue is closed' using hint = 'LOCKED';
  end if;
  if p_category = i.category then
    raise exception 'That is already its category' using hint = 'SAME_CATEGORY';
  end if;
  if not exists (select 1 from categories where slug = p_category and is_active) then
    raise exception 'Unknown category' using hint = 'BAD_CATEGORY';
  end if;
  if i.reporter_id = v_user and i.status = 'community_review' then
    raise exception 'You can change the category yourself: edit the report' using hint = 'EDIT_INSTEAD';
  end if;

  -- Someone who confirmed on site keeps their on-site weight.
  v_on_site := exists (select 1 from confirmations where issue_id = p_issue and user_id = v_user);
  insert into category_suggestions (issue_id, user_id, category, on_site, note)
  values (p_issue, v_user, p_category, v_on_site, coalesce(trim(p_note), ''))
  on conflict (issue_id, user_id) do update
    set category = excluded.category, note = excluded.note, created_at = now();

  perform notify(i.reporter_id, 'category_suggested', p_issue, null,
    format('Someone says your report "%s" looks like %s, not %s.', i.title,
           (select name from categories where slug = p_category),
           coalesce((select name from categories where slug = i.category), 'its category')));
  perform apply_category_votes(p_issue);
end $$;

create or replace function withdraw_category_suggestion(p_issue uuid) returns void
language sql security definer set search_path = public, extensions as $$
  delete from category_suggestions where issue_id = p_issue and user_id = require_user()
$$;

-- What people say this issue is (shown on the issue page).
create or replace function get_category_votes(p_issue uuid)
returns table (category text, name text, votes int, on_site int, mine boolean)
language sql stable security definer set search_path = public, extensions as $$
  select g.category, c.name, count(*)::int, count(*) filter (where g.on_site)::int,
         bool_or(g.user_id = auth.uid())
    from category_suggestions g
    join issues i on i.id = g.issue_id
    join categories c on c.slug = g.category
   where g.issue_id = p_issue and g.category is distinct from i.category
     and g.created_at > coalesce(i.category_decided_at, '-infinity')
   group by g.category, c.name
   order by count(*) desc
$$;

-- ---------- Admin: settle a category dispute -----------------------------
-- p_category null = keep the current one. Either way, only later suggestions count.
create or replace function admin_decide_category(p_issue uuid, p_category text, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  i issues;
begin
  select * into i from issues where id = p_issue;
  if not found then raise exception 'Issue not found' using hint = 'NOT_FOUND'; end if;
  if p_category is not null and p_category <> coalesce(i.category, '') then
    perform change_issue_category(p_issue, p_category, v_admin, v_reason);
  else
    perform log_event(p_issue, v_admin, 'category_kept', v_reason, jsonb_build_object('category', i.category));
  end if;
  update issues set category_decided_at = now() where id = p_issue;
  perform resolve_reviews(p_issue, array['category_mismatch']::review_kind[], v_admin,
    case when p_category is null then 'kept' else 'category:' || p_category end, v_reason);
  perform log_admin(v_admin, 'decide_category', p_issue, null, v_reason,
    jsonb_build_object('from', i.category, 'to', coalesce(p_category, i.category)));
end $$;

-- ---------- Permissions (0010 revoked everything by default) ------------
revoke execute on function
  change_issue_category(uuid, text, uuid, text),
  apply_category_votes(uuid),
  confirm_issue(uuid, double precision, double precision, real, text, jsonb, text),
  suggest_category(uuid, text, text),
  withdraw_category_suggestion(uuid),
  get_category_votes(uuid),
  admin_decide_category(uuid, text, text)
from public, anon, authenticated;

grant execute on function get_category_votes(uuid) to anon, authenticated;
grant execute on function
  confirm_issue(uuid, double precision, double precision, real, text, jsonb, text),
  suggest_category(uuid, text, text),
  withdraw_category_suggestion(uuid),
  admin_decide_category(uuid, text, text)
to authenticated;
