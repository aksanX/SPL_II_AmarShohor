import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Siren } from 'lucide-react'
import { MapContainer, Marker, TileLayer } from 'react-leaflet'
import { Link, useNavigate } from 'react-router-dom'
import { getLiveAlerts } from '../lib/api'
import { EMERGENCY_LABEL, timeAgo } from '../lib/format'
import L, { TILE_ATTRIBUTION, TILE_URL, pinIcon } from '../lib/leaflet'
import type { LiveAlert } from '../lib/types'

/**
 * Live emergency alerts for the people who act on them: super admins see every area, city admins and officials their own.
 * Unverified ones too, so the City Corporation knows early. Hidden when there are none.
 */
export function LiveEmergencies({ title }: { title: string }) {
  const items = useQuery({ queryKey: ['live_alerts'], queryFn: getLiveAlerts, refetchInterval: 30_000 }).data ?? []
  if (!items.length) return null
  const live = items.filter((a) => a.status === 'active')

  return (
    <section className="card space-y-3 border-danger/40 p-4">
      <h2 className="flex items-center gap-2 font-bold text-danger">
        <Siren className="size-5" /> {title} ({live.length} live)
      </h2>
      <p className="text-sm text-muted">
        Residents raise and confirm alerts. Open one to post an update, end it, or log the damage it left.
      </p>
      {live.length > 0 && <AlertsMap alerts={live} />}
      <ul className="divide-y divide-line">
        {items.map((a) => (
          <li key={a.id}>
            <Link to={`/alert/${a.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-card-hover">
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {EMERGENCY_LABEL[a.kind]}{a.address && <span className="font-normal"> near {a.address}</span>}
                </span>
                <span className="block text-xs text-muted">
                  {a.status === 'active'
                    ? `${a.confirm_count} confirm · ${a.deny_count} deny · raised ${timeAgo(a.created_at)}`
                    : `Ended ${a.ended_at ? timeAgo(a.ended_at) : ''}`}
                  {a.authority_short_name && ` · ${a.authority_short_name}`}
                  {a.followup_issue_id && ' · damage logged'}
                </span>
                {a.last_update && <span className="block truncate text-xs">Latest update: {a.last_update}</span>}
              </span>
              <span className={clsx('chip shrink-0',
                a.status !== 'active' ? 'bg-card-hover text-muted' : a.verified_at ? 'bg-danger text-danger-ink' : 'bg-warn-soft text-warn')}>
                {a.status !== 'active' ? 'Ended' : a.verified_at ? 'Verified' : 'Unverified'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function AlertsMap({ alerts }: { alerts: LiveAlert[] }) {
  const navigate = useNavigate()
  const bounds = L.latLngBounds(alerts.map((a) => [a.lat, a.lng] as [number, number]))
  return (
    <div className="isolate overflow-hidden rounded-lg border border-line" style={{ height: 220 }}>
      {/* Remount when the set of alerts changes so the map fits them again. */}
      <MapContainer key={alerts.map((a) => a.id).join()} bounds={bounds} boundsOptions={{ padding: [30, 30], maxZoom: 15 }}
        className="size-full" scrollWheelZoom={false}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        {alerts.map((a) => (
          <Marker key={a.id} position={[a.lat, a.lng]} icon={pinIcon(a.verified_at ? '#dc2626' : '#f59e0b')}
            eventHandlers={{ click: () => navigate(`/alert/${a.id}`) }} />
        ))}
      </MapContainer>
    </div>
  )
}
