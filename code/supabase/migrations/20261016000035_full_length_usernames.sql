-- =====================================================================
-- AmarShohor — 35. Sign-up keeps the username as typed (up to 24 characters)
--
-- handle_new_user cut every username to 18 characters, even when it was
-- free, so "dhanmondi_volunteer22" (21) became "dhanmondi_voluntee". Usernames
-- may be 24 long (profiles.username). Now a free username is kept whole.
-- Only when it is taken (two people signing up at the same moment; the app
-- checks before signing up) is it shortened to 20 and given 4 digits.
-- Otherwise identical to 0002.
-- =====================================================================

set search_path = public, extensions;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_base text;
  v_username text;
  n int := 0;
begin
  v_base := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'username',
                                          split_part(new.email, '@', 1), 'user'), '[^a-zA-Z0-9_]', '', 'g'));
  if char_length(v_base) < 3 then v_base := v_base || 'user'; end if;
  v_username := left(v_base, 24);
  while exists (select 1 from profiles where username = v_username) loop
    n := n + 1;
    v_username := left(v_base, 20) || (floor(random() * 9000) + 1000)::int;  -- 20 + 4 digits = 24
    if n > 20 then v_username := 'user_' || left(replace(new.id::text, '-', ''), 12); exit; end if;
  end loop;

  insert into profiles (id, username, full_name)
  values (new.id, v_username, left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 80));
  insert into user_settings (user_id) values (new.id);
  return new;
end $$;
