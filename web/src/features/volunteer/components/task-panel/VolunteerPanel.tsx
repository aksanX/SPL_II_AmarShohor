import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, CheckCircle2, Clock, Hourglass, HandHelping, Scale, Star, ThumbsDown, ThumbsUp, Undo2, Upload, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { useToast } from '@/shared/hooks/useToast'
import { issueService } from '@/features/issues/services/issue.service'
import { volunteerService } from '@/features/volunteer/services/volunteer.service'
import { displayName, hoursLeft, timeAgo } from '@/shared/lib/format'
import { dueText } from '@/features/issues/lib/issueLabels'
import { myLockText, starLabel } from '@/features/volunteer/lib/volunteer'
import { locationService } from '@/shared/geo/location.service'
import { isNetworkError } from '@/features/media/lib/mediaRules'
import { mediaService } from '@/features/media/services/media.service'
import type { Issue, MediaItem, ReleaseKind, WrongType } from '@/models'
import { LocationStatus, useInvalidateIssue, useOnSiteLocation } from '@/features/issues/components/IssueDialogs'
import { MediaGallery } from '@/features/media/components/MediaGallery'
import { MediaPicker } from '@/features/media/components/MediaPicker'
import { useOnSiteEvidence } from '@/features/issues/components/OnSiteEvidence'
import { Modal, Spinner } from '@/shared/ui'
import { Note } from '@/features/volunteer/components/task-panel/Note'
import { RouteInfo } from '@/features/volunteer/components/task-panel/RouteInfo'
import { AcceptTask } from '@/features/volunteer/components/task-panel/AcceptTask'
import { WorkingOnIt } from '@/features/volunteer/components/task-panel/WorkingOnIt'
import { AskForMembers } from '@/features/volunteer/components/task-panel/AskForMembers'
import { TeamPanel } from '@/features/volunteer/components/task-panel/TeamPanel'

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

