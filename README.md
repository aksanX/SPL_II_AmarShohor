# AmarShohor (আমার শহর)

A community-driven civic issue platform. Citizens post local problems to a social feed, the community validates them, validated issues show up on a heatmap and a volunteer board, and volunteers fix them (or escalate them to the authority) with on-site evidence.

**Version 1 has no admin, no moderator and no AI.** Every decision (validating, hiding fakes, assigning tasks, closing issues) comes from community signals plus rules enforced in the database.

---

## Architecture

```
web/ (React + Vite + TypeScript + Tailwind)
  │  supabase-js  (auth, RPC calls, storage uploads, realtime)
  ▼
Supabase
  ├─ Auth ............ email + password (passwords hashed by Supabase, JWT sessions)
  ├─ Postgres + PostGIS
  │    ├─ 0001 schema ............ tables, enums, tunable rules (app_settings)
  │    ├─ 0002 logic ............. ALL business rules as SECURITY DEFINER functions
  │    ├─ 0003 read API/security . views, feed/map/heatmap functions, RLS, grants
  │    ├─ 0005 pg_cron ........... maintenance job every 15 min
  │    └─ 0006 area heat ......... summary for the map search pin
  ├─ Storage ......... bucket `media` (photos/videos, one folder per user)
  └─ Realtime ........ live notifications
```

**Security model:** the browser can't write to any table directly. Every action (vote, flag, accept task, …) calls a database function that checks the rules and updates counters atomically. Reads go through views that hide private data (anonymous reporters, home locations). A modified frontend still can't fake votes, statuses or reputation.

## Project structure

```
supabase/
  migrations/   run these in order (0001 → 0006)
  tests/        end-to-end test of the logic on a local Postgres
web/
  src/lib/      api.ts (every backend call), types, media upload, geo helpers
  src/hooks/    auth, data, notifications (realtime), toasts
  src/components/  IssueCard (feed post), dialogs, comments, volunteer panel, map layers
  src/pages/    Feed, Issue, New report, Map/Heatmap, Volunteer, Leaderboard, Profile, Settings, Notifications, Login
```

---

## Setup

