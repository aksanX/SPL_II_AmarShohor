import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, CheckCircle2, Hourglass, HandHelping, Scale, Star, ThumbsDown, ThumbsUp, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { useToast } from '@/shared/hooks/useToast'
import { issueService } from '@/features/issues/services/issue.service'
import { volunteerService } from '@/features/volunteer/services/volunteer.service'
import { displayName, timeAgo } from '@/shared/lib/format'
import { starLabel } from '@/features/volunteer/lib/volunteer'
import { locationService } from '@/shared/geo/location.service'
import type { Issue, MediaItem } from '@/models'
import { useInvalidateIssue } from '@/features/issues/components/IssueDialogs'
import { MediaGallery } from '@/features/media/components/MediaGallery'
import { Spinner } from '@/shared/ui'
import { Note } from '@/features/volunteer/components/task-panel/Note'
import { RouteInfo } from '@/features/volunteer/components/task-panel/RouteInfo'
import { AcceptTask } from '@/features/volunteer/components/task-panel/AcceptTask'
import { WorkingOnIt } from '@/features/volunteer/components/task-panel/WorkingOnIt'
import { AskForMembers } from '@/features/volunteer/components/task-panel/AskForMembers'
import { TeamPanel } from '@/features/volunteer/components/task-panel/TeamPanel'
import { MyActiveTask } from '@/features/volunteer/components/task-panel/MyActiveTask'

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

/** Says who asked the admin for what, from the latest request on the timeline. */
function UnderReviewNote({ issue }: { issue: Issue }) {
  const { data: events = [] } = useQuery({ queryKey: ['events', issue.id], queryFn: () => issueService.getIssueEvents(issue.id) })
  const request = [...events].reverse().find((e) => REVIEW_REQUESTS.includes(e.type))
  const who = request?.actor_official_of ?? (issue.route === 'authority' ? issue.authority_short_name ?? 'The City Corporation' : 'A volunteer')
  const what = request?.type === 'send_back_requested' ? 'asked to send this to volunteers'
    : request?.type === 'escalation_requested' ? 'asked to send this to the City Corporation'
    : request?.type === 'reported_wrong' ? 'says the report is wrong'
    : 'asked for a decision'
  return (
    <Note icon={<Scale className="size-5" />} tone="warn">
      {who} {what}. An admin will decide what happens next.
    </Note>
  )
}

const REVIEW_REQUESTS = ['send_back_requested', 'escalation_requested', 'reported_wrong']

// ---------- City Corporation ----------

function OfficialAccept({ issue }: { issue: Issue }) {
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [busy, setBusy] = useState(false)
  if (!issue.i_am_official_here) {
    return (
      <Note icon={<Hourglass className="size-5" />}>
        Waiting for a {issue.authority_short_name ?? 'City Corporation'} official to take it.
      </Note>
    )
  }

  async function accept() {
    setBusy(true)
    try {
      await volunteerService.acceptTask(issue.id)
      toast.success('Accepted. Post progress updates so residents can follow.')
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <button className="btn-primary w-full" disabled={busy} onClick={accept}>
        {busy ? <Spinner className="size-4 text-brand-ink" /> : <HandHelping className="size-4" />} Accept for {issue.authority_short_name}
      </button>
    </div>
  )
}

// ---------- confirming the fix ----------

function ResolutionReview({ issue, cannotReview }: { issue: Issue; cannotReview: boolean }) {
  const { user } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [busy, setBusy] = useState(false)
  const media = useQuery({ queryKey: ['media', issue.id], queryFn: () => issueService.getIssueMedia(issue.id) }).data ?? []
  const after: MediaItem[] = media
    .filter((m) => m.kind === 'resolution')
    .map((m) => ({ id: m.id, kind: m.kind, media_type: m.media_type, path: m.storage_path }))
  const who = issue.assignee_role === 'official'
    ? `${displayName(issue.volunteer_full_name, issue.volunteer_username)} (${issue.authority_short_name})`
    : displayName(issue.volunteer_full_name, issue.volunteer_username)

  async function review(fixed: boolean) {
    setBusy(true)
    try {
      let pos = locationService.getLastKnownPosition()
      if (!issue.is_mine && !issue.my_confirmed && !pos) {
        pos = await locationService.getCurrentPosition().catch(() => null)
      }
      const status = await volunteerService.reviewResolution(issue.id, fixed, pos?.lat, pos?.lng)
      toast.success(
        status === 'closed' ? 'Issue closed. Thank you!'
          : status === 'validated' ? 'Issue reopened for another volunteer.'
            : status === 'escalated' ? 'Issue sent back to the City Corporation.'
              : 'Your vote is recorded. Waiting for more neighbours.',
      )
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  const autoClose = settings?.auto_close_days ?? 7
  return (
    <div className="space-y-3">
      <Note icon={<CheckCircle2 className="size-5 text-brand" />} tone="brand">
        <strong>{who}</strong> says it's fixed
        {issue.resolution_submitted_at ? ` (${timeAgo(issue.resolution_submitted_at)})` : ''}:
        <p className="mt-1 whitespace-pre-line">{issue.resolution_note}</p>
      </Note>
      {after.length > 0 && <div className="overflow-hidden rounded-lg"><MediaGallery items={after} /></div>}
      {after.length === 0 && issue.assignee_role === 'official' && (
        <p className="text-sm text-muted">No "after" photo was added. If you're nearby, check whether it's gone or still there.</p>
      )}

      {cannotReview ? (
        <p className="text-sm text-muted">
          Waiting for the reporter or {settings?.resolution_quorum ?? 2} neighbours to confirm. It closes automatically after{' '}
          {autoClose} days if nobody disputes it.
        </p>
      ) : !user ? (
        <p className="text-sm"><Link to="/login" className="font-semibold text-brand">Log in</Link> to confirm the fix.</p>
      ) : (
        <>
          <p className="text-sm font-semibold">
            {issue.is_mine ? 'You reported this. Is it really fixed?' : 'Live nearby? Is it really fixed?'}
          </p>
          {issue.my_resolution_review !== null && (
            <p className="text-sm text-muted">You answered: {issue.my_resolution_review ? 'fixed' : 'not fixed'}. You can change it.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => review(true)}>
              <ThumbsUp className="size-4" /> Yes, it's fixed
            </button>
            <button className="btn-danger" disabled={busy} onClick={() => review(false)}>
              <ThumbsDown className="size-4" /> No, still there
            </button>
          </div>
          <p className="text-xs text-muted">
            {issue.is_mine
              ? 'As the reporter, "fixed" closes it right away. "Not fixed" reopens it alone only once; after that, neighbours must agree.'
              : `Needs ${settings?.resolution_quorum ?? 2} neighbours agreeing (within ${((settings?.reviewer_radius_m ?? 3000) / 1000).toFixed(0)} km or who confirmed it on-site). Auto-closes after ${autoClose} days if undisputed.`}
          </p>
        </>
      )}
    </div>
  )
}

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
