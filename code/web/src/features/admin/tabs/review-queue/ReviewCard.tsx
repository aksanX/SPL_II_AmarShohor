import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ReviewItem } from '@/models'
import { displayName, timeAgo } from '@/shared/lib/format'
import { useRunner } from '@/features/admin/hooks/useRunner'
import { moderationService } from '@/features/admin/services/moderation.service'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { categoryService } from '@/features/categories/services/category.service'
import { CategoryChip } from '@/features/issues/components/IssueBadges'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { MediaGallery } from '@/features/media/components/MediaGallery'

export function ReviewCard({ item }: { item: ReviewItem }) {
  const { isAdmin, profile } = useAuth()
  const categories = (useQuery({ queryKey: ['categories', 'all'], queryFn: categoryService.getAllCategories }).data ?? []).filter((c) => c.is_active)
  const invalidate = useInvalidateIssue()
  const { busy, run } = useRunner()
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState('')
  const issue = item.issue
  // Nobody decides a case on their own report or request; reports and requests by area admins go to the
  // super admin only (0051).
  const mineToo = issue.is_mine || (Boolean(profile) && item.requester_username === profile?.username)
  const ownCase = mineToo || (!isAdmin && item.super_reason === 'own_report')
  const done = () => invalidate(issue.id)
  const noReason = reason.trim().length < 5
  // "Send to City Corporation" would reach nobody here (0071).
  const noCity = !item.city_id

  return (
    <article className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{timeAgo(item.created_at)}</span>
        {item.requester_username && (
          <span className="text-xs text-muted">· by <Link className="font-semibold hover:underline" to={`/u/${item.requester_username}`}>
            {displayName(item.requester_full_name, item.requester_username)}</Link></span>
        )}
      </div>
      <div className="flex gap-3">
        {issue.media[0]?.media_type === 'image' && (
          <div className="w-28 shrink-0 overflow-hidden rounded-lg"><MediaGallery items={[issue.media[0]]} /></div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <Link to={`/issue/${issue.id}`} className="font-semibold hover:underline">{issue.title}</Link>
          <div className="flex flex-wrap gap-1">
            <CategoryChip issue={issue} />
          </div>
          <p className="text-xs text-muted">{issue.address}</p>
        </div>
      </div>
      {ownCase && (
        <p className="rounded-lg bg-warn-soft p-3 text-sm text-warn">
          {issue.is_mine ? 'This is your own report' : mineToo ? 'You made this request yourself' : 'An area admin reported or asked for this'},
          {' '}so the super admin decides it.
        </p>
      )}
      {item.note && <blockquote className="rounded-lg bg-bg p-3 text-sm">“{item.note}”{item.data.wrong_type && ` (${item.data.wrong_type.replace('_', ' ')})`}</blockquote>}
      {item.evidence.length > 0 && <div className="max-w-sm overflow-hidden rounded-lg"><MediaGallery items={item.evidence} /></div>}

      {!ownCase && <>
      <textarea className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required, shown on the issue timeline)" aria-label="Reason" />

      {item.kind === 'escalation_request' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="btn-primary" disabled={busy || noReason || noCity}
            title={noCity ? 'No City Corporation covers this place' : undefined}
            onClick={() => run(() => moderationService.adminDecideEscalation(issue.id, true, reason), 'Sent to the City Corporation.', done)}>
            <Building2 className="size-4" /> Approve: send to City Corporation
          </button>
          <button className="btn-soft" disabled={busy || noReason}
            onClick={() => run(() => moderationService.adminDecideEscalation(issue.id, false, reason), 'Kept with volunteers.', done)}>
            <Users className="size-4" /> Reject: volunteers can do it
          </button>
        </div>
      ) : item.kind === 'category_mismatch' ? (
        <div className="space-y-2">
          <ul className="space-y-1 rounded-lg bg-bg p-3 text-sm">
            <li className="flex justify-between gap-2">
              <span>As listed: <strong>{issue.category_name ?? 'no category'}</strong></span>
              <span className="text-muted">{item.data.confirmed_as_is ?? 0} confirmed on site</span>
            </li>
            {(item.data.suggestions ?? []).map((s) => (
              <li key={s.category} className="flex justify-between gap-2">
                <span>{categories.find((c) => c.slug === s.category)?.name ?? s.category}</span>
                <span className="text-muted">{s.votes} say so{s.on_site > 0 && `, ${s.on_site} on site`}</span>
              </li>
            ))}
          </ul>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">Choose the right category…</option>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="btn-primary" disabled={busy || noReason || !category || category === issue.category}
              onClick={() => run(() => moderationService.adminDecideCategory(issue.id, category, reason), 'Category changed.', done)}>
              Change category
            </button>
            <button className="btn-soft" disabled={busy || noReason}
              onClick={() => run(() => moderationService.adminDecideCategory(issue.id, null, reason), 'Category kept.', done)}>
              Keep {issue.category_name ?? 'as is'}
            </button>
          </div>
        </div>
      ) : item.kind === 'appeal' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="btn-primary" disabled={busy || noReason}
            onClick={() => run(() => moderationService.adminDecideAppeal(issue.id, true, reason), 'Restored.', done)}>
            It's real: restore it
          </button>
          <button className="btn-soft" disabled={busy || noReason}
            onClick={() => run(() => moderationService.adminDecideAppeal(issue.id, false, reason), 'Kept hidden.', done)}>
            Keep it hidden
          </button>
        </div>
      ) : item.kind === 'wrong_issue' ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <button className="btn-primary" disabled={busy || noReason}
            onClick={() => run(() => moderationService.adminDecideWrongReport(issue.id, 'close', reason), 'Closed as already fixed.', done)}>
            They're right: already fixed
          </button>
          <button className="btn-soft" disabled={busy || noReason}
            onClick={() => run(() => moderationService.adminDecideWrongReport(issue.id, 'hide', reason), 'Hidden.', done)}>
            They're right: fake or wrong place
          </button>
          <button className="btn-danger" disabled={busy || noReason}
            onClick={() => run(() => moderationService.adminDecideWrongReport(issue.id, 'lie', reason),
              issue.route === 'authority'
                ? 'Back with the City Corporation; the false claim cost reputation.'
                : 'Back to volunteers; the false claim cost reputation.', done)}>
            Report is real: send it back to be fixed
          </button>
        </div>
      ) : item.kind === 'send_back' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="btn-soft" disabled={busy || noReason}
            onClick={() => run(() => moderationService.adminSetRoute(issue.id, 'community', reason, null), 'Sent to volunteers.', done)}>
            <Users className="size-4" /> Agree: send to volunteers
          </button>
          <button className="btn-soft" disabled={busy || noReason}
            onClick={() => run(() => moderationService.adminDismissReview(item.id, reason), 'Kept with the City Corporation.', done)}>
            <Building2 className="size-4" /> Disagree: keep with City Corporation
          </button>
        </div>
      ) : (
        // With no City Corporation the volunteers button is alone, at full width.
        <div className={clsx('grid gap-2', !noCity && 'sm:grid-cols-2')}>
          <button className="btn-soft" disabled={busy || noReason}
            onClick={() => run(() => moderationService.adminSetRoute(issue.id, 'community', reason, null), 'Sent to volunteers.', done)}>
            <Users className="size-4" /> Send to volunteers
          </button>
          {!noCity && (
            <button className="btn-soft" disabled={busy || noReason}
              onClick={() => run(() => moderationService.adminSetRoute(issue.id, 'authority', reason, null), 'Sent to the City Corporation.', done)}>
              <Building2 className="size-4" /> Send to City Corporation
            </button>
          )}
        </div>
      )}
      </>}
    </article>
  )
}
