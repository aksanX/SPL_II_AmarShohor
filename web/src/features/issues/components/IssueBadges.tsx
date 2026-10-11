// Small labels shown on an issue: its status, severity, category and how close it is to being validated.
import clsx from 'clsx'
import { CategoryIcon } from '@/features/categories/lib/categories'
import { SEVERITY_META, STATUS_META } from '@/features/issues/lib/issueLabels'
import type { Issue, IssueStatus, Severity } from '@/models'

export function StatusBadge({ status }: { status: IssueStatus }) {
  const m = STATUS_META[status]
  return <span className={clsx('chip', m.tone)} title={m.help}>{m.label}</span>
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const m = SEVERITY_META[severity]
  return <span className={clsx('chip', m.tone)}>{m.label}</span>
}

export function CategoryChip({ issue }: { issue: Pick<Issue, 'category_icon' | 'category_color' | 'category_name'> }) {
  return (
    <span className="chip" style={{ background: `${issue.category_color}1f`, color: issue.category_color }}>
      <CategoryIcon icon={issue.category_icon} className="size-3.5" />
      {issue.category_name}
    </span>
  )
}

/** Progress toward community validation. */
export function ValidationMeter({ issue, minSupporters = 2 }: { issue: Issue; minSupporters?: number }) {
  const pct = Math.min(100, (issue.validation_score / Math.max(issue.validation_threshold, 0.01)) * 100)
  const supporters = issue.upvote_count + issue.confirmation_count
  const needPeople = Math.max(0, minSupporters - supporters)
  return (
    <div className="rounded-lg bg-warn-soft/60 px-3 py-2">
      <div className="mb-1 flex items-center justify-between text-xs font-semibold text-warn">
        <span>Community validation</span>
        <span>
          {Number(issue.validation_score).toFixed(1)} / {Number(issue.validation_threshold)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-card">
        <div className="h-full rounded-full bg-warn transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">
        {pct >= 100 && needPeople > 0
          ? `Needs ${needPeople} more supporter${needPeople > 1 ? 's' : ''}.`
          : 'Upvote if it\'s real. Confirm on-site with a photo to count double.'}
      </p>
    </div>
  )
}
