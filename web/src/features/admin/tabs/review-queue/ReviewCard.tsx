import { useQuery } from '@tanstack/react-query'
import { Building2, Users, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ReviewItem, ReviewKind } from '@/models'
import { displayName, timeAgo } from '@/shared/lib/format'
import { useCityAdminHours } from '@/features/admin/hooks/useCityAdminHours'
import { useRunner } from '@/features/admin/hooks/useRunner'
import { moderationService } from '@/features/admin/services/moderation.service'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { categoryService } from '@/features/categories/services/category.service'
import { CategoryChip, StatusBadge } from '@/features/issues/components/IssueBadges'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { ROUTE_LABEL } from '@/features/issues/lib/issueLabels'
import { MediaGallery } from '@/features/media/components/MediaGallery'

const KIND_META: Record<ReviewKind, { label: string; help: string }> = {
  escalation_request: { label: 'Needs City Corporation?', help: 'A volunteer says this is too big for volunteers.' },
  wrong_issue: { label: 'Report is wrong?', help: 'A volunteer or official says it is already fixed, fake or misplaced. If they are wrong, send it back to be fixed.' },
  stuck: { label: 'Stuck', help: 'Released too often or nobody took it for too long.' },
  no_authority: { label: 'No City Corporation', help: 'No City Corporation covers this location. Add or redraw one, or send it to volunteers.' },
  send_back: { label: 'Official: volunteers can do it', help: 'A City Corporation official says local volunteers can handle it.' },
  appeal: {
    label: 'Appeal: hidden report',
    help: 'The reporter says their hidden report is real. Restoring it brings it back and sets the flags against it aside; those flaggers count for less next time.',
  },
  category_mismatch: {
    label: 'Wrong category?',
    help: 'People who saw it say it is a different kind of problem, but they disagree or it is already being worked on. Compare the photo with their suggestions.',
  },
}

/** Why a case is with the super admins, or how long the city admin has left. */
function RoutingChip({ item }: { item: ReviewItem }) {
  const { isAdmin } = useAuth()
  const hours = useCityAdminHours()
  const [now] = useState(() => Date.now())  // when the queue was opened; good enough for "hours left"
  if (isAdmin) {
    if (!item.super_reason) {
      return <span className="chip bg-card-hover text-muted">With the {item.city_area} admin</span>
    }
    const why = item.super_reason === 'no_city_corporation' ? 'No City Corporation covers this place'
      : item.super_reason === 'waited' ? `${item.city_area} admin didn't decide within ${hours} h`
        : item.super_reason === 'own_report' ? 'reported or requested by an area admin'
        : `${item.city_area} has no admin yet`
    return <span className="chip bg-danger-soft text-danger">For you: {why}</span>
  }
  if (item.passed_up_at) {
    return <span className="chip bg-danger-soft text-danger">Over {hours} h: the super admins can decide it too</span>
  }
  const left = Math.ceil((new Date(item.clock_from).getTime() + hours * 3_600_000 - now) / 3_600_000)
  return <span className="chip bg-card-hover text-muted">{Math.max(left, 1)} h left before it goes to the super admins</span>
}

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
  const meta = KIND_META[item.kind]
  const done = () => invalidate(issue.id)
  const noReason = reason.trim().length < 5

  return (
    <article className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip bg-warn-soft text-warn">{meta.label}</span>
        {isAdmin && (
          <span className="chip bg-card-hover text-muted"><Building2 className="size-3.5" /> {item.city_area ?? 'No City Corporation'}</span>
        )}
        <RoutingChip item={item} />
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
            <StatusBadge status={issue.status} />
            <span className="chip bg-card-hover text-muted">Route: {ROUTE_LABEL[issue.route]}</span>
            {issue.size && <span className="chip bg-card-hover text-muted">{issue.size}</span>}
          </div>
          <p className="text-xs text-muted">{issue.address}</p>
        </div>
      </div>
      <p className="text-sm text-muted">{meta.help}</p>
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
          <button className="btn-primary" disabled={busy || noReason}
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
        <div className="space-y-2">
          {categories.length > 0 && (
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">{issue.category ? `Keep category (${issue.category_name})` : 'Choose a category (optional)'}</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <button className="btn-soft" disabled={busy || noReason}
              onClick={() => run(() => moderationService.adminSetRoute(issue.id, 'community', reason, category || null), 'Sent to volunteers.', done)}>
              <Users className="size-4" /> Send to volunteers
            </button>
            <button className="btn-soft" disabled={busy || noReason}
              onClick={() => run(() => moderationService.adminSetRoute(issue.id, 'authority', reason, category || null), 'Sent to the City Corporation.', done)}>
              <Building2 className="size-4" /> Send to City Corporation
            </button>
            {item.kind !== 'no_authority' && (
              <button className="btn-ghost" disabled={busy || noReason || issue.route === 'pending'}
                title={issue.route === 'pending' ? 'Choose a route first' : 'Close this item without changing the issue'}
                onClick={() => run(() => moderationService.adminDismissReview(item.id, reason), 'Dismissed.', done)}>
                <X className="size-4" /> Leave as is
              </button>
            )}
          </div>
          {item.kind === 'no_authority' && (
            <p className="text-xs text-muted">
              Draw or fix a City Corporation area in the City Corporations tab: issues waiting inside it are sent there
              automatically. Or send this one to volunteers.
            </p>
          )}
        </div>
      )}
      </>}
    </article>
  )
}
