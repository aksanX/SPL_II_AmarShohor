# Backups

The free Supabase plan keeps no backups you can restore yourself. One wrong query in the SQL Editor (for example on the wrong project) can lose data for good. Take your own copy weekly, and always before running a new migration.

## What you need (once)
- **PostgreSQL client tools** (`pg_dump`, `psql`). On a Mac with Postgres.app they are already there.
- The **connection string**: Supabase → the green **Connect** button → **Session pooler** → copy the URI. It contains the database password; never commit it or paste it in a chat.

## Take a backup
From the project folder, in a terminal (replace the URI):
```bash
mkdir -p backups
pg_dump "postgresql://postgres.xxxx:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" \
  --schema=public --no-owner --no-privileges \
  --file="backups/amarshohor-$(date +%Y-%m-%d).sql"
```
- `--schema=public` copies all app data (issues, votes, comments, profiles, settings…).
- The `backups/` folder is ignored by git; keep the files somewhere private (they contain people's data).

Accounts and logins (schema `auth`) and the photos themselves (Storage) are **not** in this file. Photos can be downloaded from Storage in the dashboard if needed.

## Check it worked
The file should be several MB and start with `-- PostgreSQL database dump`:
```bash
ls -lh backups/ && head -3 backups/amarshohor-*.sql
```

## Restore (only when something went wrong)
Restoring overwrites what is in the database now. Agree on it with the team first.
```bash
psql "postgresql://...same URI..." --file=backups/amarshohor-2026-10-12.sql
```
