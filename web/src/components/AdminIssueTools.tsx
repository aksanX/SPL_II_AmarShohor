import { Building2, Megaphone, ShieldCheck, UserMinus, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useCategories } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { adminInviteVolunteer, adminRemoveAssignee, adminRequestHelp, adminSetRoute } from '../lib/api'
import type { Issue } from '../lib/types'
import { useInvalidateIssue } from './IssueDialogs'
import { Spinner } from './ui'

/**
 * Admin actions on one issue. The admin manages routing and stuck work, but
 * can't mark issues fixed or assign a task to someone.
 */
export function AdminIssueTools({ issue }: { issue: Issue }) {
  const { isAdmin } = useAuth()
  const categories = (useCategories().data ?? []).filter((c) => c.is_active)
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState('')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)

  if (!isAdmin) return null
  const closed = ['closed', 'hidden', 'expired'].includes(issue.status)
  const working = ['assigned', 'in_progress'].includes(issue.status)
  const waitingForVolunteers = issue.status === 'validated' && issue.route === 'community'

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try {
      await action()
      toast.success(ok)
      setReason('')
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-3 border-2 border-dashed border-line p-4">
      <h2 className="flex items-center gap-2 font-bold"><ShieldCheck className="size-5 text-brand" /> Admin</h2>
      {issue.pending_review && (
        <Link to="/admin" className="block rounded-lg bg-warn-soft p-2 text-sm font-semibold text-warn">
          This issue is waiting in the review queue →
        </Link>
      )}

      {!closed && (
        <div className="space-y-2">
          <label className="label" htmlFor="admin-reason">Reason (required, shown on the timeline)</label>
          <textarea id="admin-reason" className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Needs a truck, too big for volunteers" />
          {categories.length > 0 && (
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">Keep category ({issue.category_name})</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-soft" disabled={busy || reason.trim().length < 5 || (issue.route === 'community' && !category)}
              onClick={() => run(() => adminSetRoute(issue.id, 'community', reason, category || null), 'Sent to volunteers.')}>
              <Users className="size-4" /> Volunteers
            </button>
            <button className="btn-soft" disabled={busy || reason.trim().length < 5 || (issue.route === 'authority' && !category)}
              onClick={() => run(() => adminSetRoute(issue.id, 'authority', reason, category || null), 'Sent to the City Corporation.')}>
              <Building2 className="size-4" /> City Corporation
            </button>
          </div>
          <p className="text-xs text-muted">
            Now: {issue.route === 'pending' ? 'not decided' : issue.route === 'community' ? 'volunteers' : 'City Corporation'}.
            Whoever is working on it stops with no penalty.
          </p>
        </div>
      )}

      {working && (
        <button className="btn-ghost w-full text-danger" disabled={busy || reason.trim().length < 5}
          onClick={() => run(() => adminRemoveAssignee(issue.id, reason), 'Removed. The task is open again.')}>
          <UserMinus className="size-4" /> Remove the inactive {issue.assignee_role === 'official' ? 'official' : 'volunteer'}
        </button>
      )}

      {waitingForVolunteers && (
        <div className="space-y-2 border-t border-line pt-3">
          <button className="btn-soft w-full" disabled={busy}
            onClick={() => run(async () => {
              const n = await adminRequestHelp(issue.id)
              toast.info(`${n} nearby volunteer${n === 1 ? '' : 's'} notified.`)
            }, 'Help requested.')}>
            {busy ? <Spinner className="size-4" /> : <Megaphone className="size-4" />} Ask nearby volunteers
          </button>
          <div className="flex gap-2">
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="volunteer username" aria-label="Volunteer username" />
            <button className="btn-soft shrink-0" disabled={busy || username.trim().length < 3}
              onClick={() => run(() => adminInviteVolunteer(issue.id, username), 'Invitation sent.')}>
              <UserPlus className="size-4" /> Invite
            </button>
          </div>
          <p className="text-xs text-muted">Volunteers choose their tasks. An invitation can be ignored without penalty.</p>
        </div>
      )}
    </section>
  )
}
