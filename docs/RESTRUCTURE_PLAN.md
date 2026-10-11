# Web restructure plan (proposal)

Status: **proposal, nothing moved yet.** Please read it and comment before anyone starts. Moving files breaks every open branch, so the team needs to agree on it and pick a time for it first.

Scope: `web/src` only. `supabase/` stays as it is.

---

## 1. Why

Today `web/src` is split by *file kind* (`components/`, `pages/`, `hooks/`, `lib/`). To follow one feature, such as the map, you open five folders. A few files have grown very large:

| File | Lines | Problem |
|---|---|---|
| `pages/AdminPage.tsx` | 1102 | 6 admin tabs + editors in one file |
| `components/VolunteerPanel.tsx` | 762 | ~14 task-state components in one file |
| `lib/types.ts` | 659 | every type for every feature |
| `pages/EmergencyPage.tsx` | 546 | 2 pages + 6 sub-components |
| `lib/api.ts` | 471 | ~150 backend calls, all features mixed |
| `lib/geo.ts` | 425 | GPS, reverse geocoding and place search together |
| `components/IssueDialogs.tsx` | 378 | 4 dialogs + 3 hooks |
| `components/Layout.tsx` | 381 | top bar, sidebars, bottom nav, alerts |
| `pages/CityCorpPage.tsx` | 237 | 4 separate routed pages |

Goals:
1. **Easy to trace**: everything for one feature lives in one folder.
2. **Modular**: features depend on each other only through a small public `index.ts`.
3. **OOP where it fits**: the backend layer becomes service classes that share one base class. React components and hooks **stay functions**, because React's own guidance is function components.
4. **No behaviour change.** This is a move and split only. All tests must pass after each step.

---

## 2. Target structure

```
web/src/
  main.tsx                      entry point (index.html points here, so it stays)
  app/                          wiring the whole app together
    App.tsx                     routes
    providers.tsx               QueryClient + Auth + Toast providers (from main.tsx)
    ErrorBoundary.tsx
    layout/                     the app shell, split out of Layout.tsx
      AppShell.tsx  FeedLayout.tsx  TopBar.tsx  BottomNav.tsx
      LeftSidebar.tsx  RightSidebar.tsx  ActiveAlerts.tsx  nav.ts
    pages/NotFoundPage.tsx

  core/                         infrastructure, no React, no feature knowledge
    supabase.ts                 client, mediaUrl, MEDIA_BUCKET  (was lib/supabase.ts)
    api/
      AppError.ts
      BaseService.ts            rpc() / select() / error mapping, shared by all services

  types/                        domain model, split by domain, with index.ts barrel
    issue.ts  media.ts  category.ts  profile.ts  settings.ts  comment.ts
    notification.ts  map.ts  role.ts  authority.ts  volunteer.ts  emergency.ts
    index.ts                    `import type { Issue } from '@/types'` keeps working

  shared/                       used by many features, knows nothing about any one feature
    ui/                         Avatar  Spinner  PageSpinner  Empty  LoadError  Modal  NoPhoto
    hooks/                      useTitle  useTheme  useToast
    lib/                        format.ts (generic: timeAgo, compact, formatBytes, displayName…)
    geo/                        LocationService.ts (GPS + last fix), distance.ts
    settings/                   appSettings.service.ts + useAppSettings
    components/ThemeToggle.tsx

  features/
    <feature>/
      index.ts                  PUBLIC API: the only file other features may import
      <feature>.service.ts      service class + singleton instance
      pages/                    routed pages
      components/               UI used by this feature
      hooks/                    feature hooks (React Query wrappers etc.)
      lib/                      pure logic, no React, unit-tested
      *.test.ts(x)              tests stay next to the file they test
```

Features: `auth`, `feed`, `issues`, `comments`, `categories`, `media`, `map`, `volunteer`, `emergency`, `city-corp`, `admin`, `profile`, `settings`, `notifications`, `leaderboard`, `landing`, `legal`.

### Dependency rules

```
app  →  features  →  shared  →  core
          ↓  ↘         ↓
        types  ←───────┘
```

