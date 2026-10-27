# Map guide

How the AmarShohor map works, from what users see down to the SQL, as of migration 0078 (October 2026). The map functions themselves last changed in 0034; later migrations changed what counts as evidence (0053, 0070) and how Admin draws a City Corporation's area (0046, wards). Read this before changing anything under `code/web/src/features/map/` or the map functions in `code/supabase/migrations/`.

## 1. What the map does

The map at `/map` shows where real, unfixed problems are and how serious each area is.

| Feature | What the user sees |
|---|---|
| **Hexagons** (default) | A grid of hexagons, light to dark red. Darker = more heat. Size follows the zoom (20 km sides zoomed out, 80 m close up). |
| **Heat** | A smooth blur, blue (low) to red (high). Quick to read, less exact. |
| **Pins** | One pin per issue, merged into numbered bubbles when zoomed out. Checkboxes: validated, needs validation, resolved. |
| **Filters** | Main category group, and time: **All time / Last 30 days / Last 7 days**. Shows "N issues in view". |
| **Search** | Places (OpenStreetMap), reported issues and pasted coordinates (`23.81, 90.41`). Up to 200 characters, so a pasted page of text isn't sent to the search services. |
| **Click a hexagon** | "Around Sector 7, Uttara", its count, heat and main group, and its 20 most serious issues with the exact total. "Show them as pins" zooms in. |
| **Dropped pin** | Right-click / long-press, a search result or the location button. A panel describes the circle around it (500 m to 5 km): level (No active issues → Severe), counts, what makes it hot, hottest issues. |
| **Share** | The link button copies the current view; whoever opens it sees the same map. |
| **Other** | Zoom + / − buttons (desktop; phones pinch), legend, "How is the heat calculated?", a message when the view is empty, a "2000+" note when Pins hits its limit, dark map tiles in dark mode. Filters start folded on phones. On desktop the hexagon and pin panels open below the location and share buttons. |

