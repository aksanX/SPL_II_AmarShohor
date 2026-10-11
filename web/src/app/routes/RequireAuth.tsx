import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { returnPath } from '@/features/auth/lib/auth'
import { PageSpinner } from '@/shared/ui'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <PageSpinner />
  // Keep the ?query too, e.g. /new?lat=…&lng=… from the map, so logging in returns to the same form.
  if (!user) return <Navigate to="/login" replace state={{ from: returnPath(location) }} />
  return <>{children}</>
}
