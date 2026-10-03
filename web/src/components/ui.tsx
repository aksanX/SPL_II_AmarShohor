import clsx from 'clsx'
import { LoaderCircle, ShieldCheck, UserRound, X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { CategoryIcon } from '../lib/categories'
import { SEVERITY_META, STATUS_META } from '../lib/format'
import type { Issue, IssueStatus, Severity } from '../lib/types'

export function Avatar({ url, name, size = 40, anonymous = false }: {
  url?: string | null; name?: string | null; size?: number; anonymous?: boolean
}) {
  const style = { width: size, height: size }
  if (anonymous) {
    return (
      <div style={style} className="grid shrink-0 place-items-center rounded-full bg-card-hover text-muted" title="Anonymous">
        <UserRound className="size-1/2" />
      </div>
    )
  }
  if (url) return <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" />
  const initials = (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{ ...style, fontSize: size * 0.4 }} className="grid shrink-0 place-items-center rounded-full bg-brand-soft font-bold text-brand">
      {initials}
    </div>
  )
}

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

export function VolunteerBadge() {
  return (
    <span className="chip bg-brand-soft text-brand" title="Volunteer">
      <ShieldCheck className="size-3.5" /> Volunteer
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

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={clsx('animate-spin text-muted', className ?? 'size-6')} aria-label="Loading" />
}

export function PageSpinner() {
  return (
    <div className="grid place-items-center py-16">
      <Spinner className="size-8" />
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <h3 className="font-semibold">{title}</h3>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  )
}

export function Modal({ open, onClose, title, children, wide = false }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[1500] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx('card max-h-[92vh] w-full overflow-y-auto rounded-b-none sm:rounded-xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-card px-4 py-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-card-hover">
            <X className="size-5" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
