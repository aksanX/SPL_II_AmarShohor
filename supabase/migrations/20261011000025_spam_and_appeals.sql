-- =====================================================================
-- AmarShohor — 25. Spam has consequences, unfair flags count less, appeals
--
-- 1. A report hidden as fake costs the reporter reputation (given back if
--    it becomes visible again). 3 hidden reports in 30 days pause posting
--    for 7 days. Voting and commenting still work.
-- 2. Flag accuracy: people whose "fake / spam" flags keep landing on issues
--    the community validates anyway get less weight on future flags.
-- 3. Appeal: the reporter of a hidden report can ask an admin once. If the
--    admin restores it, the flags against it are set aside.
-- 4. Fix: a report hidden by an admin no longer comes back by itself when
--    someone upvotes it (the automatic rule only undoes automatic hiding).
-- =====================================================================

set search_path = public, extensions;

alter table app_settings
  add column rep_hidden_report      int not null default -10,  -- reporter, when a report is hidden
  add column spam_pause_hidden      int not null default 3,    -- hidden reports that trigger a pause…
  add column spam_pause_window_days int not null default 30,   -- …within this many days
  add column spam_pause_days        int not null default 7,    -- length of the posting pause
  add column flag_accuracy_min      int not null default 3;    -- decided flags before accuracy counts

alter table issues
  add column hidden_at       timestamptz,
  add column hidden_by_admin boolean not null default false,
  add column hide_penalized  boolean not null default false;

