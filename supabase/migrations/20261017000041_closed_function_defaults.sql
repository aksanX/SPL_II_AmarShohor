-- =====================================================================
-- AmarShohor — 41. Functions are closed unless a migration opens them
--
-- Postgres lets everyone (PUBLIC) run a new function unless told
-- otherwise, and Supabase also opens new functions to anon/authenticated.
-- 0010 closed everything that existed then, but functions added later were
-- open to logged-out visitors, including three admin functions. They were
-- not exploitable (each checks the login and role inside), but one future
-- function without that check would have been.
--
-- 1. Remove the "everyone" grant from every function in public. Functions
--    meant for visitors or users keep their explicit grants.
-- 2. Close the user-only functions that visitors could reach.
-- 3. Stop Supabase from opening new functions to anon/authenticated: every new
--    function needs an explicit `grant execute ... to authenticated` (or anon).
-- =====================================================================

set search_path = public, extensions;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) x
                                        where x.grantee = 0 and x.privilege_type = 'EXECUTE'))
  loop
    execute format('revoke execute on function %s from public', f.sig);
  end loop;
end $$;

-- Logged-in users only.
revoke execute on function
  admin_decide_appeal(uuid, boolean, text),
  admin_refer_issue(uuid, uuid, text),
  admin_save_authority(uuid, text, text, jsonb, text, text, jsonb, int, int, int, int, boolean, text),
  answer_still_there(uuid, boolean, double precision, double precision),
  appeal_hidden_issue(uuid, text),
  get_my_posting_pause()
from anon;

-- Supabase opens every new function in public to anon and authenticated;
-- that default is removed here. Postgres's own "everyone" default is global
-- (all schemas, including extensions such as PostGIS), so it is left alone
-- and the test suite (scenario_v3, section 29) fails if any function in
-- public is open to everyone: add `revoke execute ... from public` to new
-- migrations, like the files above.
alter default privileges in schema public revoke execute on functions from anon, authenticated;
