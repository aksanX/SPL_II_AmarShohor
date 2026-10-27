import { useQuery } from '@tanstack/react-query'
import { Siren } from 'lucide-react'
import { Link } from 'react-router-dom'
import { locationService } from '@/shared/geo/location.service'
import { timeAgo } from '@/shared/lib/format'
import { EMERGENCY_LABEL } from '@/features/emergency/lib/emergencyLabels'
import { emergencyService } from '@/features/emergency/services/emergency.service'

/** Live emergency alerts, nearest first when we know where the user is. */
export function ActiveAlerts() {
  const pos = locationService.getLastKnownPosition()
  const alerts = useQuery({
    queryKey: ['alerts', 'active', pos?.lat.toFixed(2), pos?.lng.toFixed(2)],
    queryFn: () => emergencyService.getActiveAlerts(pos?.lat ?? null, pos?.lng ?? null),
    refetchInterval: 60_000,
  }).data ?? []
  if (!alerts.length) return null
  return (
    <div className="mb-3 space-y-2">
      {alerts.slice(0, 3).map((a) => (
        <Link key={a.id} to={`/alert/${a.id}`} className="flex items-center gap-3 rounded-xl bg-danger p-3 text-danger-ink hover:brightness-110">
          <Siren className="size-6 shrink-0" />
          <span className="min-w-0 flex-1 text-sm">
            <strong className="block truncate">
              {/* The same names as the alert page ("Live electric wire", not "Live wire"). */}
              {EMERGENCY_LABEL[a.kind] ?? 'Emergency'}{a.address && ` near ${a.address}`}
            </strong>
            {a.confirm_count > 0 ? `Confirmed by ${a.confirm_count} nearby` : 'Unverified'} · {timeAgo(a.created_at)} · stay away
          </span>
        </Link>
      ))}
    </div>
  )
}
