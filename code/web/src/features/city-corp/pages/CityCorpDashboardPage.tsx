import { Navigate } from 'react-router-dom'
import { useTitle } from '@/shared/hooks/useTitle'
import { PageSpinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { OfficialDashboard } from '@/features/city-corp/components/OfficialDashboard'
import { EmergencyReviews } from '@/features/emergency/components/EmergencyReviews'
import { LiveEmergencies } from '@/features/emergency/components/LiveEmergencies'

/** Verified officials only: the work queue of their City Corporation. */
export function CityCorpDashboardPage() {
  useTitle('City Corporation dashboard')
  const { officialOf, loading } = useAuth()
  if (loading) return <PageSpinner />
  if (!officialOf) return <Navigate to="/city-corp" replace />
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-2 py-4 sm:px-4">
      <LiveEmergencies title={`Live emergencies in ${officialOf.shortName}`} />
      <EmergencyReviews />
      <OfficialDashboard shortName={officialOf.shortName} />
    </div>
  )
}
