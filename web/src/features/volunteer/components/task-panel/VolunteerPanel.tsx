import clsx from 'clsx'
import { Building2, CheckCircle2, Hourglass, Scale, Star, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useToast } from '@/shared/hooks/useToast'
import { volunteerService } from '@/features/volunteer/services/volunteer.service'
import { displayName, timeAgo } from '@/shared/lib/format'
import { starLabel } from '@/features/volunteer/lib/volunteer'
import type { Issue } from '@/models'
import { useInvalidateIssue } from '@/features/issues/components/IssueDialogs'
import { Note } from '@/features/volunteer/components/task-panel/Note'
import { RouteInfo } from '@/features/volunteer/components/task-panel/RouteInfo'
import { AcceptTask } from '@/features/volunteer/components/task-panel/AcceptTask'
import { WorkingOnIt } from '@/features/volunteer/components/task-panel/WorkingOnIt'
import { AskForMembers } from '@/features/volunteer/components/task-panel/AskForMembers'
import { TeamPanel } from '@/features/volunteer/components/task-panel/TeamPanel'
import { MyActiveTask } from '@/features/volunteer/components/task-panel/MyActiveTask'
import { UnderReviewNote } from '@/features/volunteer/components/task-panel/UnderReviewNote'
import { OfficialAccept } from '@/features/volunteer/components/task-panel/OfficialAccept'
import { ResolutionReview } from '@/features/volunteer/components/task-panel/ResolutionReview'

/** Everything about getting an issue fixed: route → accept → progress → fix → confirm → rate. */
export function VolunteerPanel({ issue }: { issue: Issue }) {
  const { user, profile, role } = useAuth()
  const isOnTask = Boolean(user) && issue.volunteer_id === user?.id
  const isAuthority = issue.route === 'authority'
  const active = ['assigned', 'in_progress'].includes(issue.status)

  return (
    <section className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-bold">
        <Wrench className="size-5 text-brand" /> Getting it fixed
      </h2>
      <RouteInfo issue={issue} />

      {issue.status === 'community_review' && (
        <Note icon={<Hourglass className="size-5" />}>
          Waiting for community validation.{' '}
          {isAuthority ? 'Then it goes to the City Corporation.' : issue.route === 'community' ? 'Then volunteers can take it.' : ''}
        </Note>
      )}
      {(issue.status === 'hidden' || issue.status === 'expired') && (
        <Note icon={<Hourglass className="size-5" />}>Not open for work.</Note>
      )}
      {issue.status === 'under_review' && <UnderReviewNote issue={issue} />}

      {issue.status === 'validated' && issue.route === 'pending' && (
        <Note icon={<Scale className="size-5" />} tone="warn">
          Validated. An admin is deciding whether volunteers or the City Corporation should fix it.
        </Note>
      )}
      {issue.status === 'validated' && issue.route === 'community' && (
        <AcceptTask issue={issue} isVolunteer={Boolean(profile?.is_volunteer)} />
      )}

      {isAuthority && !issue.authority_id && !['community_review', 'hidden', 'expired'].includes(issue.status) && (
        <Note icon={<Building2 className="size-5" />} tone="warn">
          No City Corporation covers this location yet. An admin has been asked to sort it out.
        </Note>
      )}
      {issue.status === 'escalated' && <OfficialAccept issue={issue} />}

      {active && (isOnTask ? <MyActiveTask issue={issue} /> : <WorkingOnIt issue={issue} />)}
      {active && issue.team_size > 1 && <TeamPanel issue={issue} />}
      {active && isOnTask && issue.assignee_role !== 'official' && <AskForMembers issue={issue} />}

      {issue.status === 'resolution_submitted' && (
        <ResolutionReview issue={issue}
          cannotReview={isOnTask || issue.my_team_member || issue.my_authority_covers || role === 'admin' || role === 'city_admin'} />
      )}

      {issue.status === 'closed' && <Closed issue={issue} />}
    </section>
  )
}

// ---------- volunteers ----------

// ---------- City Corporation ----------

// ---------- confirming the fix ----------

function Closed({ issue }: { issue: Issue }) {
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [stars, setStars] = useState(0)
  const [review, setReview] = useState('')
  const [busy, setBusy] = useState(false)
  const byOfficial = issue.assignee_role === 'official'

  async function rate() {
    setBusy(true)
    try {
      await volunteerService.rateVolunteer(issue.id, stars, review)
      toast.success('Thanks for rating!')
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <Note icon={<CheckCircle2 className="size-5 text-brand" />} tone="brand">
        Resolved {issue.closed_at ? timeAgo(issue.closed_at) : ''}
        {issue.volunteer_username && (
          <>
            {' by '}
            <Link to={`/u/${issue.volunteer_username}`} className="font-semibold hover:underline">
              {displayName(issue.volunteer_full_name, issue.volunteer_username)}
            </Link>
            {byOfficial && ` (${issue.authority_short_name})`}
          </>
        )}.
        {issue.resolution_note && <p className="mt-1 whitespace-pre-line">{issue.resolution_note}</p>}
      </Note>
      {issue.is_mine && !issue.is_rated && issue.volunteer_id && !byOfficial && (
        <div className="space-y-2 rounded-lg border border-line p-3">
          <p className="text-sm font-semibold">Rate the volunteer</p>
          <div className="flex gap-1" role="radiogroup" aria-label="Stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={starLabel(n)} onClick={() => setStars(n)}>
                <Star className={clsx('size-8', n <= stars ? 'fill-warn text-warn' : 'text-line')} />
              </button>
            ))}
          </div>
          <textarea className="input" rows={2} maxLength={500} placeholder="Say thanks or give feedback (optional)" aria-label="Review (optional)"
            value={review} onChange={(e) => setReview(e.target.value)} />
          <button className="btn-primary w-full" disabled={busy || stars === 0} onClick={rate}>Submit rating</button>
        </div>
      )}
    </div>
  )
}
