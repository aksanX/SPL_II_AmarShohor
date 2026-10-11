import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { PageSpinner } from '@/shared/ui'
import { LandingPage } from '@/app/routes/lazyPages'

/**
 * `/`: logged-out visitors get the landing page (with log in / sign up beside it). Logged-in users go to
 * their own home: admin or city admin → Admin, official → City Corporation dashboard, citizen → feed. Old feed links
 * such as `/?category=garbage` keep their filters.
 */
export function HomeRoute() {
  const { user, role, loading } = useAuth()
  const { search } = useLocation()
  if (loading) return <PageSpinner />
  if (!user && !search) return <LandingPage />
  if (role === 'admin' || role === 'city_admin') return <Navigate to="/admin" replace />
  if (role === 'official') return <Navigate to="/city-corp/dashboard" replace />
  return <Navigate to={`/feed${search}`} replace />
}
