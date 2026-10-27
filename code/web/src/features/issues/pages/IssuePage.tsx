import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Siren } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useTitle } from '@/shared/hooks/useTitle'
import { timeAgo } from '@/shared/lib/format'
import { Empty, PageSpinner } from '@/shared/ui'
import { AdminIssueTools } from '@/features/admin/components/AdminIssueTools'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { Comments } from '@/features/comments/components/Comments'
import { emergencyService } from '@/features/emergency/services/emergency.service'
import { IssueCard } from '@/features/issues/components/issue-card/IssueCard'
import { CategoryVotes } from '@/features/issues/components/issue-detail/CategoryVotes'
import { Evidence } from '@/features/issues/components/issue-detail/Evidence'
import { RaiseEmergency } from '@/features/issues/components/issue-detail/RaiseEmergency'
import { SeverityVote } from '@/features/issues/components/issue-detail/SeverityVote'
import { Timeline } from '@/features/issues/components/issue-detail/Timeline'
import { StillThereBox } from '@/features/issues/components/StillThereBox'
import { issueService } from '@/features/issues/services/issue.service'
import { MiniMap } from '@/features/map/components/MiniMap'
import { VolunteerPanel } from '@/features/volunteer/components/task-panel/VolunteerPanel'

export function IssuePage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const openConfirm = Boolean((location.state as { openConfirm?: boolean } | null)?.openConfirm)
  const [tab, setTab] = useState<'discussion' | 'timeline' | 'evidence'>('discussion')
  const { data: issue, isLoading, error } = useQuery({ queryKey: ['issue', id], queryFn: () => issueService.getIssue(id) })
  useTitle(issue?.title)
  const alert = useQuery({ queryKey: ['issue_alert', id], queryFn: () => emergencyService.getIssueAlert(id), refetchInterval: 60_000 }).data
  const { role } = useAuth()

  if (isLoading) return <PageSpinner />
  if (error) return <div className="mx-auto max-w-2xl p-4"><Empty title="Couldn't load this issue">{(error as Error).message}</Empty></div>
  if (!issue) return <div className="mx-auto max-w-2xl p-4"><Empty title="Issue not found">It may have been deleted by its reporter.</Empty></div>
  // Residents vote. Admins don't; officials don't on issues of their own area.
  const canVote = role === 'citizen' || (role === 'official' && !issue.my_authority_covers)

  return (
    <div className="mx-auto grid max-w-6xl gap-4 px-2 py-4 sm:px-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        {alert?.status === 'active' ? (
          <Link to={`/alert/${alert.id}`} className="flex items-center gap-3 rounded-xl bg-danger p-3 text-danger-ink hover:brightness-110">
            <Siren className="size-6 shrink-0" />
            <span className="text-sm">
              <strong className="block">This has become an emergency</strong>
              {alert.verified_at ? 'Verified by people on site' : alert.confirm_count > 0 ? `Confirmed by ${alert.confirm_count} nearby, not yet verified` : 'Unverified'}
              {' '}· raised {timeAgo(alert.created_at)}. Stay away and call 999.
            </span>
          </Link>
        ) : alert?.issue_verified_at && (
          <Link to={`/alert/${alert.id}`} className="flex items-center gap-2 rounded-xl border border-danger bg-danger-soft p-3 text-sm text-danger hover:brightness-95">
            <Siren className="size-5 shrink-0" />
            Verified as an emergency {timeAgo(alert.issue_verified_at)}. Kept at critical severity until it is fixed.
          </Link>
        )}
        <IssueCard issue={issue} full autoConfirm={openConfirm} />

        <div className="card">
          <div className="flex border-b border-line px-2" role="tablist" id="discussion">
            {(['discussion', 'timeline', 'evidence'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={clsx('border-b-[3px] px-4 py-3 text-sm font-semibold capitalize',
                  tab === t ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink')}
              >
                {t}
                {t === 'discussion' && issue.comment_count > 0 && ` (${issue.comment_count})`}
              </button>
            ))}
          </div>
          <div className="p-4">
            {tab === 'discussion' && <Comments issue={issue} />}
            {tab === 'timeline' && <Timeline issue={issue} />}
            {tab === 'evidence' && <Evidence issueId={issue.id} />}
          </div>
        </div>
      </div>

      <aside className="space-y-4">
        <StillThereBox issue={issue} />
        <VolunteerPanel issue={issue} />
        <AdminIssueTools issue={issue} />
        <CategoryVotes issue={issue} />
        <SeverityVote issue={issue} readOnly={!canVote} />
        {role === 'citizen' && alert?.status !== 'active' && !['closed', 'expired', 'hidden'].includes(issue.status) && (
          <RaiseEmergency issue={issue} />
        )}
        <section className="card space-y-2 p-4">
          <h2 className="font-bold">Location</h2>
          <MiniMap lat={issue.lat} lng={issue.lng} color={issue.category_color} />
          <p className="text-sm text-muted">
            {issue.address || `${issue.lat.toFixed(5)}, ${issue.lng.toFixed(5)}`}
            <br />
            {issue.location_source === 'gps'
              ? `GPS, accurate to ±${Math.round(issue.location_accuracy_m ?? 0)} m`
              : 'Pin placed manually by the reporter'}
          </p>
          {/* A free Google Maps link (no API key): on a phone it opens the Maps app with the route there. */}
          <a className="text-sm font-semibold text-brand hover:underline" target="_blank" rel="noreferrer"
            href={`https://www.google.com/maps/dir/?api=1&destination=${issue.lat},${issue.lng}`}>
            Get directions (Google Maps) →
          </a>
        </section>
      </aside>
    </div>
  )
}
