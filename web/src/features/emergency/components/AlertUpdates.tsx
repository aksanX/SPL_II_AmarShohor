import { timeAgo } from '@/shared/lib/format'
import type { AlertUpdate } from '@/models'

/** Public notes on the alert: City Corporation updates, an official ending it, an admin removing it. */
export function AlertUpdates({ updates }: { updates: AlertUpdate[] }) {
  if (!updates.length) return null
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Updates</p>
      <ul className="space-y-2">
        {updates.map((u, i) => (
          <li key={i} className="rounded-lg bg-bg p-3 text-sm">
            <span className="text-xs font-semibold text-muted">
              {u.by_admin ? 'Admin' : `${u.authority ?? 'City Corporation'} official`} · {timeAgo(u.created_at)}
              {u.kind === 'ended' && ' · ended the alert'}
            </span>
            <p className="whitespace-pre-line">{u.note}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
