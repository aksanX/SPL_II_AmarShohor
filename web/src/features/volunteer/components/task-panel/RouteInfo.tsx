import clsx from 'clsx'
import { Building2, Users } from 'lucide-react'
import { ROUTE_LABEL } from '@/features/issues/lib/issueLabels'
import type { Issue } from '@/models'

/** Who fixes it, and whether an admin changed it. */
export function RouteInfo({ issue }: { issue: Issue }) {
  const who = issue.route === 'authority' ? (issue.authority_short_name ?? ROUTE_LABEL.authority) : ROUTE_LABEL[issue.route]
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-muted">Who fixes it:</span>
        <span className={clsx('chip', issue.route === 'authority' ? 'bg-warn-soft text-warn'
          : issue.route === 'community' ? 'bg-brand-soft text-brand' : 'bg-card-hover text-muted')}>
          {issue.route === 'authority' ? <Building2 className="size-3.5" /> : <Users className="size-3.5" />} {who}
        </span>
      </div>
      {issue.route_source === 'admin' && (
        <p className="text-xs text-muted">Route decided by an admin (see the timeline for the reason).</p>
      )}
    </div>
  )
}