### 1. Create the Supabase project
1. Create a project at [supabase.com](https://supabase.com).
2. **Database → Extensions:** enable `postgis` and `pg_cron`.
3. **SQL Editor:** paste and run each file in `supabase/migrations/`, **in order**:
   `…001_schema.sql` → `…002_logic.sql` → `…003_read_api_security.sql` → `…004_storage.sql` → `…005_cron.sql` → `…006_area_heat.sql`.
   (With the Supabase CLI you can run `supabase link` and then `supabase db push` instead.)
4. **Authentication → URL Configuration:** set Site URL to `http://localhost:5173` (and your deployed URL later).
5. Optional for development: **Authentication → Providers → Email:** turn off "Confirm email" so sign-up logs you in immediately.

### 2. Run the web app
```bash
cd web
cp .env.example .env.local     # paste Project URL + anon key (Project Settings → API)
npm install
npm run dev                    # http://localhost:5173
```

### 3. Demo mode (for presentations)
New accounts count less and can't volunteer for 72 hours (anti-fake-account rules). For a same-day demo with fresh accounts, run this in the SQL editor:
```sql
update app_settings set new_account_hours = 0, established_account_hours = 0, volunteer_min_account_hours = 0;
```
Put the values back afterwards (`24`, `168`, `72`).

### 4. Run the logic tests (optional, local Postgres with PostGIS)
```bash
./supabase/tests/run_local.sh
```
This exercises the full flow: reporting, duplicate blocking, "I see this too", weighted validation, two volunteers racing for one task, the on-site fix check, a disputed fix and reopen, community confirmation, rating, lock expiry, fake-report hiding, anonymity, and direct-table-access denial.

---

## How the core logic works

All numbers below live in the `app_settings` table and can be changed without code changes.

### Reporting
- At least one photo or video (max 5 files, one video ≤ 30 s). Photos are compressed on the phone before upload.
- **Location accuracy:** GPS fixes worse than ±100 m are rejected; the user must place the pin by hand instead. Pins outside Bangladesh are refused.
- **Duplicate check:** before posting, the app looks for open issues of the same category within 50 m (last 30 days). If it finds one, the user is offered **"I see this too"** instead of creating a duplicate post.
- Max 10 reports per user per day. The reporter can edit or delete a report until it is validated. Drafts survive refreshes and lost connections.

### Community validation (replaces admin approval)
- **Score = weighted upvotes + weighted on-site confirmations.** A vote's weight depends on:
  - account age: < 1 day ×0.25, < 7 days ×0.5
  - proximity: within 3 km of the voter's current location or home ×1.5, beyond 25 km ×0.5
  - reputation: up to ×2
- **"I see this too"** requires being within 200 m (by GPS) and a fresh photo. It counts double and replaces the user's upvote.
- **Threshold by severity:** critical 3 · high 5 · medium 7 · low 10. Severity starts at the category default; after 3 people vote on severity, the median vote decides. The reporter can't pick "critical" to skip the queue.
- **Low-participation areas:** if fewer than 15 people are active within 3 km, the threshold is reduced to 60% (minimum 2).
- Validation always needs **at least 2 different supporters**, so one person can never validate an issue alone.
- Reports that never validate **expire** after 30 days.

### Fake reports (no moderator)
- A report is **hidden** when at least 5 people flag it **and** the weighted flags outweigh its support. Because this is a ratio, a small group can't bury a real issue.
- Hidden posts leave the feed and the map, but stay reachable by link. If support grows past the flags, they come back automatically.
- Comments hide themselves after 3 flags.

### Volunteer workflow
- Volunteer mode is switched on from the same account (the account must be ≥ 72 h old). A volunteer can hold up to 3 active tasks.
- **Accept:** a single atomic `UPDATE … WHERE status = 'validated' AND volunteer_id IS NULL`. If two volunteers tap at the same moment, exactly one wins; the other sees "already taken". The reporter can't take their own issue.
- **72-hour lock:** each progress update restarts the clock. A reminder goes out 24 h before expiry. On expiry, pg_cron returns the task to the pool and the volunteer loses 5 reputation. Releasing a task voluntarily carries no penalty.
- **Category types:** *community* issues (garbage, dumping, dengue sites) are fixed directly. *Authority* issues (roads, lights, drains) are escalated: the volunteer files the complaint, posts the reference number as progress, and confirms once it's fixed.
- **Submitting a fix** requires being within 200 m of the issue (GPS) and at least one "after" photo.

### Confirming the fix
- The **reporter** decides alone: fixed closes the issue, not fixed reopens it.
- Otherwise **2 nearby citizens** (within 3 km, or anyone who confirmed it on-site) agreeing close or reopen it.
- With no decision after **7 days**, the issue auto-closes if nobody disputed it; otherwise the majority wins.
- A reopened issue costs the volunteer 15 reputation, and that volunteer can't take the same issue again.

### Reputation & leaderboard
+10 per confirmed fix · (stars − 3) × 5 per rating · −15 per disputed fix · −5 per expired lock. Only the reporter rates, once per completed task.

### Heatmap
- **Only validated, still-open issues heat the map.** Unverified posts, hidden fakes and resolved issues are excluded.
- **Each issue's heat** = severity (1–4) × evidence (1 + ln(1 + confirmations) + 0.25·ln(1 + upvotes)) × freshness (halves every 30 days, never below 35%).
- **Hexagons (default, most accurate):** each issue is assigned to exactly one hexagon on a grid anchored to the projection, so hexagons don't jump as you pan. Hexagon size adapts to zoom and is corrected for Web-Mercator stretch, so a 250 m hexagon is really 250 m on the ground. Aggregation runs in PostGIS (`heatmap_hex`); 5,000 issues take about 0.1 s.
- **Heat** is the smooth kernel version of the same weighted points; **Pins** show individual issues, clustered when zoomed out.
- **Search & pinpoint:** the map search box finds places (OpenStreetMap, limited to Bangladesh), reported issues and pasted coordinates. Picking a result, right-clicking or long-pressing the map, or "my location" drops a draggable pin. A summary (`area_heat_summary`) then shows the circle around it (500 m – 5 km): active, unverified and resolved counts, total heat and heat per km² with a level (low → severe), which categories make it hot, and the hottest issues. It uses the same heat rules as the hexagons. The pin is kept in the URL (`?lat=&lng=&r=&place=`), so a searched area can be shared.

### Edge cases covered
| Edge case | Handling |
|---|---|
| Duplicate reports | 50 m / same category / 30 days check, "I see this too" |
| Vote manipulation | weighted votes, one vote per user, no self-votes, min 2 supporters, server-only counters |
| Fake reports | ratio-based auto-hide, flags weighted the same way as votes |
| GPS inaccuracy | accuracy limit, manual pin, accuracy stored and shown, on-site radius allows for GPS error |
| Volunteer inactivity | 72 h lock, reminder, auto-release, reputation penalty |
| Simultaneous acceptance | atomic conditional UPDATE + unique index on active assignment |
| False resolution evidence | on-site GPS check, required after photo, reporter/neighbour confirmation, reopen + penalty |
| Low-participation areas | threshold reduced when few people are active nearby |
| Heatmap overcrowding | hexagon aggregation, marker clustering, p95-capped heat intensity |
| Inappropriate comments | auto-hide after 3 flags |
| Network failures | uploads retried 3×, already-uploaded files not re-sent, draft saved locally |

---

## Deliberately not in v1 (can be added later)
- **Moderator role:** dispute handling, bans and appeals. Right now the auto-hide rules cover this.
- **AI:** category suggestion from the photo and image-similarity duplicate detection.
- Google login and phone OTP (both available in Supabase Auth); Bangla UI translation (category names already have Bangla).