- `core` imports nothing from the app.
- `shared` never imports from `features`.
- A feature imports another feature **only** through its `index.ts` (`@/features/issues`), never a deep path (`@/features/issues/components/IssueCard`).
- Inside a feature, use relative imports.
- Types live in `types/` so features can share `Issue` and similar types without import cycles between features.

The "no deep imports" rule can be checked automatically with oxlint `no-restricted-imports` (pattern `@/features/*/*`).

### Path alias

Add `@/` → `src/` so imports stop looking like `../../../lib/api`:

```jsonc
// tsconfig.app.json
"paths": { "@/*": ["./src/*"] }
```
```ts
// vite.config.ts
resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }
```

### Naming conventions

| Kind | Name | Example |
|---|---|---|
| Component / page | `PascalCase.tsx`, one exported component per file | `HexPanel.tsx` |
| Hook | `useXxx.ts` | `useMapViewport.ts` |
| Service class | `xxx.service.ts` → `class XxxService`, `export const xxxService` | `map.service.ts` |
| Pure logic | `camelCase.ts` in `lib/` | `hexGrid.ts` |
| Types | `types/<domain>.ts` | `types/map.ts` |
| Test | same name + `.test.ts(x)`, same folder | `HexPanel.test.tsx` |

---

## 3. The OOP part: service classes

`lib/api.ts` is replaced by one service class per domain. Every service extends `BaseService`, which owns the Supabase client and the shared error handling. This gives:

- **Encapsulation**: `rpc`/`select` become `protected`, so components can't call raw RPCs.
- **Inheritance**: one place for error mapping (`AppError`, network errors).
- **Dependency injection**: a service takes its client in the constructor, so a test can pass a fake client.
- **Single responsibility**: each class covers one domain (~10–25 methods) instead of 150 mixed functions.

Note: `tsconfig` has `erasableSyntaxOnly: true`, so constructor parameter properties (`constructor(private x)`) and `enum` are not allowed. Write fields out in full.

```ts
// core/api/BaseService.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../supabase'
import { AppError, toAppError, type PgError } from './AppError'

export abstract class BaseService {
  protected readonly client: SupabaseClient

  constructor(client: SupabaseClient = supabase) {
    this.client = client
  }

  protected async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args)
    if (error) throw toAppError(error)
    return data as T
  }

  protected async select<T>(query: PromiseLike<{ data: unknown; error: PgError | null }>): Promise<T> {
    const { data, error } = await query
    if (error) throw toAppError(error)
    return data as T
  }
}
```

```ts
// features/map/map.service.ts
import { BaseService } from '@/core/api/BaseService'
import type { BBox, HexCell, MapIssue } from '@/types'

export class MapService extends BaseService {
  // Arrow-function fields, not methods: they keep `this` when passed around,
  // e.g. useQuery({ queryFn: mapService.getAreaSummary }).
  getMapIssues = (b: BBox, category: string | null, layers: string[], days: number | null = null) =>
    this.rpc<MapIssue[]>('map_issues', { /* same args as today */ })

  getHeatmapHex = (b: BBox, cellM: number, category: string | null, days: number | null = null) =>
    this.rpc<HexCell[]>('heatmap_hex', { /* … */ })
}

export const mapService = new MapService()
```

Usage in a component:

```ts
import { mapService } from '../map.service'
useQuery({ queryKey: mapKeys.hex(bbox, cell), queryFn: () => mapService.getHeatmapHex(bbox, cell, category) })
```

**Why arrow fields:** about 34 places pass API functions straight to React Query (`queryFn: getAuthorities`). A normal class method would lose `this` there and crash. Arrow fields keep that working.

### Other good OOP candidates (optional, after the main move)

| Today | Class | Why |
|---|---|---|
| `lib/geo.ts` module-level `let lastKnown` | `LocationService` | hides the last-fix state that is currently shared by the whole module |
| `lib/geo.ts` Nominatim calls | `GeocodingService` | one place for the external API, its rate limit and caching |
| `lib/media.ts` upload/delete | `MediaStorageService extends BaseService` | storage calls next to the other backend calls; `validateSelection` stays a pure function |

