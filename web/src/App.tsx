import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/Layout'
import { useAuth } from './hooks/useAuth'
import { isConfigured } from './lib/supabase'
import { lazy, Suspense } from 'react'
import { FeedPage } from './pages/FeedPage'
import { PageSpinner } from './components/ui'

// The feed loads first; other pages (and the map library) load on demand — matters on slow mobile data.
const AuthPage = lazy(() => import('./pages/AuthPage').then((m) => ({ default: m.AuthPage })))
const IssuePage = lazy(() => import('./pages/IssuePage').then((m) => ({ default: m.IssuePage })))
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })))
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })))
const NewIssuePage = lazy(() => import('./pages/NewIssuePage').then((m) => ({ default: m.NewIssuePage })))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const VolunteerPage = lazy(() => import('./pages/VolunteerPage').then((m) => ({ default: m.VolunteerPage })))

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <PageSpinner />
  if (!user) return <Navigate to="/login" replace state={{ from: window.location.pathname }} />
  return <>{children}</>
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
  if (!isConfigured) return <SetupNotice />
  return (
    <Suspense fallback={<PageSpinner />}>
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<FeedPage />} />
        <Route path="map" element={<MapPage />} />
        <Route path="issue/:id" element={<IssuePage />} />
        <Route path="new" element={<RequireAuth><NewIssuePage /></RequireAuth>} />
        <Route path="volunteer" element={<VolunteerPage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="u/:username" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="login" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  )
}