function MyActiveTask({ issue }: { issue: Issue }) {
  const { user } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [mode, setMode] = useState<'progress' | 'resolve' | null>(null)
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const radius = settings?.resolution_radius_m ?? 200
  const loc = useOnSiteLocation(issue)
  const evidence = useOnSiteEvidence()
  const left = hoursLeft(issue.lock_expires_at)
  const isOfficial = issue.assignee_role === 'official'

  async function sendProgress() {
    if (!user) return
    setBusy(true)
    try {
      const media = await mediaService.uploadMedia(user.id, files)
      await volunteerService.postProgress(issue.id, note, media)
      toast.success(isOfficial ? 'Update posted.' : `Update posted. Your lock is extended by ${issue.team_size > 1 ? settings?.team_lock_hours ?? 120 : settings?.lock_hours ?? 72} hours.`)
      setNote(''); setFiles([]); setMode(null)
      invalidate(issue.id)
    } catch (e) {
      if (!isNetworkError(e)) await mediaService.discardUploads(files)
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  async function sendResolution() {
    // Officials don't need to be on site: their crews do the work.
    if (!user || (!isOfficial && !loc.pos)) return
    setBusy(true)
    try {
      // Officials send a normal "after" photo; volunteers' fix photos are live (0053, 0070).
      // Officials' "after" photo is also optional (0070): residents confirm it's gone or still there.
      const media = isOfficial ? (files.length ? await mediaService.uploadMedia(user.id, files) : []) : await evidence.upload(user.id)
      await volunteerService.submitResolution(issue.id, note, loc.pos?.lat ?? null, loc.pos?.lng ?? null, loc.pos?.accuracy ?? null, media)
      toast.success('Fix submitted! The reporter and neighbours will confirm it.')
      setNote(''); setFiles([]); evidence.reset(); setMode(null)
      invalidate(issue.id)
    } catch (e) {
      if (!isNetworkError(e)) await (isOfficial ? mediaService.discardUploads(files) : evidence.discard())
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className={clsx('flex items-center gap-2 rounded-lg p-3 text-sm font-semibold',
        !isOfficial && left < 24 ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand')}>
        <Clock className="size-5" />
        {isOfficial
          ? <>This is your task · {issue.authority_short_name} {dueText(issue.due_at)}</>
          : myLockText(issue.lock_expires_at)}
      </div>

      {mode === null && (
        <div className="grid gap-2 sm:grid-cols-3">
          <button className="btn-soft" onClick={() => setMode('progress')}><Upload className="size-4" /> Post progress</button>
          <button className="btn-primary" onClick={() => setMode('resolve')}><CheckCircle2 className="size-4" /> Submit fix</button>
          <button className="btn-ghost" onClick={() => setReleasing(true)}><Undo2 className="size-4" /> Release</button>
        </div>
      )}

      {mode && (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <h3 className="font-semibold">{mode === 'progress' ? 'Progress update' : 'Submit the fix'}</h3>
          <textarea className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
            aria-label={mode === 'progress' ? 'Progress update' : 'What was fixed'}
            placeholder={mode === 'progress'
              ? isOfficial ? 'e.g. Road team scheduled for Thursday' : 'e.g. Gathered 4 people and gloves, cleaning on Friday'
              : 'What was done? Who fixed it?'} />
          {mode === 'progress' ? <MediaPicker files={files} onChange={setFiles} />
            : isOfficial ? <MediaPicker files={files} onChange={setFiles} imagesOnly /> : evidence.picker}
          {mode === 'resolve' && !isOfficial && <LocationStatus loc={loc} radius={radius} />}
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1"
              disabled={busy || note.trim().length < 3 || (mode === 'resolve' && !isOfficial && (!loc.pos || !evidence.ready))}
              onClick={mode === 'progress' ? sendProgress : sendResolution}
            >
              {busy && <Spinner className="size-4 text-brand-ink" />} {mode === 'progress' ? 'Post update' : 'Submit fix'}
            </button>
            {/* Clear the note and files too; live photos are already uploaded and won't be used. */}
            <button className="btn-ghost" onClick={() => { setMode(null); setNote(''); setFiles([]); evidence.discard() }}>Cancel</button>
          </div>
          {mode === 'resolve' && (
            <p className="text-xs text-muted">
              {isOfficial
                ? `An "after" photo is optional. Residents nearby confirm whether it's gone; if they say it's still there, it comes back to your dashboard.`
                : `Take the "after" photo ${evidence.live ? 'with the in-app camera ' : ''}from the same spot as the original. Fake fixes get disputed and cost ${Math.abs(settings?.rep_task_reopened ?? 15)} reputation.`}
            </p>
          )}
        </div>
      )}

      <ReleaseDialog issue={issue} open={releasing} onClose={() => setReleasing(false)} />
    </div>
  )
}

const RELEASE_OPTIONS: { kind: ReleaseKind; title: string; help: string }[] = [
  { kind: 'busy', title: 'I can\'t do it right now', help: 'Back to the pool (or to your team). No penalty.' },
  { kind: 'needs_authority', title: 'This needs the City Corporation', help: 'Too big, dangerous or needs machinery. An admin decides. No reward, no penalty.' },
  { kind: 'wrong_issue', title: 'This report is wrong', help: 'Already fixed, fake, or at the wrong place. An admin checks.' },
]

const OFFICIAL_RELEASE_OPTIONS: { kind: ReleaseKind; title: string; help: string }[] = [
  { kind: 'busy', title: 'We\'re busy right now', help: 'Back to your City Corporation for another official. The target date keeps running.' },
  { kind: 'send_back', title: 'Volunteers can handle this', help: 'Small enough for local volunteers. Your area admin decides: approved goes to volunteers, rejected comes back to you.' },
  { kind: 'wrong_issue', title: 'This report is wrong', help: 'Already fixed, fake, or at the wrong place. An admin checks.' },
]

function ReleaseDialog({ issue, open, onClose }: { issue: Issue; open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [kind, setKind] = useState<ReleaseKind>('busy')
  const [wrongType, setWrongType] = useState<WrongType>('already_fixed')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const needsEvidence = kind !== 'busy'
  // Officials don't have to be on site to say volunteers can handle it, so the photo is optional.
  const needsPhoto = needsEvidence && kind !== 'send_back'
  const options = issue.assignee_role === 'official' ? OFFICIAL_RELEASE_OPTIONS : RELEASE_OPTIONS

  async function submit() {
    if (!user) return
    setBusy(true)
    try {
      const media = needsEvidence ? await mediaService.uploadMedia(user.id, files) : []
      await volunteerService.releaseTask(issue.id, note, kind, media, kind === 'wrong_issue' ? wrongType : null)
      toast.success(kind === 'busy' ? 'Task released. No penalty — thanks for being honest.'
        : kind === 'send_back' ? 'Sent to your area admin. Approved goes to volunteers; rejected comes back to you.'
        : 'Sent to an admin. Thanks for checking on site.')
      invalidate(issue.id)
      onClose()
    } catch (e) {
      if (needsEvidence && !isNetworkError(e)) await mediaService.discardUploads(files)
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Release this task">
      <div className="space-y-4">
        <div className="space-y-2" role="radiogroup" aria-label="Reason">
          {options.map((o) => (
            <label key={o.kind} className={clsx('flex cursor-pointer gap-3 rounded-lg border p-3',
              kind === o.kind ? 'border-brand bg-brand-soft' : 'border-line hover:bg-card-hover')}>
              <input type="radio" name="release-kind" className="mt-1 accent-[var(--brand)]" checked={kind === o.kind}
                onChange={() => setKind(o.kind)} />
              <span>
                <span className="block text-sm font-semibold">{o.title}</span>
                <span className="block text-xs text-muted">{o.help}</span>
              </span>
            </label>
          ))}
        </div>
        {kind === 'wrong_issue' && (
          <div>
            <label className="label" htmlFor="wrong-type">What's wrong with it?</label>
            <select id="wrong-type" className="input" value={wrongType} onChange={(e) => setWrongType(e.target.value as WrongType)}>
              <option value="already_fixed">It's already fixed</option>
              <option value="fake">It's fake / doesn't exist</option>
              <option value="wrong_location">It's at a different place</option>
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="release-note">
            {kind === 'send_back' ? 'Why can volunteers handle it? (required)' : needsEvidence ? 'What did you find? (required)' : 'Why? (optional)'}
          </label>
          <textarea id="release-note" className="input" rows={3} maxLength={1000} value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={kind === 'needs_authority' ? 'e.g. About 5 tonnes of debris, needs a truck'
              : kind === 'send_back' ? 'e.g. Only a few bags of litter, a local cleanup is enough'
              : kind === 'wrong_issue' ? 'e.g. The drain was cleared yesterday' : ''} />
        </div>
        {needsEvidence && (
          <div>
            <span className="label">{needsPhoto ? 'Photo from the site (required)' : 'Photo (optional)'}</span>
            <MediaPicker files={files} onChange={setFiles} required={needsPhoto} imagesOnly />
          </div>
        )}
        <button className="btn-primary w-full"
          disabled={busy || (needsEvidence && note.trim().length < 10) || (needsPhoto && files.length === 0)} onClick={submit}>
          {busy && <Spinner className="size-4 text-brand-ink" />}
          {kind === 'busy' ? 'Release' : 'Send to an admin'}
        </button>
      </div>
    </Modal>
  )
}

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
