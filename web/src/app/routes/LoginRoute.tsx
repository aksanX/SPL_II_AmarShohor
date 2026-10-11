import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { PageSpinner } from '@/shared/ui'
import { LandingPage } from '@/app/routes/lazyPages'

/**
 * `/login`: the same landing page, with the Log in tab open. Pages that need an account send people here with
 * where they were (`state.from`), and logging in takes them back. Someone already logged in goes straight there.
 */
export function LoginRoute() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (loading) return <PageSpinner />
  if (user) return <Navigate to={from} replace />
  return <LandingPage startMode="login" redirectTo={from} />
}
