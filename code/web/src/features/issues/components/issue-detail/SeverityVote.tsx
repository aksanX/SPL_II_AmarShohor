import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Issue, Severity } from '@/models'
import { useToast } from '@/shared/hooks/useToast'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { SEVERITIES, SEVERITY_META } from '@/features/issues/lib/issueLabels'
import { issueService } from '@/features/issues/services/issue.service'

/** Residents vote on severity; `readOnly` shows admins and the area's officials the result only. */
export function SeverityVote({ issue, readOnly = false }: { issue: Issue; readOnly?: boolean }) {
  const { user } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  if (['closed', 'expired'].includes(issue.status)) return null

  if (readOnly) {
    return (
      <section className="card space-y-2 p-4">
        <h2 className="font-bold">How serious is it?</h2>
        <p className="text-sm">
          <span className={clsx('chip', SEVERITY_META[issue.severity].tone)}>{SEVERITY_META[issue.severity].label}</span>
        </p>
      </section>
    )
  }

  async function vote(s: Severity) {
    setBusy(true)
    try {
      await issueService.voteSeverity(issue.id, s)
      qc.invalidateQueries({ queryKey: ['issue', issue.id] })
      toast.success('Thanks — severity is decided by the community.')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-2 p-4">
      <h2 className="font-bold">How serious is it?</h2>
      <div className="grid grid-cols-4 gap-1">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            disabled={!user || busy}
            onClick={() => vote(s)}
            className={clsx('rounded-lg border px-1 py-2 text-xs font-semibold',
              issue.my_severity_vote === s ? `${SEVERITY_META[s].tone} border-current` : 'border-line hover:bg-card-hover',
              issue.severity === s && issue.my_severity_vote !== s && 'ring-2 ring-brand/30')}
          >
            {SEVERITY_META[s].label}
          </button>
        ))}
      </div>
      {!user && <p className="text-xs text-muted"><Link to="/login" className="text-brand">Log in</Link> to vote.</p>}
    </section>
  )
}
