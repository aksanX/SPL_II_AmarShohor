import { LocateFixed, MapPin } from 'lucide-react'
import { formatDistance } from '@/shared/geo/distance'
import { Spinner } from '@/shared/ui'
import { useOnSiteLocation } from '@/features/issues/hooks/useOnSiteLocation'

export function LocationStatus({ loc, radius }: { loc: ReturnType<typeof useOnSiteLocation>; radius: number }) {
  const ok = loc.distance !== null && loc.distance <= radius + Math.min(loc.pos?.accuracy ?? 0, 100)
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <MapPin className={ok ? 'size-5 text-brand' : 'size-5 text-muted'} />
          {loc.distance === null ? (
            <span className="text-muted">You must be within {radius} m of the issue.</span>
          ) : ok ? (
            <span className="font-semibold text-brand">You're on-site ({formatDistance(loc.distance)} away)</span>
          ) : (
            <span className="font-semibold text-danger">
              You're {formatDistance(loc.distance)} away — go within {radius} m
            </span>
          )}
        </div>
        <button type="button" className="btn-soft shrink-0" onClick={loc.locate} disabled={loc.locating}>
          {loc.locating ? <Spinner className="size-4" /> : <LocateFixed className="size-4" />}
          {loc.pos ? 'Refresh' : 'Use my location'}
        </button>
      </div>
      {loc.pos && <p className="mt-1 text-xs text-muted">GPS accuracy ±{Math.round(loc.pos.accuracy)} m</p>}
      {loc.error && <p className="mt-1 text-xs text-danger">{loc.error}</p>}
    </div>
  )
}
