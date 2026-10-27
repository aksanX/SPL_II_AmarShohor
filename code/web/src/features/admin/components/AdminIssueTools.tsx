import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, Megaphone, UserMinus, Users } from 'lucide-react'
import { useState } from 'react'
import type { Issue } from '@/models'
import { useToast } from '@/shared/hooks/useToast'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { Spinner } from '@/shared/ui'
import { moderationService } from '@/features/admin/services/moderation.service'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useCategories } from '@/features/categories/hooks/useCategories'
import { authorityService } from '@/features/city-corp/services/authority.service'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { insidePolygon } from '@/features/map/lib/hexGrid'

/**
 * Admin actions on one issue. The admin manages routing and stuck work, but
 * can't mark issues fixed or assign a task to someone. Super admins get them on
 * every issue, city admins on issues in their City Corporation's area.
 * The issue page shows it twice: `part="route"` (reason, send, refer, remove) and `part="help"` (ask nearby volunteers).
 */
export function AdminIssueTools({ issue, part }: { issue: Issue; part: 'route' | 'help' }) {
  const { isAdmin, cityAdminOf } = useAuth()
  const mine = useQuery({
    queryKey: ['can_admin_issue', issue.id], queryFn: () => moderationService.canAdminIssue(issue.id), enabled: Boolean(cityAdminOf),
  }).data ?? false
  const allowed = (isAdmin && !issue.is_mine) || mine  // nobody handles their own report as admin
  const categories = (useCategories().data ?? []).filter((c) => c.is_active)
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [referTo, setReferTo] = useState('')
  const authoritiesQuery = useQuery({ queryKey: ['authorities'], queryFn: authorityService.getAuthorities, enabled: allowed })
  const authorities = authoritiesQuery.data ?? []

  if (!allowed) return null
  // "Send to City Corporation" would reach nobody where no City Corporation's area covers the issue (0071).
  const noCity = authoritiesQuery.isSuccess && !issue.authority_id && !authorities.some((a) =>
    a.is_active && a.kind === 'city_corporation' && a.area.coordinates.some((poly) => insidePolygon(issue.lat, issue.lng, poly[0])))
  const referable = issue.route === 'authority' && ['escalated', 'assigned', 'in_progress', 'under_review'].includes(issue.status)
  const referTargets = authorities.filter((a) => a.is_active && a.id !== issue.authority_id)
  const closed = ['closed', 'hidden', 'expired'].includes(issue.status)
  const working = ['assigned', 'in_progress'].includes(issue.status)
  const waitingForVolunteers = part === 'help' && issue.status === 'validated' && issue.route === 'community'
  const canRoute = part === 'route' && !closed
  const canRefer = part === 'route' && referable && referTargets.length > 0
  const canRemove = part === 'route' && working
  if (!canRoute && !canRefer && !canRemove && !waitingForVolunteers) return null
  // Who the category says fixes it (seeded per category): the one chosen below, or the issue's own.
  const shownCategory = categories.find((c) => c.slug === (category || issue.category))
  const needsCity = shownCategory ? shownCategory.resolver === 'authority' || !shownCategory.volunteer_allowed : issue.resolver === 'authority'
  const tooDangerous = shownCategory ? !shownCategory.volunteer_allowed : false

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try {
      await action()
      toast.success(ok)
      setReason('')
      setCategory('')
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-3 border-2 border-dashed border-line p-4">
      {canRoute && (
        <div className="space-y-2">
          {(shownCategory || issue.resolver) && (
            <p className={clsx('flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold',
              needsCity ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand')}>
              {needsCity ? <Building2 className="size-4 shrink-0" /> : <Users className="size-4 shrink-0" />}
              {needsCity
                ? `This task needs the City Corporation${tooDangerous ? ' (too dangerous for volunteers)' : ''}`
                : 'This task needs volunteers'}
            </p>
          )}
          <textarea className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required, shown on the issue timeline)" aria-label="Reason" />
          {/* Fixing the category while keeping the route lets whoever is working on it carry on. */}
          {categories.length > 0 && (
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">Keep category ({issue.category_name})</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          )}
          {/* Where no City Corporation covers it, volunteers are the only way out: that button alone, full width (0071). */}
          <div className={clsx('grid gap-2', !noCity && 'grid-cols-2')}>
            <button className="btn-soft" disabled={busy || reason.trim().length < 5}
              onClick={() => run(() => moderationService.adminSetRoute(issue.id, 'community', reason, category || null), 'Sent to volunteers.')}>
              <Users className="size-4" /> Send to volunteers
            </button>
            {!noCity && (
              <button className="btn-soft" disabled={busy || reason.trim().length < 5 || (issue.route === 'authority' && !category)}
                title={issue.route === 'authority' && !category ? 'Already with the City Corporation' : undefined}
                onClick={() => run(() => moderationService.adminSetRoute(issue.id, 'authority', reason, category || null), 'Sent to the City Corporation.')}>
                <Building2 className="size-4" /> Send to City Corporation
              </button>
            )}
          </div>
        </div>
      )}

      {canRefer && (
        <div className="space-y-2 border-t border-line pt-3">
          <label className="label" htmlFor="refer-to">Not the City Corporation’s job?</label>
          <div className="flex gap-2">
            <select id="refer-to" className="input" value={referTo} onChange={(e) => setReferTo(e.target.value)}>
              <option value="">Refer to…</option>
              {referTargets.map((a) => (
                <option key={a.id} value={a.id}>{a.short_name} · {a.kind === 'agency' ? 'agency' : 'City Corporation'}</option>
              ))}
            </select>
            <button className="btn-soft shrink-0" disabled={busy || !referTo || reason.trim().length < 5}
              onClick={() => run(() => moderationService.adminReferIssue(issue.id, referTo, reason), 'Referred. The target-time clock restarted.')}>
              <Building2 className="size-4" /> Refer
            </button>
          </div>
        </div>
      )}

      {canRemove && (
        <button className="btn-ghost w-full text-danger" disabled={busy || reason.trim().length < 5}
          onClick={() => run(() => moderationService.adminRemoveAssignee(issue.id, reason), 'Removed. The task is open again.')}>
          <UserMinus className="size-4" /> Remove the inactive {issue.assignee_role === 'official' ? 'official' : 'volunteer'}
        </button>
      )}

      {waitingForVolunteers && (
        <button className="btn-soft w-full" disabled={busy}
          onClick={() => run(async () => {
            const n = await moderationService.adminRequestHelp(issue.id)
            toast.info(n > 0
              ? `${n} nearby volunteer${n === 1 ? '' : 's'} notified.`
              : `Nobody notified: no volunteers have their home area within ${((settings?.request_help_radius_m ?? 5000) / 1000).toFixed(0)} km of this issue.`)
          }, 'Help requested.')}>
          {busy ? <Spinner className="size-4" /> : <Megaphone className="size-4" />} Ask nearby volunteers
        </button>
      )}
    </section>
  )
}