### Query keys

There are 34 distinct hand-typed keys (`['authorities']`, `['issue', id]`…). Each feature gets a key factory, so a search finds every query and every invalidation for one thing:

```ts
// features/issues/issue.keys.ts
export const issueKeys = {
  all: ['issue'] as const,
  detail: (id: string) => ['issue', id] as const,
  media: (id: string) => ['issue', id, 'media'] as const,
}
```

---

## 4. `api.ts` → services (every function)

| Service (file) | Functions moved from `lib/api.ts` |
|---|---|
| `AppError`, `BaseService` (`core/api/`) | `AppError`, `toAppError`, `rpc`, `select` |
| `AppSettingsService` (`shared/settings/appSettings.service.ts`) | `getAppSettings`, `adminUpdateSettings`, `getPlatformStats` |
| `CategoryService` (`features/categories/`) | `getCategories`, `getCategoryGroups`, `getAllCategories`, `adminSaveCategory` |
| `IssueService` (`features/issues/`) | `getIssue`, `getIssueMedia`, `getIssueEvents`, `findDuplicates`, `NewIssueInput`, `createIssue`, `updateIssue`, `deleteIssue`, `toggleVote`, `confirmIssue`, `flagIssue`, `unflagIssue`, `voteSeverity`, `toggleFollow`, `suggestCategory`, `withdrawCategorySuggestion`, `getCategoryVotes`, `getStillThere`, `answerStillThere`, `appealHiddenIssue`, `getMyPostingPause`, `getIssueAlert`, `mediaJson` (private helper) |
| `FeedService` (`features/feed/`) | `getFeed`, `FeedParams`, `getUserIssues` |
| `CommentService` (`features/comments/`) | `getComments`, `addComment`, `editComment`, `deleteComment`, `flagComment` |
| `VolunteerService` (`features/volunteer/`) | `setVolunteerMode`, `acceptTask`, `askForVolunteers`, `closeTeamRecruiting`, `removeTeamMember`, `getHelpRequests`, `postProgress`, `releaseTask`, `submitResolution`, `reviewResolution`, `rateVolunteer`, `getOpenTasks`, `getMyTasks`, `getRatingsFor` |
| `TeamService` (`features/volunteer/`) | `getTeam`, `joinTeam`, `leaveTeam`, `checkIn`, `offerLead`, `acceptLead`, `getOpenTeams` |
| `LeaderboardService` (`features/leaderboard/`) | `getLeaderboard` |
| `MapService` (`features/map/`) | `BBox`, `getMapIssues`, `getHeatmapHex`, `getHexIssues`, `getHeatmapPoints`, `getAreaSummary` |
| `ProfileService` (`features/profile/`) | `isUsernameTaken`, `getProfileByUsername`, `getProfileById`, `updateMyProfile` |
| `AccountService` (`features/settings/`) | `getMySettings`, `updateMySettings`, `deleteMyAccount` |
| `NotificationService` (`features/notifications/`) | `getNotifications`, `markNotificationsRead` |
| `AuthorityService` (`features/city-corp/`) | `getAuthorities`, `getAuthorityRecords`, `getAuthorityTasks`, `requestSendBack`, `AuthorityInput`, `adminSaveAuthority`, `mergeAreas` |
| `RoleService` (`features/admin/`) | `getRoles`, `getRolesOf`, `getMyRoleRequest`, `getRoleRequests`, `adminDecideRoleRequest`, `adminGrantAdmin`, `adminRevokeRole`, `adminDeleteAccount`, `adminGrantCityAdmin` |
| `ModerationService` (`features/admin/`) | `getReviewQueue`, `getAreaOverview`, `getAdminLog`, `adminSetRoute`, `adminDecideEscalation`, `adminDecideWrongReport`, `adminDecideAppeal`, `adminDecideCategory`, `adminDismissReview`, `adminRemoveAssignee`, `adminRequestHelp`, `adminReferIssue`, `canAdminIssue`, `getUnusedUploads` |
| `EmergencyService` (`features/emergency/`) | `getActiveAlerts`, `getAlert`, `getEmergencyContactsAt`, `createEmergencyAlert`, `respondEmergency`, `getEmergencyReviews`, `reviewEmergency`, `getLiveAlerts`, `postAlertUpdate`, `officialEndAlert`, `adminHideAlert`, `officialLogDamage` |
| `MediaStorageService` (`features/media/`) | `startLiveCapture` (+ upload/delete from `lib/media.ts`) |

