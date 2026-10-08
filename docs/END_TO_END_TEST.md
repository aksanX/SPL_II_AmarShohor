# End-to-end test: one issue from report to "fixed"

Run this with the team before adding new features. It uses the real app and the real Supabase project, so it finds the problems unit tests can't.

## Before you start
- Remove the demo data first (`supabase/cleanup_demo.sql`); otherwise real reports are hard to validate.
- Turn on demo mode so new accounts count fully today (SQL Editor):
  `update app_settings set new_account_hours = 0, established_account_hours = 0, volunteer_min_account_hours = 0;`
- You need **4 accounts**, each in its own browser or incognito window: **Reporter**, **Neighbour 1**, **Neighbour 2**, **Volunteer**. One of them, or a 5th, should be an **admin**.
- Give everyone the same home area (Settings → Home area), near where you will report.

For each step write ✅ or ❌, and for ❌ a screenshot and one sentence.

## A. Volunteer route (garbage)
| # | Who | Do | Expect |
|---|---|---|---|
| 1 | Reporter | Report → photo, category **Overflowing Garbage**, pin on the map, title → Post | The post appears in the feed with **Needs validation** and a yellow validation bar |
| 2 | Neighbour 1 | Open the post → **Upvote** | Validation bar moves |
| 3 | Neighbour 2 | Report the *same* garbage within 50 m | "Is it one of these?" appears → **Yes — I see this too** → add photo → Confirm |
| 4 | Anyone | Refresh the post | Status **Validated**; it shows on the **Map** (Hexagons) |
| 5 | Volunteer | Volunteer tab → turn on volunteer mode → open the task → **Accept** | Status "Someone is on it", a 72 h countdown |
| 6 | Volunteer | **Post progress** with a note | Timeline shows progress; countdown restarts |
| 7 | Volunteer | **Submit fix** from the spot (GPS on) with an "after" photo | Status "Fix submitted · confirm?" |
| 8 | Reporter | **Yes, it's fixed** → rate 5★ | Status **Resolved**; the issue leaves the heatmap; volunteer +20 reputation on the Leaderboard |

## B. City Corporation route (pothole)
| # | Who | Do | Expect |
|---|---|---|---|
| 9 | Reporter | Report a **Pothole** inside Dhaka | After 2 supporters: status **With City Corporation** (DNCC or DSCC), a target date, the hotline and "Copy complaint" |
| 10 | Volunteer | Try to accept it | Not possible: it's City Corporation work |
| 11 | Neighbour 1 | Enter a complaint reference number | Shows on the issue |

## C. Fake report
| # | Who | Do | Expect |
|---|---|---|---|
| 12 | Reporter | Post a clearly fake report | Needs validation |
| 13 | 5 accounts | **Not real? Report it** → Fake or scam | Post hidden; reporter loses 10 reputation and gets a notification |
| 14 | Reporter | Open it → **It's real: appeal** | Appears in Admin → review queue |
| 15 | Admin | Restore or keep hidden, with a reason | Reporter notified; the decision is on the timeline |

## D. Map
| # | Do | Expect |
|---|---|---|
| 16 | Map → click a hexagon | A list of its issues; the count matches the hexagon; tapping one opens it |
| 17 | Drag the map up and down | Hexagons stay where they are |
| 18 | Search an area, e.g. "Mirpur 10" | The map moves there; the area panel shows its heat |

## Afterwards
Put demo mode back:
`update app_settings set new_account_hours = 24, established_account_hours = 168, volunteer_min_account_hours = 72;`
