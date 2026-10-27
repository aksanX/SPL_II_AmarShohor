# Web app architecture

How `code/web/src` is organised, and where new code goes. Read this before adding a page, a component or a backend call.

## 1. The layout

`code/web/src` is split by **feature**: everything for one part of the app lives in one folder.

```
code/web/src/
  main.tsx              entry point: renders <App /> inside <AppProviders />
  app/                  wiring the whole app together
    App.tsx               routes
    AppProviders.tsx      error boundary, React Query, router, toasts, signed-in user
    ErrorBoundary.tsx  SetupNotice.tsx
    layout/               AppShell, TopBar, BottomNav, LeftSidebar, RightSidebar, FeedLayout, nav.ts …
    routes/               lazyPages.ts (pages loaded on demand), RequireAuth, HomeRoute, LoginRoute
    pages/                NotFoundPage
  core/                 infrastructure, knows nothing about any feature
    supabase.ts           the Supabase client, media URLs
    api/AppError.ts       the error every backend call throws
    api/BaseService.ts    base class of every backend service
  models/               domain types, one file per domain (issue, map, media, role, …); import from '@/models'
  shared/               used by many features, knows nothing about any one of them
    ui/                   Avatar, Spinner, PageSpinner, Empty, LoadError, Modal, NoPhoto; import from '@/shared/ui'
    hooks/                useTitle, useTheme, useToast
    lib/format.ts         dates, names, numbers, file sizes
    geo/                  LocationService (GPS), PlaceSearchService (OpenStreetMap search), distance, placeText
    settings/             AppSettingsService + useAppSettings
    components/           ThemeToggle
  features/
    admin  auth  categories  city-corp  comments  emergency  feed  issues  landing
    leaderboard  legal  map  media  notifications  profile  settings  volunteer
  test/utils.tsx        shared test helpers and fixtures
```

Inside a feature, files are grouped by what they are:

```
features/<feature>/
  pages/        routed pages (one page per file)
  components/   UI used by this feature; a big component gets its own folder (e.g. issue-card/, task-panel/)
  hooks/        React hooks (data hooks, small behaviours)
  services/     backend service classes (*.service.ts)
  lib/          plain logic: no React, no network, unit tested
```

Tests sit next to the file they test: `HexPanel.tsx` → `HexPanel.test.tsx`.

## 2. Rules

1. **Dependencies point one way**: `app → features → shared → core`, and everything may use `models`.
   `core` and `shared` never import from `features`.
2. **Imports use the `@/` alias** (`@/features/map/lib/hexGrid`), never `../../`. `@/` means `code/web/src`.
3. **Import order**: npm packages, then `@/core`, `@/models`, `@/shared`, `@/features`, `@/app`.
4. **One component per file**, named like the component. Small helpers only one file uses may stay in it.
5. **No business logic in pages.** Calculations go to `lib/` (and get a test); backend calls go to a service.
6. **Pages are loaded on demand.** A new page is added to `app/routes/lazyPages.ts`, then to the routes in `App.tsx`.

## 3. Object-oriented parts

### Backend services

Every backend call lives in a service class. All services extend `BaseService`:

```ts
// core/api/BaseService.ts (shortened)
export abstract class BaseService {
  constructor(client?: SupabaseClient)               // tests pass a fake client
  protected get db(): SupabaseClient                 // the Supabase client
  protected rpc<T>(fn, args): Promise<T>              // database function → data, or throws AppError
  protected select<T>(query): Promise<T>              // table/view query → rows, or throws AppError
  protected rpcFirst<T>(fn, args): Promise<T | null>  // first row or null
  protected mediaJson(media)                          // photos/videos as the database expects them
}
```

```ts
// features/map/services/map.service.ts (shortened)
export class MapService extends BaseService {
  getHeatmapHex = (b: BBox, cellM: number, category: string | null, days: number | null = null) =>
    this.rpc<HexCell[]>('heatmap_hex', { /* … */ })
}
export const mapService = new MapService()
```

- **Encapsulation**: `rpc`, `select` and the client are `protected`, so components can only call named methods.
- **Inheritance**: error handling (`AppError.from`) is written once, in `BaseService`.
- **Dependency injection**: `new MapService(fakeClient)` in tests, no module mocking needed.
- Calls are **arrow-function fields**, so they keep `this` when passed on their own:
  `useQuery({ queryFn: categoryService.getCategories })`.

| Service | Feature | Covers |
|---|---|---|
| `AppSettingsService` | shared/settings | platform settings, landing page totals |
| `CategoryService` | categories | categories, groups, the category editor |
| `FeedService` | feed | the feed, a person's reports |
| `IssueService` | issues | report, edit, vote, confirm, flag, follow, appeal, "still there?" |
| `CommentService` | comments | comments under an issue |
| `VolunteerService`, `TeamService` | volunteer | tasks, fixes, ratings; volunteer teams |
| `LeaderboardService` | leaderboard | the leaderboard |
| `MapService` | map | pins, hexagons, heat, a hexagon's issues, area summary |
| `ProfileService` | profile | profiles |
| `AccountService` | settings | personal settings, closing the account |
| `NotificationService` | notifications | notifications |
| `AuthorityService` | city-corp | City Corporations, officials' tasks, the area editor |
| `RoleService`, `ModerationService` | admin | roles and requests; the review queue and decisions |
| `EmergencyService` | emergency | alerts, responses, reviews, officials' updates |
| `MediaService` | media | uploads, deleting unused files, live capture |

### Other classes

| Class | Where | Why a class |
|---|---|---|
| `AppError` | core/api | one error type with `code` (the SQL hint) and `isNetwork`; `AppError.from(supabaseError)` |
| `LocationService` | shared/geo | keeps the last GPS fix as private state |
| `PlaceSearchService` | shared/geo | owns the Nominatim request queue (1 per second) and the search caches |
| `MediaService` | features/media | remembers uploads per file, so a retry doesn't upload twice |

React components and hooks stay **functions**, as React recommends.

## 4. Where does new code go?

| I want to… | Put it in |
|---|---|
| call a new database function | a method on the feature's service (`features/x/services/x.service.ts`) |
| add a type returned by the database | `models/<domain>.ts` |
| add a page | `features/x/pages/`, then `app/routes/lazyPages.ts` and `app/App.tsx` |
| add a component used by one feature | `features/x/components/` |
| add a component used everywhere | `shared/ui/` (and export it from `shared/ui/index.ts`) |
| add a calculation | `features/x/lib/` with a `.test.ts` next to it |
| add a data hook | `features/x/hooks/` |

## 5. Testing

```bash
cd code/web
npm test           # all tests
npm run build      # type check + production build
npm run lint
```

Mock a service by its module, not by a feature-wide file:

```ts
vi.mock('@/features/map/services/map.service', () => ({
  mapService: { getHeatmapHex: vi.fn(), getMapIssues: vi.fn() },
}))
vi.mocked(mapService.getHeatmapHex).mockResolvedValue([])
```

Or test a service directly with a fake client:

```ts
const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
await new MapService({ rpc } as unknown as SupabaseClient).getHeatmapHex(box, 400, null)
expect(rpc).toHaveBeenCalledWith('heatmap_hex', expect.objectContaining({ p_cell_m: 400 }))
```