Two smaller maps reuse the same pieces: **LocationPicker** in the report form (where is the problem?) and **AreaDrawer** in Admin (draw a City Corporation's area: search it by name or short name such as "DNCC", pick thanas, draw it freehand or tap its corners).

## 2. How a request travels

Every map request follows one path. Learn it once and you can follow any feature.

```mermaid
flowchart LR
  A["MapPage.tsx<br/>state + URL + React Query"] --> B["MapService (map.service.ts)<br/>getHeatmapHex, getHeatmapPoints,<br/>getMapIssues, getHexIssues, getAreaSummary"]
  B -->|"supabase.rpc() via BaseService"| C["SQL function<br/>(SECURITY DEFINER)"]
  C --> D[("issues table<br/>+ PostGIS")]
  C -->|rows| E["components/layers/*<br/>update the map in place"]
  F["MapSearch.tsx + PlaceSearchService"] -->|fetch| G["Photon / Nominatim<br/>(OpenStreetMap, outside)"]
```

1. Panning or zooming fires Leaflet's `moveend` (it also fires after every zoom, so it is the only event needed). `ViewportWatcher` reads the visible box, adds 15% around it, rounds it to 3 decimals and keeps it inside ±180 / ±90 (`clampBBox`), because PostGIS refuses coordinates past the edge of the world. The map can't be zoomed out past level 5 (about the size of the region), so it never shows the whole world.
2. The box, mode, hexagon size, category, time and pin types form the **React Query key**. A new key loads data; a key seen before is answered from the cache. The old result stays on screen while the new one loads.
3. `mapService` (a `MapService`, which extends `BaseService`) calls one SQL function through Supabase RPC.
4. The function applies the rules (section 3) and returns rows.
5. A layer in `components/layers/` changes only what is different: pins and hexagons that stay are left alone, new hexagons fade in, the heat layer swaps its points.

The browser never reads the `issues` table directly. The map functions run as `SECURITY DEFINER`, return only safe columns and skip hidden issues, so a modified frontend can't see private data or fake the heat.

## 3. The rules

**Which issues count.** Hexagons, heat, the hexagon list and the area summary use only validated, unfixed issues: statuses `validated`, `escalated`, `under_review`, `assigned`, `in_progress`, `resolution_submitted`. Pins can also show unverified (`community_review`) and resolved (`closed`) ones.

**Heat of one issue** (SQL `issue_heat_weight`):

```
heat = severity × (1 + ln(1 + confirmations) + 0.25 × ln(1 + upvotes)) × freshness
```

- Severity: low 1, medium 2, high 3, critical 4.
- `ln` grows slowly, so the 50th upvote adds far less than the 1st (vote spam doesn't pay).
- A confirmation ("I see this too") counts four times as much as an upvote because it is checked on site: within `confirm_radius_m` (200 m, plus GPS error up to 100 m) and, since 0053, with a live photo from the in-app camera (a one-time code from the server, stamped on the photo, uploaded within `live_capture_seconds`). Gallery photos and faked GPS alone no longer add confirmations. Fix photos are live too, so a fake "it's fixed" photo can't take a real issue off the map. City Corporation officials' fix photos are normal evidence (0070). `app_settings.live_issue_evidence` switches the live rule off, e.g. for a demo on a laptop.
- Severity: the category's default until 3 people vote on it, then the median vote; a verified emergency makes it critical.
- Freshness halves every `heat_half_life_days` (30) since validation, never below `heat_min_decay` (35%). Both are in `app_settings`.
- Example: high, 2 confirmations, 4 upvotes, validated today → 3 × (1 + 1.10 + 0.40) = **7.5**.

**Hexagons.** Each issue goes into exactly one hexagon (`hex_of`); its colour is the sum of its issues' heat. The grid is fixed: its size is corrected for map stretch at one latitude, the middle of the service area (about 23.6°), so hexagons never move while you pan (0029). Colour bands are 10 / 25 / 50 / 75% of the hottest hexagon in view. Edge hexagons are counted completely, including issues just off screen (0023).

**Heat mode.** The API returns at most 1,000 rows, so nearby issues are merged into one weighted point per grid cell, with `issue_count` so "N issues in view" counts issues, not points (0014, 0027).

**Time filter** (0034). "Last 7 / 30 days" keeps issues **reported** in that time. All five map functions use the same rule (`reported_within`), so a hexagon's number, its list and the pin's summary always agree. With no time filter the app doesn't send the input at all.

**Area levels** (heat per km² in the pin's circle): Low ≤ 1.5, Moderate ≤ 5, High ≤ 12, then Severe. "No active issues" when nothing is active.

**Drawing a City Corporation's area** (Admin, `AreaDrawer`). The saved outline decides which City Corporation an issue goes to, so it should match the real area.
- **Search** first tries the bundled ward outlines (`public/data/city-wards.json`, the 2011 wards of Dhaka North and South, Chattogram, Khulna, Rajshahi, Barishal and Sylhet). A name, short name or start of a name ("DNCC", "Chittagong", "Dhaka") picks the area; if it fits more than one ("Dhaka"), the admin chooses. The wards are joined into one outline on the server (`merge_areas`). Wards added after 2011 (in Dhaka, the 2016 ones) are missing, and a note says so.
- No ward match: OpenStreetMap's outline (Nominatim). It tries the name, then without "Corporation", then without "City Corporation", because OSM calls the area "Chattogram City" or just "Bogura". Districts and bigger are left out, so "Bogura" finds the city, not Bogura District.
- **Pick thanas** (`public/data/city-thanas.json`): with an area's wards in, only the thanas the wards cover less than half of are suggested, to fill the gaps. Thanas and wards are joined with `merge_areas`, which closes gaps of up to ~30 m between neighbours, fills holes and keeps the biggest piece.
- **Draw** (freehand) and **Tap corners** for anything else. The drawer warns about a self-crossing outline, because the database refuses one.

## 4. The link (URL)

The whole view lives in the URL, so it can be shared, bookmarked and survives a reload. Defaults are left out to keep links short.

| Parameter | Meaning | Default |
|---|---|---|
| `mode` | `heat` or `pins` | hexagons |
| `category` | main category group (old links with a single category still work) | all |
| `days` | `7` or `30` | all time |
| `pins` | pin types, e.g. `active,resolved`; empty = none ticked | `active` |
| `lat`, `lng` | dropped pin; empty or impossible values are ignored | no pin |
| `r` | pin circle in metres: 500, 2000, 5000 | 1000 |
| `place`, `issue` | pin name, and the issue it came from | none |

Example: `/map?mode=pins&days=7&pins=active,resolved&lat=23.87&lng=90.39&r=2000`

## 5. Files

Everything for the map is in `code/web/src/features/map/`:

| File | What it holds |
|---|---|
| `pages/MapPage.tsx` | The page: URL, viewport, data query, buttons, Filters, empty message |
| `services/map.service.ts` | `MapService`: `getMapIssues`, `getHeatmapHex`, `getHeatmapPoints`, `getHexIssues`, `getAreaSummary` |
| `components/layers/` | What's drawn, one file each: `ClusterLayer` (pins), `HeatLayer`, `HexLayer`, `SearchPinLayer`, `DropPinOnHold` |
| `components/HexPanel.tsx` | The clicked hexagon: area name + issue list |
| `components/AreaPanel.tsx` | The dropped pin's summary |
| `components/MapSearch.tsx` | Search box: places, issues, coordinates, keyboard, screen readers |
| `components/ViewportWatcher.tsx`, `FocusController.tsx` | Reading the visible box; moving the map to a search result |
| `components/MapLegend.tsx`, `HeatmapHelp.tsx` | The legends; "How is the heat calculated?" |
| `components/LocationPicker.tsx`, `MiniMap.tsx` | The report form map; the read-only map on an issue |
| `components/area-drawer/` | The Admin area map: search (2011 wards, else OpenStreetMap), thanas, freehand drawing, corners. `wards.ts` and `thanas.ts` load their outline files; `areaNames.ts` matches a typed name ("DNCC", "Chittagong") to an area |
| `lib/viewport.ts` | Hexagon size per zoom, keeping the view inside real coordinates, the dropped pin and its radius |
| `lib/urlFilters.ts` | Pin types and time range as they are kept in the link |
| `lib/hexGrid.ts` | Hexagon colours, identity, middle, size, and which issues fall inside one |
| `lib/pins.ts` | "N issues in view", the pin limit, cluster labels, when a pin is redrawn |
| `lib/heat.ts` | Heat layer colours and scale, an area's heat level |
| `lib/outline.ts` | Area outlines for the Admin drawer: converting, simplifying, self-crossing check |
| `lib/leaflet.ts` | Pin icons (made once per colour and kind) and the tile address |

Shared with the rest of the app, in `code/web/src/shared/geo/`: `LocationService` (GPS), `PlaceSearchService` (Photon, Nominatim, addresses and area names), `distance.ts` and `placeText.ts` (pure search helpers).

## 6. Database

| SQL function | Returns | Newest version |
|---|---|---|
| `heatmap_hex` | hexagons: shape, heat, issue count, top group | 0034 |
| `heatmap_points` | merged heat points with issue counts | 0034 |
| `map_issues` | up to 2,000 pins | 0034 |
| `hex_issues` | the most serious issues in one hexagon + exact total | 0034 |
| `area_heat_summary` | the pin's circle: counts, heat, groups, hottest | 0034 |
| `issue_heat_weight` | one issue's heat | 0003 |
| `hex_size_3857`, `hex_of` | the fixed hexagon grid (internal) | 0029 |
| `reported_within` | the time rule (internal) | 0034 |
| `merge_areas` | joins ward / thana outlines into one area outline (super admins) | 0046 |
| `use_live_capture`, `attach_media` | live photo check for confirmations and fixes (feeds the confirmation count) | 0053, 0070 |

When a function is changed, the **newest migration that defines it** is the one that runs. Changing a function's inputs means dropping the old version, creating the new one and granting it again (see 0034).

Map history: 0003 first map functions · 0006 area summary · 0013 category groups · 0014 heat under the row limit · 0015 top group per hexagon · 0023 complete edge hexagons · 0027 heat point counts · 0029 fixed grid · 0030 hexagon list from the server · 0034 time filter · 0046 area outlines from thanas (and later wards) · 0053 live photos for confirmations and fixes · 0070 officials' fixes use normal evidence. Migrations 0035–0078 don't change the map functions.

## 7. Tests

```bash
cd code/web
npm test          # everything, no database needed
npx vitest        # re-run on save
```

| Test file | Covers |
|---|---|
| `features/map/lib/*.test.ts` | hexagon sizes and colours, radius, pin links, view clamp, URL filters, counts, levels, area drawing |
| `features/map/services/map.service.test.ts` | the time filter is sent only when set (a fake Supabase client is passed to `MapService`) |
| `features/map/lib/leaflet.test.ts` | pin icons are reused, bad colours are refused |
| `features/map/components/**/*.test.tsx` | search box, area panel, hexagon panel, area drawer, pin and hexagon layers (simulated browser) |
| `features/map/components/area-drawer/*.test.ts` | ward loading and coverage, thanas, matching typed names to areas ("DNCC", "Chittagong") |
| `features/map/pages/MapPage.test.tsx` | time filter, share button, pin links, zoom buttons, load errors |
| `shared/geo/*.test.ts` | distances, coordinates, address clean-up, Bangla search, search per area, area names, GPS (fake internet and GPS) |

Database checks for the map are in `code/supabase/tests/scenario_v3.sql` (run with `run_local.sh` on a local Postgres with PostGIS).

## 8. Where to change common things

| Change | Where |
|---|---|
| Hexagon colours | `HEX_COLORS` in `lib/hexGrid.ts` (legend and panels follow) |
| Hexagon size per zoom | `hexSizeForZoom` in `lib/viewport.ts` (update its test) |
| Pin circle sizes | `RADII` in `lib/viewport.ts` |
| Time choices | `TIME_RANGES` in `lib/urlFilters.ts` (the database accepts 1 to 3650 days) |
| Area level names / limits | `HEAT_LEVELS` in `lib/heat.ts` |
| How fast heat fades | `update app_settings set heat_half_life_days = 14 where id = 1;` (no code) |
| Severity weights | `severity_weight` in a new migration |
| A new filter for every map view | new migration (input on all five functions) → `map.service.ts` → `MapPage.tsx` URL + query key + panels |

Always run `npm test` after a change, and update the test that describes the old behaviour.

## 9. Known limits

- Hexagon colours are relative to the view, so a hexagon can change colour when you pan to a hotter or calmer area; its heat score doesn't.
- Pins stop at 2,000 per view (the map says so).
- Place names and search come from free outside services (Photon, Nominatim); if they are down, search shows an error and panels say "This area".
- A hexagon is named after its middle point, which can sit just inside the next neighbourhood.
- Every pan beyond the rounding loads again, even inside the area already loaded.
- The bundled ward outlines are from 2011: newer wards (Dhaka's 2016 ones) and City Corporations without ward data need thanas, OpenStreetMap or drawing.
- A live photo proves where and when the code was issued, not what the photo shows; people on site and admins still judge that.

## 10. Questions to be ready for

- **Why hexagons?** Equal size and equal distance to every neighbour, so areas compare fairly, and each issue is counted once.
- **Why aren't unverified or fixed issues on the heatmap?** It should show real, current problems.
- **What happens when I pan?** `moveend` → new box → new React Query key → `mapService` → SQL function → layer updates in place.
- **Why SQL functions instead of reading tables?** One place for the rules, safe columns only, nothing the browser can change.
- **Why `ln` in the heat formula?** So many upvotes can't outweigh a few on-site confirmations.
- **Why is the grid fixed (0029)?** Correcting the stretch for the screen's own latitude moved the whole grid on every pan.
- **Why merge heat points?** The API returns at most 1,000 rows.
- **How do the hexagon number and its list always match?** Both use `hex_of` and the same status, category and time rules.
- **How is the map shared?** Everything is in the URL; the button copies it.
- **Can someone fake confirmations to heat up an area?** Each one needs the person within 200 m and a live in-app photo whose one-time code was issued there and uploaded within the time limit (0053), so old gallery photos don't work.
- **Where do City Corporation areas come from?** 2011 ward outlines joined on the server, topped up with thanas, or OpenStreetMap's outline, then checked by the admin.
- **How was it tested?** Vitest unit tests for the calculations, React Testing Library for the panels and page with fake data, SQL scenario checks for the functions.