-- Flags an admin set aside on appeal. Kept so they still count against the
-- flagger's accuracy after the flags themselves are removed.
create table dismissed_flags (
  issue_id     uuid not null references issues(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  reason       flag_reason not null,
  flagged_at   timestamptz not null,
  dismissed_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);
alter table dismissed_flags enable row level security;

-- =====================================================================
-- 1. Consequences for hidden reports
-- =====================================================================

-- When posting is paused for this user, or null.
create or replace function posting_paused_until(p_user uuid) returns timestamptz
language sql stable security definer set search_path = public, extensions as $$
  select case when count(*) >= s.spam_pause_hidden
              then max(i.hidden_at) + make_interval(days => s.spam_pause_days) end
    from issues i cross join app_settings s
   where s.id = 1 and i.reporter_id = p_user and i.status = 'hidden'
     and i.hidden_at > now() - make_interval(days => s.spam_pause_window_days)
   group by s.spam_pause_hidden, s.spam_pause_days
$$;

create or replace function get_my_posting_pause() returns timestamptz
language sql stable security definer set search_path = public, extensions as $$
  select case when posting_paused_until(auth.uid()) > now() then posting_paused_until(auth.uid()) end
$$;

-- Every way a report gets hidden or un-hidden goes through this, so the
-- penalty is applied once and refunded once, whoever changed the status.
create or replace function hidden_report_consequences() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  v_until timestamptz;
begin
  select * into s from app_settings where id = 1;

  if new.status = 'hidden' and old.status is distinct from 'hidden' then
    new.hidden_at := now();
    if not old.hide_penalized then
      new.hide_penalized := true;
      update profiles set reputation = reputation + s.rep_hidden_report where id = new.reporter_id;
      perform notify(new.reporter_id, 'reputation_penalty', new.id, null,
        format('Your report "%s" was hidden as fake or misleading (%s reputation). It comes back, and the points too, if it turns out to be real.',
               new.title, s.rep_hidden_report));
    end if;
    -- This row isn't hidden yet in the table, so count it by hand.
    if (select count(*) from issues
         where reporter_id = new.reporter_id and status = 'hidden' and id <> new.id
           and hidden_at > now() - make_interval(days => s.spam_pause_window_days)) + 1 >= s.spam_pause_hidden then
      v_until := now() + make_interval(days => s.spam_pause_days);
      perform notify(new.reporter_id, 'posting_paused', new.id, null,
        format('%s of your reports were hidden in %s days, so you can''t post new reports until %s. You can still vote and comment.',
               s.spam_pause_hidden, s.spam_pause_window_days, to_char(v_until, 'DD Mon YYYY')));
    end if;

  elsif old.status = 'hidden' and new.status is distinct from 'hidden' then
    new.hidden_at := null;
    new.hidden_by_admin := false;
    if old.hide_penalized then
      new.hide_penalized := false;
      update profiles set reputation = reputation - s.rep_hidden_report where id = new.reporter_id;
      perform notify(new.reporter_id, 'reputation_restored', new.id, null,
        format('Your report "%s" is visible again (+%s reputation back).', new.title, -s.rep_hidden_report));
    end if;
  end if;
  return new;
end $$;

create trigger issues_hidden_report_consequences
  before update of status on issues
  for each row execute function hidden_report_consequences();

create or replace function guard_posting_pause() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  v_until timestamptz := posting_paused_until(new.reporter_id);
begin
  if v_until > now() then
    select * into s from app_settings where id = 1;
    raise exception '% of your reports were hidden as fake or spam in the last % days. You can post again on %. You can still vote and comment.',
      s.spam_pause_hidden, s.spam_pause_window_days, to_char(v_until, 'DD Mon YYYY')
      using hint = 'POSTING_PAUSED';
  end if;
  return new;
end $$;

create trigger issues_guard_posting_pause
  before insert on issues
  for each row execute function guard_posting_pause();

-- =====================================================================
-- 2. Flag accuracy
-- A "fake / spam" flag is judged wrong when the community validated the
-- issue anyway (and it isn't hidden), or an admin set it aside on appeal.
-- It is judged right when the issue is hidden. Other reasons (duplicate,
-- already fixed, wrong location...) can be right even on a real issue,
-- so they are not judged.
-- =====================================================================
create or replace function flag_accuracy_factor(p_user uuid) returns numeric
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s app_settings;
  v_right int;
  v_wrong int;
begin
  select * into s from app_settings where id = 1;
  select count(*) filter (where i.status = 'hidden'),
         count(*) filter (where i.status <> 'hidden' and i.validated_at is not null)
    into v_right, v_wrong
    from flags f join issues i on i.id = f.issue_id
   where f.user_id = p_user and f.reason in ('fake_or_scam', 'spam');
  v_wrong := v_wrong + (select count(*) from dismissed_flags
                         where user_id = p_user and reason in ('fake_or_scam', 'spam'));

  if v_right + v_wrong < s.flag_accuracy_min then return 1; end if;
  if v_wrong::numeric / (v_right + v_wrong) > 0.75 then return 0.25; end if;
  if v_wrong::numeric / (v_right + v_wrong) > 0.5 then return 0.5; end if;
  return 1;
end $$;

create or replace function apply_flag_accuracy() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  new.weight := greatest(round(new.weight * flag_accuracy_factor(new.user_id), 2), 0.01);
  return new;
end $$;

create trigger flags_apply_accuracy
  before insert on flags
  for each row execute function apply_flag_accuracy();

-- =====================================================================
-- 4. Admin hides stay hidden
-- Same as 0019, except the automatic un-hide skips reports an admin hid.
-- =====================================================================
create or replace function recompute_issue(p_issue uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  s app_settings;
  i issues;
  v_votes int; v_vote_w numeric;
  v_conf int;  v_conf_w numeric;
  v_flags int; v_flag_w numeric;
  v_sev severity_level;
  v_sev_votes int;
  v_threshold numeric;
  v_active_nearby int;
  v_score numeric;
  v_should_hide boolean;
begin
  select * into s from app_settings where id = 1;
  select * into i from issues where id = p_issue for update;
  if not found then return; end if;

  select count(*), coalesce(sum(weight), 0) into v_votes, v_vote_w from votes where issue_id = p_issue;
  select count(*), coalesce(sum(weight), 0) into v_conf, v_conf_w from confirmations where issue_id = p_issue;
  select count(*), coalesce(sum(weight), 0) into v_flags, v_flag_w from flags where issue_id = p_issue;

  -- Severity: category starting point until 3 people vote, then the median vote.
  select count(*) into v_sev_votes from severity_votes where issue_id = p_issue;
  if v_sev_votes >= 3 then
    select percentile_disc(0.5) within group (order by severity) into v_sev
      from severity_votes where issue_id = p_issue;
  else
    v_sev := coalesce(i.base_severity,
                      (select default_severity from categories where slug = i.category),
                      'medium');
  end if;
  -- A verified emergency on this issue: critical, whatever the votes say.
  if i.emergency_verified_at is not null then v_sev := 'critical'; end if;

  v_threshold := case v_sev
    when 'critical' then s.threshold_critical
    when 'high'     then s.threshold_high
    when 'medium'   then s.threshold_medium
    else s.threshold_low end;

  select count(distinct u) into v_active_nearby from (
    select v.user_id as u from votes v join issues x on x.id = v.issue_id
     where v.created_at > now() - interval '30 days'
       and ST_DWithin(x.location, i.location, s.local_radius_m)
    union
    select x.reporter_id from issues x
     where x.created_at > now() - interval '30 days'
       and ST_DWithin(x.location, i.location, s.local_radius_m)
  ) active;
  if v_active_nearby < s.low_activity_user_count then
    v_threshold := greatest(s.min_threshold, ceil(v_threshold * s.low_activity_factor));
  end if;

  v_score := v_vote_w + v_conf_w;
  v_should_hide := v_flags >= s.hide_min_flags and v_flag_w > v_score;

  update issues
     set upvote_count = v_votes, confirmation_count = v_conf, flag_count = v_flags,
         validation_score = v_score, flag_score = v_flag_w,
         severity = v_sev, validation_threshold = v_threshold, updated_at = now()
   where id = p_issue;

  -- Hide / unhide. Only before anyone takes the issue. An admin's hide is
  -- only undone by an admin (appeal), never by votes.
  if v_should_hide and i.status in ('community_review', 'validated', 'escalated') then
    update issues set status = 'hidden', status_before_hidden = i.status where id = p_issue;
    perform log_event(p_issue, null, 'hidden',
      'Hidden automatically: more people flagged it as fake than vouched for it',
      jsonb_build_object('flags', v_flags, 'flag_score', v_flag_w, 'score', v_score));
    perform notify(i.reporter_id, 'issue_hidden', p_issue, null,
      format('Your report "%s" was hidden because many people flagged it. Support from others can bring it back.', i.title));
    return;
  elsif not v_should_hide and i.status = 'hidden' and not i.hidden_by_admin then
    i.status := coalesce(i.status_before_hidden, 'community_review');
    update issues set status = i.status, status_before_hidden = null where id = p_issue;
    perform log_event(p_issue, null, 'unhidden', 'Visible again: community support now outweighs the flags', null);
  end if;

  if i.status = 'community_review'
     and ((v_score >= v_threshold and v_votes + v_conf >= s.min_supporters) or i.emergency_verified_at is not null) then
    update issues set status = 'validated', validated_at = now() where id = p_issue;
    if i.emergency_verified_at is not null and not (v_score >= v_threshold and v_votes + v_conf >= s.min_supporters) then
      perform log_event(p_issue, null, 'validated', 'Validated: people on site verified it as an emergency',
        jsonb_build_object('emergency_alert_id', i.emergency_alert_id));
    else
      perform log_event(p_issue, null, 'validated',
        format('Validated by the community (score %s of %s needed)', v_score, v_threshold),
        jsonb_build_object('score', v_score, 'threshold', v_threshold));
    end if;
    if i.route = 'authority' then
      perform escalate_issue(p_issue, null, null);
    elsif i.route = 'community' then
      perform notify_audience(p_issue, 'issue_validated', null,
        format('"%s" was validated by the community and is now open for volunteers.', i.title));
    else
      perform notify_audience(p_issue, 'issue_validated', null,
        format('"%s" was validated. An admin is deciding whether volunteers or the City Corporation should fix it.', i.title));
    end if;
  end if;
end $$;

-- Same as v2, except an admin's "fake / wrong place" hide is marked as such.
create or replace function admin_decide_wrong_report(p_issue uuid, p_outcome text, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  s app_settings;
  r review_items;
  i issues;
begin
  select * into s from app_settings where id = 1;
  select * into r from review_items where issue_id = p_issue and kind = 'wrong_issue' and status = 'open';
  if not found then raise exception 'No open report for this issue' using hint = 'NOT_FOUND'; end if;
  select * into i from issues where id = p_issue for update;

  if p_outcome = 'close' then
    update issues set status = 'closed', closed_at = now(), updated_at = now() where id = p_issue;
    perform log_event(p_issue, v_admin, 'closed', v_reason, jsonb_build_object('reason', 'admin_already_fixed'));
    perform notify_audience(p_issue, 'issue_closed', v_admin, format('"%s" was closed: %s', i.title, v_reason));
  elsif p_outcome = 'hide' then
    update issues set status = 'hidden', status_before_hidden = 'validated', hidden_by_admin = true, updated_at = now()
     where id = p_issue;
    perform log_event(p_issue, v_admin, 'hidden', v_reason, null);
    perform notify(i.reporter_id, 'issue_hidden', p_issue, null,
      format('Your report "%s" was hidden after an on-site check: %s', i.title, v_reason));
  elsif p_outcome = 'lie' then
    update issues set status = 'validated', updated_at = now() where id = p_issue;
    update profiles set reputation = reputation + s.rep_wrong_issue_lie where id = r.requested_by;
    perform log_event(p_issue, v_admin, 'wrong_report_rejected', v_reason, null);
    perform notify(r.requested_by, 'wrong_report_rejected', p_issue, v_admin,
      format('Your report that "%s" was wrong turned out to be false (%s reputation).', i.title, s.rep_wrong_issue_lie));
  else
    raise exception 'Choose close, hide or lie' using hint = 'BAD_KIND';
  end if;

  perform resolve_reviews(p_issue, array['wrong_issue']::review_kind[], v_admin, p_outcome, v_reason);
  perform log_admin(v_admin, 'wrong_report_' || p_outcome, p_issue, r.requested_by, v_reason, null);
end $$;

-- =====================================================================
-- 3. Appeals
-- =====================================================================
create or replace function appeal_hidden_issue(p_issue uuid, p_note text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := require_user();
  i issues;
begin
  select * into i from issues where id = p_issue;
  if not found or i.reporter_id <> v_user then
    raise exception 'Only the reporter can appeal' using hint = 'FORBIDDEN';
  end if;
  if i.status <> 'hidden' then
    raise exception 'Only hidden reports can be appealed' using hint = 'LOCKED';
  end if;
  if exists (select 1 from review_items where issue_id = p_issue and kind = 'appeal') then
    raise exception 'You already appealed this report' using hint = 'ALREADY_APPEALED';
  end if;
  if char_length(coalesce(trim(p_note), '')) < 10 then
    raise exception 'Explain why the report is real (at least 10 characters)' using hint = 'NOTE_REQUIRED';
  end if;

  -- An anonymous reporter stays anonymous, also to the admin.
  perform open_review(p_issue, 'appeal', case when i.is_anonymous then null else v_user end, trim(p_note),
    jsonb_build_object('flags', i.flag_count, 'hidden_by_admin', i.hidden_by_admin));
  perform log_event(p_issue, case when i.is_anonymous then null else v_user end, 'appealed', trim(p_note), null);
end $$;

create or replace function admin_decide_appeal(p_issue uuid, p_restore boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := require_admin();
  v_reason text := require_reason(p_reason);
  i issues;
  v_flags int;
begin
  if not exists (select 1 from review_items where issue_id = p_issue and kind = 'appeal' and status = 'open') then
    raise exception 'No open appeal for this issue' using hint = 'NOT_FOUND';
  end if;
  select * into i from issues where id = p_issue for update;

  if p_restore then
    -- The flags were judged wrong: set them aside (and remember them for the flaggers' accuracy).
    insert into dismissed_flags (issue_id, user_id, reason, flagged_at)
    select issue_id, user_id, reason, created_at from flags where issue_id = p_issue
    on conflict do nothing;
    delete from flags where issue_id = p_issue;
    get diagnostics v_flags = row_count;
    update issues
       set status = coalesce(status_before_hidden, 'community_review'), status_before_hidden = null, updated_at = now()
     where id = p_issue;
    perform log_event(p_issue, v_admin, 'appeal_accepted', v_reason, jsonb_build_object('flags_set_aside', v_flags));
    perform notify(i.reporter_id, 'appeal_accepted', p_issue, v_admin,
      format('Your appeal was accepted: "%s" is visible again. %s', i.title, v_reason));
    perform recompute_issue(p_issue);
  else
    perform log_event(p_issue, v_admin, 'appeal_rejected', v_reason, null);
    perform notify(i.reporter_id, 'appeal_rejected', p_issue, v_admin,
      format('Your appeal for "%s" was not accepted: %s', i.title, v_reason));
  end if;

  perform resolve_reviews(p_issue, array['appeal']::review_kind[], v_admin,
    case when p_restore then 'restored' else 'kept_hidden' end, v_reason);
  perform log_admin(v_admin, case when p_restore then 'appeal_restore' else 'appeal_reject' end,
    p_issue, i.reporter_id, v_reason, null);
end $$;

-- ---------- Permissions -------------------------------------------
revoke execute on function
  posting_paused_until(uuid), hidden_report_consequences(), guard_posting_pause(),
  flag_accuracy_factor(uuid), apply_flag_accuracy()
from public, anon, authenticated;

grant execute on function
  get_my_posting_pause(),
  appeal_hidden_issue(uuid, text),
  admin_decide_appeal(uuid, boolean, text)
to authenticated;
