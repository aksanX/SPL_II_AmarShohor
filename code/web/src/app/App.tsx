import { Suspense } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { isConfigured } from '@/core/supabase'
import { PageSpinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { FeedPage } from '@/features/feed/pages/FeedPage'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { AppShell } from '@/app/layout/AppShell'
import { HomeRoute } from '@/app/routes/HomeRoute'
import {
  NotFoundPage, ResetPasswordPage, IssuePage, LeaderboardPage, MapPage, NewIssuePage, NotificationsPage,
  ProfilePage, SettingsPage, VolunteerPage, AdminPage, CityCorpPage, CityCorpDashboardPage, OfficialSignupPage,
  OfficialWaitingPage, EmergencyPage, TermsPage, PrivacyPage, AlertPage,
} from '@/app/routes/lazyPages'
import { LoginRoute } from '@/app/routes/LoginRoute'
import { RequireAuth } from '@/app/routes/RequireAuth'
import { SetupNotice } from '@/app/SetupNotice'

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
    <ErrorBoundary resetKey={pathname}>
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
        <Route path="terms" element={<TermsPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        {/* A mistyped or old link says so, instead of silently dropping the person on the home page. */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </Suspense>
    </ErrorBoundary>
  )
}
