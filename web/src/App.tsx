import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './components/Layout'
import { useAuth } from './hooks/useAuth'
import { returnPath } from './lib/auth'
import { isConfigured } from './lib/supabase'
import { lazy, Suspense } from 'react'
import { FeedPage } from './pages/FeedPage'
import { PageSpinner } from './components/ui'

// The feed loads first; other pages (and the map library) load on demand — matters on slow mobile data.
const LandingPage = lazy(() => import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })))
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })))
const IssuePage = lazy(() => import('./pages/IssuePage').then((m) => ({ default: m.IssuePage })))
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })))
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })))
const NewIssuePage = lazy(() => import('./pages/NewIssuePage').then((m) => ({ default: m.NewIssuePage })))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const VolunteerPage = lazy(() => import('./pages/VolunteerPage').then((m) => ({ default: m.VolunteerPage })))
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })))
const CityCorpPage = lazy(() => import('./pages/CityCorpPage').then((m) => ({ default: m.CityCorpPage })))
const CityCorpDashboardPage = lazy(() => import('./pages/CityCorpPage').then((m) => ({ default: m.CityCorpDashboardPage })))
const OfficialSignupPage = lazy(() => import('./pages/CityCorpPage').then((m) => ({ default: m.OfficialSignupPage })))
const OfficialWaitingPage = lazy(() => import('./pages/CityCorpPage').then((m) => ({ default: m.OfficialWaitingPage })))
const EmergencyPage = lazy(() => import('./pages/EmergencyPage').then((m) => ({ default: m.EmergencyPage })))
const AlertPage = lazy(() => import('./pages/EmergencyPage').then((m) => ({ default: m.AlertPage })))

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageSpinner />
  // Keep the ?query too, e.g. /new?lat=…&lng=… from the map, so logging in returns to the same form.
  if (!user) return <Navigate to="/login" replace state={{ from: returnPath(location) }} />
  return <>{children}</>
}

/**
 * `/`: logged-out visitors get the landing page (with log in / sign up beside it). Logged-in users go to
 * their own home: admin or city admin → Admin, official → City Corporation dashboard, citizen → feed. Old feed links
 * such as `/?category=garbage` keep their filters.
 */
function HomeRoute() {
  const { user, role, loading } = useAuth()
  const { search } = useLocation()
  if (loading) return <PageSpinner />
  if (!user && !search) return <LandingPage />
  if (role === 'admin' || role === 'city_admin') return <Navigate to="/admin" replace />
  if (role === 'official') return <Navigate to="/city-corp/dashboard" replace />
  return <Navigate to={`/feed${search}`} replace />
}

/**
 * `/login`: the same landing page, with the Log in tab open. Pages that need an account send people here with
 * where they were (`state.from`), and logging in takes them back. Someone already logged in goes straight there.
 */
function LoginRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (loading) return <PageSpinner />
  if (user) return <Navigate to={from} replace />
  return <LandingPage startMode="login" redirectTo={from} />
}

function SetupNotice() {
  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="card space-y-3 p-6">
        <h1 className="text-xl font-bold">Connect AmarShohor to Supabase</h1>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Create a project at supabase.com and run the SQL files in <code>supabase/migrations</code> (see README).</li>
          <li>Copy <code>web/.env.example</code> to <code>web/.env.local</code>.</li>
          <li>Paste your Project URL and anon key from Project Settings → API.</li>
          <li>Restart <code>npm run dev</code>.</li>
        </ol>
      </div>
    </div>
  )
}

export default function App() {
  const { officialSignup } = useAuth()
  const { pathname } = useLocation()
  if (!isConfigured) return <SetupNotice />
  // An official account waiting for approval (or rejected) sees only that, never the citizen app.
  // A password reset link still works.
  if (officialSignup && pathname !== '/reset-password') {
    return <Suspense fallback={<PageSpinner />}><OfficialWaitingPage /></Suspense>
  }
  return (
    <Suspense fallback={<PageSpinner />}>
    <Routes>
      <Route index element={<HomeRoute />} />
      <Route path="login" element={<LoginRoute />} />
      <Route element={<AppShell />}>
        <Route path="feed" element={<FeedPage />} />
        <Route path="issues" element={<FeedPage browse />} />
        <Route path="map" element={<MapPage />} />
        <Route path="issue/:id" element={<IssuePage />} />
        <Route path="new" element={<RequireAuth><NewIssuePage /></RequireAuth>} />
        <Route path="volunteer" element={<VolunteerPage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="u/:username" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
        <Route path="city-corp" element={<CityCorpPage />} />
        <Route path="city-corp/dashboard" element={<RequireAuth><CityCorpDashboardPage /></RequireAuth>} />
        <Route path="city-corp/join" element={<OfficialSignupPage />} />
        <Route path="emergency" element={<EmergencyPage />} />
        <Route path="alert/:id" element={<AlertPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  )
}
