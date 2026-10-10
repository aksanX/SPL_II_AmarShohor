# AmarShohor (আমার শহর)

A community-driven civic issue platform. Citizens post local problems to a social feed, the community validates them, and validated issues show up on a heatmap. Small problems go to volunteers (alone or as a team); big or dangerous ones go to the City Corporation that covers the area. Both fix them with on-site evidence, and citizens confirm the fix.

**Community-driven. The admin handles setup, verification and unclear cases only.**
Validation, hiding fakes and confirming fixes still come from community signals plus rules enforced in the database. Version 2 adds a verified City Corporation official role and a small admin role (see [What's new in v2](#whats-new-in-v2)).

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
  │    ├─ 0006 area heat ......... summary for the map search pin
  │    ├─ 0007–0010 (v2) ......... roles, City Corporations, routing, teams, emergencies
  │    ├─ 0011 loops ............. "still there?" check, safety, reopen & route limits, agencies
  │    ├─ 0012 categories ...... groups → subgroups → categories, multi-category feed filter
  │    ├─ 0013 map groups ...... map, heatmap and area summary filter by main category group
  │    ├─ 0014 heat grid ....... heat points merged per grid cell, never over the 1000-row API limit
  │    ├─ 0015 group fixes ..... hexagon top group, admin can put a category in a group
  │    ├─ 0016–0021 ............. emergencies vs issues, live in-app evidence, category corrections, road blockade
  │    ├─ 0022 safety ........... dangerous work never stays with volunteers
  │    ├─ 0023 edge hexagons .... hexagons at the edge of the map are counted completely
  │    ├─ 0024–0025 spam ........ penalties and posting pause for fake reports, flag accuracy, appeals
  │    ├─ 0026 hotlines ......... phone numbers for DNCC and DSCC
  │    ├─ 0027 heat counts ...... heat points say how many issues they hold
  │    ├─ 0028 votes ............ an unknown location no longer halves a vote
  │    ├─ 0029–0030 hexagons .... grid stays put while panning; a hexagon's top issues and exact total
  │    ├─ 0031 roles ............ residents vote, admins/officials don't; admin & City Corporation flow fixes
  │    ├─ 0032 emergencies ...... residents witness; officials post updates, end alerts, log damage; admins remove fakes
  │    ├─ 0033 cleanup .......... old staff votes removed, one decision per request, switched-off City Corporations
  │    ├─ 0034 map time filter .. map, hexagon lists and area summary: last 7 / 30 days
  │    ├─ 0035 usernames ........ sign-up keeps usernames up to 24 characters
  │    ├─ 0036–0040 uploads ..... untraceable file names, ownership from Storage, unused-upload report
  │    ├─ 0041 permissions ...... functions closed unless a migration opens them
  │    └─ 0042–0043 cleanup ..... old notifications cleared weekly
  ├─ Storage ......... bucket `media` (photos/videos, one folder per user)
  └─ Realtime ........ live notifications
```

**Security model:** the browser can't write to any table directly. Every action (vote, flag, accept task, …) calls a database function that checks the rules and updates counters atomically. Reads go through views that hide private data (anonymous reporters, home locations). A modified frontend still can't fake votes, statuses or reputation.

## Project structure

```
supabase/
  migrations/   run these in order (0001 → 0043)
  seed.sql      rough DNCC/DSCC areas, development only
  tests/        end-to-end tests of the logic on a local Postgres
web/
  src/lib/      api.ts (every backend call), types, media upload, geo helpers,
                mapMath.ts (the map's calculations) and profile.ts (profile page calculations), kept free of React so they are unit tested
  src/hooks/    auth, data, notifications (realtime), toasts
  src/components/  IssueCard (feed post), dialogs, comments, volunteer panel, map layers
  src/pages/    Feed, Issue, New report, Map/Heatmap, Volunteer, Leaderboard, Profile, Settings, Notifications, Login
  src/test/     shared helpers for the component tests; the tests themselves sit next to their code (*.test.ts, *.test.tsx)
```

---

## Setup

### 1. Create the Supabase project
1. Create a project at [supabase.com](https://supabase.com).
2. **Database → Extensions:** enable `postgis` and `pg_cron`.
3. **SQL Editor:** paste and run each file in `supabase/migrations/`, **one at a time, in order**:
   `…001_schema` → `…002_logic` → `…003_read_api_security` → `…004_storage` → `…005_cron` → `…006_area_heat` →
   `…007_v2_types` → `…008_v2_schema` → `…009_v2_logic` → `…010_v2_read_api_security` → `…011_cycles_and_stale` → `…012_category_groups` → `…013_map_category_groups` → `…014_heatmap_points_grid` → `…015_category_group_fixes` → `…016_new_enum_values` → `…017_emergency_vs_issue` → `…018_issue_to_emergency` → `…019_live_evidence` → `…020_category_corrections` → `…021_road_blockade` → `…022_unsafe_category_safety` → `…023_heatmap_edge_hexagons` → `…024_appeal_kind` → `…025_spam_and_appeals` → `…026_city_corp_hotlines` → `…027_heatmap_points_count` → `…028_unknown_location_neutral` → `…029_stable_hex_grid` → `…030_hex_issue_list` → `…031_roles_and_admin_fixes` → `…032_emergency_roles` → `…033_cleanup_and_locks` → `…034_map_time_filter` → `…035_full_length_usernames` → `…036_upload_ownership` → `…037_live_media_ownership` → `…038_avatars_in_use` → `…039_unused_uploads` → `…040_upload_names_storage` → `…041_closed_function_defaults` → `…042_notification_retention` → `…043_weekly_cleanup_cron`.
   (With the Supabase CLI you can run `supabase link` and then `supabase db push` instead.)
   For a demo, also run `supabase/seed.sql` (rough City Corporation areas for testing; the categories already come from `…001_schema`).
4. **Authentication → URL Configuration:** set Site URL to `http://localhost:5173` (and your deployed URL later).
5. Optional for development: **Authentication → Providers → Email:** turn off "Confirm email" so sign-up logs you in immediately.

### 2. Run the web app
```bash
cd web
cp .env.example .env.local     # paste Project URL + anon key (Project Settings → API)
npm install
npm run dev                    # http://localhost:5173
```

### 3. Create the first admin (once)
Sign up in the app, then run this in the SQL editor with your username. Nobody can become an admin from the app itself; after this, admins approve officials and other admins in **Admin** (account menu).
```sql
insert into user_roles (user_id, role) select id, 'admin' from profiles where username = 'your_username';
```

### 4. Demo mode (for presentations)
New accounts count less and can't volunteer for 72 hours (anti-fake-account rules). For a same-day demo with fresh accounts, run this in the SQL editor:
```sql
update app_settings set new_account_hours = 0, established_account_hours = 0, volunteer_min_account_hours = 0;
```
Put the values back afterwards (`24`, `168`, `72`).

### 5. Run the logic tests (optional, local Postgres with PostGIS)
```bash
PGUSER=postgres ./supabase/tests/run_local.sh
```
`scenario.sql` exercises the v1 flow: reporting, duplicate blocking, "I see this too", weighted validation, two volunteers racing for one task, the on-site fix check, a disputed fix and reopen, community confirmation, rating, lock expiry, fake-report hiding, anonymity, and direct-table-access denial.
`scenario_v2.sql` covers roles, routing by category, City Corporation escalation and target times, officials, team tasks and rewards, release reasons, admin decisions, overdue and stuck detection, emergency alerts, and security.

### 6. Run the web app tests (no database needed)
```bash
cd web
npm test          # all tests once
npx vitest        # re-run on every save
```
Vitest unit tests check the calculations (`mapMath`, `geo`, `format`, `categories`, `profile`). React Testing Library tests render the map's search box, area panel, hexagon panel, pin layer, the map page and the profile page in a simulated browser (jsdom). Database and network calls are replaced with fakes, so the tests never touch Supabase, Photon or Nominatim.

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
- **Wrong category** (e.g. "pothole" with a photo of a fire) is a correction, not a flag, and never counts towards hiding. On-site confirmers are asked "Is this a <category>?" and can answer "No, it's …"; anyone can report "wrong category / photo doesn't match" and pick what it shows. When 2 on-site confirmers or 3 people in total name the same other category and outnumber those who confirmed it as listed, the issue switches before anyone works on it: severity and route follow (automatic moves only ever go towards the City Corporation). Disputes, or issues already being worked on, go to the admin review queue. Honest mistakes cost no reputation. If the right category has a live emergency version (fire, sparking wire, collapse), people are pointed to raising an emergency alert.

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
- **Time filter (0034):** All time, Last 30 days or Last 7 days, in Filters. It keeps only issues *reported* in that time. Hexagons, heat, pins, the hexagon issue list and the pin's area summary all use the same rule (`reported_within`), so their numbers always match.
- **Click a hexagon** to see the area it covers ("Around Sector 7, Uttara", from OpenStreetMap; big zoomed-out hexagons get only the district name), its count and heat, and its 20 most serious issues with the exact total (`hex_issues`). "Show them as pins" zooms in on it.
- **Hexagons (default, most accurate):** each issue is assigned to exactly one hexagon on a grid anchored to the projection, so hexagons don't jump as you pan. Hexagon size adapts to zoom and is corrected for Web-Mercator stretch, so a 250 m hexagon is really 250 m on the ground. Aggregation runs in PostGIS (`heatmap_hex`); 5,000 issues take about 0.1 s.
- **Heat** is the smooth kernel version of the same weighted points; **Pins** show individual issues, clustered when zoomed out.
- **Pins stop at 2,000 per view** (`map_issues`). When a view reaches that, the count reads "2000+" and a note asks to zoom in, instead of looking complete.
- **Search & pinpoint:** the map search box finds places (OpenStreetMap, limited to Bangladesh), reported issues and pasted coordinates. Picking a result, right-clicking or long-pressing the map, or "my location" drops a draggable pin. A summary (`area_heat_summary`) then shows the circle around it (500 m – 5 km): active, unverified and resolved counts, total heat and heat per km² with a level (low → severe), which categories make it hot, and the hottest issues. It uses the same heat rules as the hexagons. The pin is kept in the URL (`?lat=&lng=&r=&place=`), so a searched area can be shared.
- **Share a view:** the whole map view lives in the URL (mode, category, time, pin types, dropped pin), and the link button copies it. Whoever opens the link sees the same map.
- **Search details:** places are searched while typing (Photon); pressing Enter when nothing matches also tries full addresses (Nominatim, at most one request per second). House numbers ("H#12, Rd-5") are cleaned up first, Bangla text is matched correctly, and results are remembered per typed text and per ~5 km part of the map, so the same text searched in another area looks there.
- **Smooth updates:** moving the map only adds or removes what changed. Pins that stay are not redrawn (an open popup stays open), the heat layer swaps its points in place, and new hexagons fade in.
- **Dark mode:** the map tiles are darkened with the rest of the app; hexagons, heat and pins keep their exact colours, so they still match the legend.

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
| Old issues hiding what's new | time filter: last 7 / 30 days on the whole map |
| More pins than one view can load | 2,000 per view, with a "2000+" count and a note to zoom in |
| Inappropriate comments | auto-hide after 3 flags |
| Network failures | uploads retried 3×, already-uploaded files not re-sent, draft saved locally |

---

## What's new in v2

### Roles
| Role | Can do | Cannot do |
|---|---|---|
| Citizen | Report, vote, confirm on site, flag, comment | — |
| Volunteer | Lead or join tasks on community issues, with on-site evidence | Handle City Corporation issues |
| City Corporation official | Accept escalated issues in their own area, post progress, submit the fix with GPS and a photo, ask to send small issues back to volunteers | Close an issue without community confirmation, act outside their area |
| Admin | Approve officials, set up City Corporations and categories, decide unclear cases, re-route issues, request help from volunteers | Assign a task to someone, mark issues fixed, change votes or reputation |

Roles live in `user_roles` and are checked inside the database functions. Officials ask to be verified from **Settings**; an admin checks their identity and approves. Every admin action needs a reason, is logged, and shows on the issue timeline.

### Data the system starts with
The 10 standard categories come with `…001_schema`; the admin can edit them or add more. City Corporations are drawn on a map by the admin, and settings have built-in defaults the admin can edit. `seed.sql` is for development.

### Who fixes an issue
1. When reporting, the citizen adds a photo, description, **size** and **category**. The category decides who fixes it at first: *volunteers* or the *City Corporation*.
2. A volunteer who finds an issue too big can ask for it to go to the City Corporation (with a note and photo). It waits in the **admin review queue**, and the admin approves or rejects it.
3. The admin can move any open issue between volunteers and the City Corporation (with a reason). Whoever was working on it stops with no penalty.

### City Corporation flow
`validated → escalated (to the City Corporation whose map area contains it) → official accepts → progress → fix with GPS + after photo → community confirms → closed`
- A rejected fix goes back to the **same** City Corporation.
- Each escalated issue gets a **target time** by severity (default critical 3, high 7, medium 14, low 30 days). After that it shows **Overdue** and followers are told once. The app can't force the City Corporation; it makes delays visible.
- No stars or points for City Corporations. A public **record** shows facts: sent, resolved, open, overdue, average days to fix.
- Escalated issues show the hotline, a **Copy complaint** button (location, photos, support count) and a **complaint reference** field for follow-ups.

### Volunteers
- **Team tasks:** the first volunteer to accept leads and sets the team size; nearby volunteers are notified and can join. Members tap **"I'm here"** at the site (GPS). Leading a team needs 1 completed task and positive reputation. The leader can hand over; if the leader goes quiet, members are offered the lead.
- **Release reasons:** *can't do it now* (back to the pool or to the team), *needs the City Corporation* and *report is wrong* (both need a note and an on-site photo, and go to the admin).
- **Stuck issues** (released 3 times, or nobody took it for 14 days) go to the admin, who can escalate them or ask nearby volunteers for help.

| Situation | Leader / solo | Team member |
|---|---|---|
| Fix confirmed by the community | +10 | +10, only if checked in on site |
| Reporter's rating | (stars − 3) × 5 | — |
| Fake or bad fix | −15 | 0 |
| Lock expired, or removed by admin for inactivity | −5 | 0 |
| Any honest release, admin re-route | 0 | 0 |
| 3 rejected City Corporation requests in 30 days | −5 | — |
| False "report is wrong" claim | −5 | — |

### Emergencies
AmarShohor is not an emergency service. The **Emergency** page shows **999** (and local numbers the admin sets per City Corporation) first, then lets the person post an alert that is published immediately as "unverified" and notifies people within about 1 km. Neighbours confirm, deny or mark it over; enough denials hide a false alert and cost the reporter reputation. Alerts never create volunteer tasks and end after 6 hours. Damage left afterwards is reported as a normal issue. An open issue that gets dangerous (a downed wire starts sparking, a cracked building starts collapsing) can be turned into an alert from its page: the alert is placed at the issue, linked to it, and warns its followers too. Emergency photos and videos must be live: they are taken with the in-app camera (no gallery), stamped with a one-time server code, the time and GPS, and must reach storage within 2 minutes of the code from within 300 m. A live photo proves time and place, not content, so confirmers pick what they see (fire, gas leak, …) and only answers matching the alert count. An alert is **verified** once 2 established accounts confirm it that way with live GPS within 300 m and there is at least one live photo or video. An admin or an official of the area then checks the evidence: keeping it makes it final, rejecting it (with a reason) hides it, undoes the issue's critical severity and costs the reporter and the confirmers reputation. Meanwhile a verified alert makes its issue critical (votes cannot lower it) and counts as community validation. If the alert is later hidden as false, that is undone.

## Closing the loops (0011)
Every open issue must have either a timer or a decision-maker, so nothing waits forever.

| Problem | Rule |
|---|---|
| The city fixes something outside the app, and the issue stays red on the heatmap forever | **"Is this still there?"** After 14 days with no activity, the reporter, followers and on-site confirmers are asked. **2 "it's gone" answers** (more than "still there") close it as *confirmed gone*: it leaves the heatmap, and nobody earns reputation. A "still there" answer keeps it open and stops the question for another 14 days. |
| Dangerous work (live wires, open manholes) ending up with volunteers | Categories can be marked **too dangerous for volunteers**: new reports go to an authority, and even an admin can't move them to volunteers. *Public Safety Hazard* starts marked. |
| A reporter disputes every fix forever | The reporter can **reopen a fix alone only once**. After that, a "not fixed" needs a neighbour to agree. Saying "fixed" still closes it at once. After **2 disputed fixes** the admin is asked to look. |
| Ping-pong: volunteer says "needs City Corporation", official says "volunteers can do it" | Once an admin **moves** an issue, nobody can ask to move it again for **30 days**. The admin still can. A rejected request doesn't lock anything. |
| The City Corporation says "not our job" (power line, water main, highway) | Authorities can be a **City Corporation** (gets issues by map area) or **another agency** such as DESCO or WASA (only gets issues an admin **refers** to it). Referring restarts the target-time clock with that agency's own targets. |
| An issue *becomes* dangerous while with volunteers (its category is corrected to e.g. "open manhole", or the admin rejects an escalation request) | **0022:** at the end of every operation, an issue with volunteers in a too-dangerous category is sent to the City Corporation. A volunteer already on it is told to stop, with no penalty. *Fire hazard* is marked too dangerous too. |
| The same pile reported as "garbage" and "illegal dumping" | Categories can share a **duplicate group** (*waste*: garbage + illegal dumping; *water*: waterlogging + drainage), so the duplicate check finds both. |

All the numbers (`stale_check_days`, `stale_gone_quorum`, `max_reopens`, `route_lock_days`) are in `app_settings`.

## Spam and fake reports (0025)
There is no downvote on purpose: "I don't like it" would let people bury real problems. Instead people say **"Not real?"** with a reason (a button under every post that still needs validation, and in the ⋯ menu).

| Rule | How it works |
|---|---|
| Hiding | A post is hidden when at least 5 people flag it **and** the weighted flags outweigh its support. It comes back by itself if support grows past the flags. |
| Reporter penalty | A hidden report costs the reporter **−10 reputation**, given back if it becomes visible again. |
| Posting pause | **3 hidden reports in 30 days → no new reports for 7 days.** Voting, confirming and commenting still work. |
| Fair flagging | A "fake/spam" flag is wrong if the community validates the issue anyway (or an admin restores it). With more than half of at least 3 judged flags wrong, new flags count half; with more than three quarters, a quarter. |
| Appeal | The reporter of a hidden report can appeal **once**. The admin restores it (flags set aside, reputation back) or keeps it hidden, with a written reason. |
| Admin hides | A report an admin hid after an on-site check stays hidden; votes can't bring it back. Only an appeal can. |

## Demo data and the end-to-end test
- `supabase/seed_heatmap.sql` fills the map with ~8,000 fake "[demo]" issues for trying the heatmap. **Remove them before testing with real people** with `supabase/cleanup_demo.sql` (it previews, deletes only the demo accounts and their issues, then checks). Besides odd numbers, the fake reporters count as active neighbours and make real reports harder to validate.
- `docs/END_TO_END_TEST.md` is a step-by-step checklist that takes one issue from report to fixed with 4 accounts, plus the City Corporation route, a fake report with an appeal, and the map.
- `docs/MAP_GUIDE.md` explains the map for the whole team: features, how a request travels, the heat and hexagon rules, link parameters, files, SQL functions, tests and where to change common things.

## Not built yet (can be added later)
- **Help your city module** (blood donation, support requests). Handling money is deliberately left out.
- Image-similarity duplicate detection; Google login and phone OTP (both available in Supabase Auth); Bangla UI translation (category names already have Bangla).
