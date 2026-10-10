-- =====================================================================
-- AmarShohor — 65. An official email can't make a citizen account
--
-- Before: an email at a City Corporation's official domain (e.g.
-- name@dncc.gov.bd) used on the normal "Create account" page made an
-- ordinary citizen account. Now that sign-up is refused: City Corporation
-- staff sign up on the City Corporation page, so an admin verifies them.
-- Same as 0061 otherwise. Accounts made before this stay as they are.
-- =====================================================================

set search_path = public, extensions;

create or replace function handle_official_signup() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  a authorities;
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}');
begin
  if coalesce(v_meta ->> 'official_authority', '') = '' then
    select * into a from authorities
     where is_active and kind = 'city_corporation' and email_matches_domain(new.email, email_domain)
     limit 1;
    if found then
      raise exception 'This is a % official email. Sign up on the City Corporation page instead.', a.short_name
        using hint = 'USE_OFFICIAL_SIGNUP';
    end if;
    return new;
  end if;
  select * into a from authorities
   where id = (v_meta ->> 'official_authority')::uuid and is_active and kind = 'city_corporation';
  if not found then
    raise exception 'Unknown City Corporation' using hint = 'NOT_FOUND';
  end if;
  if a.email_domain = '' then
    raise exception '% doesn''t take official sign-ups yet', a.short_name using hint = 'NO_DOMAIN';
  end if;
  if not email_matches_domain(new.email, a.email_domain) then
    raise exception 'Use your official @% email', a.email_domain using hint = 'WRONG_DOMAIN';
  end if;

  insert into role_requests (user_id, authority_id, designation, office, message, via_signup)
  values (new.id, a.id,
          left(coalesce(nullif(trim(v_meta ->> 'designation'), ''), 'Official'), 120),
          left(coalesce(trim(v_meta ->> 'office'), ''), 200),
          '', true);
  if new.email_confirmed_at is not null then  -- email confirmation switched off
    perform notify_official_signup(a.id, new.id, new.email);
  end if;
  return new;
end $$;