Rule used: a function goes to the service for the **thing it acts on**, not the role that calls it. For example `adminSaveCategory` goes to `CategoryService`. The exception is moderation decisions (`adminDecide*`), which are grouped in `ModerationService` because they are one workflow.

---

## 5. File move map (every file)

Tests (`X.test.tsx`) move with `X.tsx` and are not listed separately unless they are split.

### app / core / types / shared

| From | To |
|---|---|
| `App.tsx` | `app/App.tsx` |
| `main.tsx` | stays; provider setup moves to `app/providers.tsx` |
| `components/ErrorBoundary.tsx` | `app/ErrorBoundary.tsx` |
| `components/Layout.tsx` | split into `app/layout/` (AppShell, FeedLayout, TopBar, BottomNav, LeftSidebar, RightSidebar, ActiveAlerts, nav.ts) |
| `pages/NotFoundPage.tsx` | `app/pages/NotFoundPage.tsx` |
| `lib/supabase.ts` | `core/supabase.ts` |
| `lib/api.ts` | split into services (section 4) |
| `lib/types.ts` | split into `types/*.ts` (section 6) |
| `components/ui.tsx` | generic parts → `shared/ui/*.tsx`; issue badges → `features/issues/components/badges/`; `VolunteerBadge` → `features/volunteer/components/` |
| `components/ThemeToggle.tsx` | `shared/components/ThemeToggle.tsx` |
| `hooks/useTitle.ts`, `useTheme.ts`, `useToast.tsx` | `shared/hooks/` |
| `hooks/useData.ts` | split: `useCategories`/`useCategoryGroups` → categories, `useAppSettings` → `shared/settings`, `useMySettings` → settings, `useNotifications` → notifications |
| `lib/format.ts` | generic → `shared/lib/format.ts`; `STATUS_META`, `SEVERITY_META`, `SEVERITIES`, `ROUTE_LABEL`, `dueText` → `features/issues/lib/issueLabels.ts`; `EMERGENCY_LABEL` → emergency; `areaLabel` → city-corp |
| `lib/geo.ts` | `shared/geo/LocationService.ts` (`getCurrentPosition`, `getLastKnownPosition`, `DHAKA`), `shared/geo/distance.ts` (`distanceM`, `formatDistance`), `features/map/lib/geocoding.ts` (`reverseGeocode`, `areaName`, `searchBoundaries`, `searchPlaces`, `parseLatLng`, address cleaning) |
| `test/utils.tsx` | `test/utils.tsx` (stays) |
| `types.d.ts`, `index.css` | stay |

### features

