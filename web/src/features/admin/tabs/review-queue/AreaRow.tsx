import clsx from 'clsx'
import { useState } from 'react'
import type { AreaOverviewRow } from '@/models'
import { timeAgo } from '@/shared/lib/format'
import { useCityAdminHours } from '@/features/admin/hooks/useCityAdminHours'

/** On track / falling behind / no admin, from the overview numbers. */
function areaStatus(row: AreaOverviewRow, now: number): { label: string; tone: string } {
  if (!row.area_id) {
    return row.open_cases ? { label: 'Yours to decide', tone: 'bg-danger-soft text-danger' } : { label: 'Nothing waiting', tone: 'bg-card-hover text-muted' }
  }
  if (!row.admins.length) return { label: 'No admin', tone: 'bg-danger-soft text-danger' }
  if (row.overdue_cases > 0) return { label: 'Falling behind', tone: 'bg-warn-soft text-warn' }
  const quietDays = row.last_action_at ? (now - Date.parse(row.last_action_at)) / 86_400_000 : Infinity
  if (row.open_cases > 0 && quietDays > 3) return { label: 'Inactive', tone: 'bg-warn-soft text-warn' }
  return { label: 'On track', tone: 'bg-brand-soft text-brand' }
}

export function AreaRow({ row, open, onToggle }: { row: AreaOverviewRow; open: boolean; onToggle: () => void }) {
  const hours = useCityAdminHours()
  const [now] = useState(() => Date.now())
  const status = areaStatus(row, now)
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left text-sm hover:bg-card-hover">
      <span className="min-w-40 flex-1">
        <span className="font-semibold">{row.area}</span>
        <span className="block text-xs text-muted">
          {!row.area_id ? 'Cases nobody else covers'
            : row.admins.length ? row.admins.map((a) => `@${a.username}`).join(', ') : 'No admin appointed yet'}
        </span>
      </span>
      <span className="flex flex-wrap gap-1 text-xs">
        <span className="chip bg-card-hover text-muted">{row.open_cases} open</span>
        {row.overdue_cases > 0 && <span className="chip bg-warn-soft text-warn">{row.overdue_cases} over {hours} h</span>}
        {row.pending_emergencies > 0 && <span className="chip bg-danger-soft text-danger">{row.pending_emergencies} emergenc{row.pending_emergencies === 1 ? 'y' : 'ies'} to check</span>}
        {row.area_id && row.admins.length > 0 && (
          <>
            <span className="chip bg-card-hover text-muted">
              {row.decided_30d} decided in 30 days{row.avg_hours_to_decide !== null && `, ~${Math.round(row.avg_hours_to_decide)} h each`}
            </span>
            <span className="chip bg-card-hover text-muted">{row.last_action_at ? `Active ${timeAgo(row.last_action_at)}` : 'Not active yet'}</span>
          </>
        )}
      </span>
      <span className={clsx('chip shrink-0', status.tone)}>{status.label}</span>
    </button>
  )
}
