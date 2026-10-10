-- Minimal stand-in for what Supabase provides, for local testing only.
create schema if not exists auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema if not exists extensions;
grant usage on schema public, extensions, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Supabase Storage keeps one row per uploaded file. Only the columns the
-- migrations read: who uploaded it (owner_id) and when (created_at).
create schema if not exists storage;
create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text not null,
  name       text not null,
  owner      uuid,
  owner_id   text,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
grant usage on schema storage to anon, authenticated;