| Feature | Files moved in |
|---|---|
| **auth** | `components/AuthForm.tsx`, `components/Captcha.tsx`, `lib/auth.ts` → `lib/`, `lib/captcha.ts` → `lib/`, `hooks/useAuth.tsx` → `hooks/` (`AuthProvider`, `useAuth`), `pages/ResetPasswordPage.tsx` |
| **feed** | `pages/FeedPage.tsx`, `components/HomeAreaPrompt.tsx` |
| **issues** | `pages/IssuePage.tsx` (split out `CategoryVotes`, `RaiseEmergency`, `SeverityVote`, `Timeline`, `Evidence` into `components/issue-detail/`), `pages/NewIssuePage.tsx` (draft storage → `lib/reportDraft.ts`), `components/IssueCard.tsx`, `components/StillThereBox.tsx`, `components/IssueDialogs.tsx` → `components/dialogs/{ConfirmOnSiteDialog,FlagDialog,EditIssueDialog,AppealDialog,LocationStatus}.tsx` + `hooks/{useInvalidateIssue,useDeleteIssue,useOnSiteLocation}.ts`, `components/OnSiteEvidence.tsx` |
| **comments** | `components/Comments.tsx` |
| **categories** | `components/CategoryBrowser.tsx`, `components/CategorySelect.tsx`, `lib/categories.tsx` → `components/CategoryIcon.tsx` + `lib/categoryTree.ts` + `lib/emergencyVersion.ts`, `hooks/useCategoryFilter.ts` |
| **media** | `components/MediaGallery.tsx`, `components/MediaPicker.tsx`, `components/LiveCamera.tsx`, `lib/media.ts` → `lib/mediaValidation.ts` + `media.service.ts` |
| **map** | `pages/MapPage.tsx` (split out `ViewportWatcher`, `FocusController`), `components/map/*` → `components/` (`AreaPanel`, `HexPanel`, `MapSearch`, `LocationPicker`, `AreaDrawer`), `layers.tsx` → `components/layers/{ClusterLayer,HeatLayer,HexLayer,SearchPinLayer,DropPinOnHold}.tsx`, `lib/mapMath.ts` → `lib/{hexGrid,heat,polygon,mapParams}.ts`, `lib/leaflet.ts` → `lib/leaflet.ts`, `components/CityMap3D.tsx` → landing (see below) |
| **volunteer** | `pages/VolunteerPage.tsx`, `lib/volunteer.ts` → `lib/taskText.ts`, `components/VolunteerPanel.tsx` → `components/task-panel/` (`VolunteerPanel` keeps only the "which state am I in" switch; `AcceptTask`, `WorkingOnIt`, `AskForMembers`, `TeamPanel`, `MyActiveTask`, `ReleaseDialog`, `OfficialAccept`, `ResolutionReview`, `UnderReviewNote`, `Closed`, `RouteInfo`, `Note` each get a file) |
| **emergency** | `pages/EmergencyPage.tsx` → `pages/EmergencyPage.tsx` + `pages/AlertPage.tsx` + `components/{CallFirst,ReviewBox,AlertUpdates,OfficialTools,DamageForm,AdminRemove}.tsx`, `components/LiveEmergencies.tsx`, `components/EmergencyReviews.tsx` |
| **city-corp** | `pages/CityCorpPage.tsx` → `pages/{CityCorpPage,CityCorpDashboardPage,OfficialSignupPage,OfficialWaitingPage}.tsx` + `components/{OfficialDashboard,AuthorityTaskRow,PublicRecord,Stat}.tsx` |
| **admin** | `pages/AdminPage.tsx` → `pages/AdminPage.tsx` (tab switch only) + `tabs/review-queue/{ReviewQueue,SuperAdminQueue,ReviewCard,RoutingChip,AreaRow}.tsx` + `tabs/{PeopleTab,CityCorporationsTab,AuthorityEditor,CategoriesTab,CategoryEditor,SettingsTab,ActivityLogTab}.tsx` + `hooks/{useRunner,useCityAdminHours}.ts`; `components/AdminIssueTools.tsx`, `components/UnusedUploads.tsx` |
| **profile** | `pages/ProfilePage.tsx`, `lib/profile.ts` → `lib/profileStats.ts` + `lib/reportsCsv.ts` |
| **settings** | `pages/SettingsPage.tsx`, `components/DeleteAccount.tsx` |
| **notifications** | `pages/NotificationsPage.tsx` |
| **leaderboard** | `pages/LeaderboardPage.tsx` |
| **landing** | `pages/LandingPage.tsx`, `components/CityMap3D.tsx` |
| **legal** | `pages/LegalPages.tsx` → `pages/TermsPage.tsx` + `pages/PrivacyPage.tsx` |

Tests of files that get split are split the same way, e.g. `mapMath.test.ts` → `hexGrid.test.ts`, `heat.test.ts`, …

---

## 6. `types.ts` split

