import { useQuery } from '@tanstack/react-query'
import { Siren } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getEmergencyReviews } from '../lib/api'
import { timeAgo } from '../lib/format'

const KIND_LABEL: Record<string, string> = {
  fire: 'Fire', gas_leak: 'Gas leak', building_collapse: 'Building collapse', live_wire: 'Live electric wire',
  flood_rescue: 'People trapped by flooding', toxic_release: 'Chemical spill or toxic smoke', other: 'Emergency',
}

/** Verified emergencies waiting for this admin's or official's look at the live evidence. Hidden when none. */
export function EmergencyReviews() {
  const items = useQuery({ queryKey: ['emergency_reviews'], queryFn: getEmergencyReviews, refetchInterval: 60_000 }).data ?? []
  if (!items.length) return null
  return (
    <section className="card space-y-2 border-danger/40 p-4">
      <h2 className="flex items-center gap-2 font-bold text-danger">
        <Siren className="size-5" /> Verified emergencies to check ({items.length})
      </h2>
      <p className="text-sm text-muted">
        People on site verified these. Open each one, look at the live photos and keep or reject it.
      </p>
      <ul className="divide-y divide-line">
        {items.map((r) => (
          <li key={r.id}>
            <Link to={`/alert/${r.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-card-hover">
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {KIND_LABEL[r.kind] ?? 'Emergency'}{r.address && <span className="font-normal"> near {r.address}</span>}
                </span>
                <span className="block text-xs text-muted">
                  Verified {timeAgo(r.verified_at)} · {r.on_site_confirms} on site · {r.live_items} live photo{r.live_items === 1 ? '' : 's'}
                  {r.status !== 'active' && ` · ${r.status}`}
                  {r.issue_title && ` · issue: ${r.issue_title}`}
                </span>
              </span>
              <span className="btn-soft shrink-0 px-2.5 py-1 text-xs">Check</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
