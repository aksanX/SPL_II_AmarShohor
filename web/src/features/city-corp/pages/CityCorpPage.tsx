import { Navigate } from 'react-router-dom'
import { PageSpinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useTitle } from '@/shared/hooks/useTitle'
import { PublicRecord } from '@/features/city-corp/components/PublicRecord'

/** Citizens and admins: each City Corporation's public record. Officials work from their dashboard. */
export function CityCorpPage() {
  useTitle('City Corporations')
  const { role, loading } = useAuth()
  if (loading) return <PageSpinner />
  if (role === 'official') return <Navigate to="/city-corp/dashboard" replace />
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-2 py-4 sm:px-4">
      <PublicRecord />
    </div>
  )
}