| `types/` file | Types |
|---|---|
| `issue.ts` | `IssueStatus`, `Severity`, `FlagReason`, `Route`, `Issue`, `IssueEvent`, `DuplicateCandidate`, `FeedSort`, `FeedScope`, `StillThereState` |
| `media.ts` | `MediaKind`, `MediaType`, `MediaItem`, `UploadedMedia`, `UnusedUpload` |
| `category.ts` | `Category`, `CategoryGroup` |
| `profile.ts` | `Profile`, `MySettings`, `LeaderboardRow`, `Rating` |
| `settings.ts` | `AppSettings` |
| `comment.ts` | `Comment` |
| `notification.ts` | `Notification` |
| `map.ts` | `MapIssue`, `HexIssue`, `HexCell`, `HeatPoint`, `AreaSummary`, `BBox` |
| `role.ts` | `AppRole`, `UserRole`, `ReviewKind`, `ReviewItem`, `AreaOverviewRow`, `RoleRequest`, `MyRoleRequest`, `AdminLogRow` |
| `authority.ts` | `Authority`, `AuthorityRecord`, `EmergencyContact` |
| `volunteer.ts` | `TeamMember`, `ReleaseKind`, `WrongType` |
| `emergency.ts` | `EmergencyKind`, `EmergencyAlert`, `AlertUpdate`, `LiveAlert`, `EmergencyReview` |
| `index.ts` | `export type * from './issue'` … for every file |

---

## 7. Tests

The test files stay, but their module mocks change from functions to service objects:

```ts
// before
vi.mock('../lib/api', () => ({ getHeatmapHex: vi.fn(), getMapIssues: vi.fn() }))
vi.mocked(getHeatmapHex).mockResolvedValue([...])

// after
vi.mock('@/features/map/map.service', () => ({
  mapService: { getHeatmapHex: vi.fn(), getMapIssues: vi.fn() },
}))
vi.mocked(mapService.getHeatmapHex).mockResolvedValue([...])
```

There are about 21 `vi.mock(...lib/api)` calls and about 70 other `vi.mock` calls whose paths change. Always mock the **service file**, not a feature's `index.ts`. Mocking the barrel would replace everything that feature exports.

Service classes can also be tested directly with a fake client:

```ts
const client = { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) }
await new MapService(client as never).getHeatmapHex(bbox, 500, null)
expect(client.rpc).toHaveBeenCalledWith('heatmap_hex', expect.objectContaining({ p_cell_m: 500 }))
```

---

## 8. Rollout

### When
A whole-tree move conflicts with **every** open branch. Two safe options:
1. **Freeze day.** Everyone merges their open PRs to `main`, then nobody pushes to `web/src` until the restructure PR is merged (about a day). Then everyone branches fresh from `main`.
2. **After the viva (28 Oct).** No risk to the demo.

Don't do it in the last week before the viva.

### Order (tests and `npm run build` pass after every step, one commit per step)

1. Add the `@/` alias. No moves yet.
2. Split `types.ts` into `types/` with an `index.ts` barrel; make `lib/types.ts` re-export it for now.
3. Add `core/api/BaseService.ts` and all service classes. `lib/api.ts` becomes a temporary shim (`export const getIssue = issueService.getIssue`, …) so nothing else changes yet.
4. Move files into `features/` with **`git mv`** (keeps history; `git log --follow` and blame still work). Fix imports. Update test mock paths.
5. Switch callers from the shim to the services feature by feature, then delete `lib/api.ts` and `lib/types.ts`.
6. Split the large files (AdminPage, VolunteerPanel, EmergencyPage, IssueDialogs, Layout, CityCorpPage, IssuePage, geo, format, ui, mapMath).
7. Add each feature's `index.ts`, add the oxlint no-deep-import rule, and add query-key factories.
8. Update the "Project structure" section of `README.md`.

Steps 1–3 can be merged at any time without breaking other branches, because no file moves. The conflicts come from steps 4–6.

### Done when
- [ ] `npm test`, `npm run build`, `npm run lint` all pass
- [ ] no file in `web/src` over ~300 lines (except tests)
- [ ] no imports of `@/features/x/...` from outside feature `x`
- [ ] `lib/`, `components/`, `pages/`, `hooks/` top-level folders are gone
- [ ] every page still opens in the browser (feed, issue, new report, map, volunteer, emergency, alert, admin, city-corp, profile, settings)
