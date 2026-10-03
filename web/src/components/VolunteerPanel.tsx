import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { CheckCircle2, Clock, HandHelping, Hourglass, Star, ThumbsDown, ThumbsUp, Undo2, Upload, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAppSettings } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import {
  acceptTask, getIssueMedia, postProgress, rateVolunteer, releaseTask, reviewResolution, submitResolution,
} from '../lib/api'
import { displayName, hoursLeft, timeAgo, timeLeft } from '../lib/format'
import { getCurrentPosition, getLastKnownPosition } from '../lib/geo'
import { uploadMedia } from '../lib/media'
import type { Issue, MediaItem } from '../lib/types'
import { LocationStatus, useInvalidateIssue, useOnSiteLocation } from './IssueDialogs'
import { MediaGallery } from './MediaGallery'
import { MediaPicker } from './MediaPicker'
import { Spinner } from './ui'

/** Everything about getting an issue fixed: accept → progress → fix → confirm → rate. */
export function VolunteerPanel({ issue }: { issue: Issue }) {
  const { user, profile } = useAuth()
  const isVolunteerOnTask = Boolean(user) && issue.volunteer_id === user?.id

  return (
    <section className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-bold">
        <Wrench className="size-5 text-brand" /> Getting it fixed
      </h2>
      <p className="text-sm text-muted">
        {issue.resolver === 'community'
          ? 'Volunteers can fix this kind of problem directly.'
          : 'This needs the authority. The volunteer files the complaint, follows up, and confirms once it is fixed.'}
      </p>

      {issue.status === 'community_review' && (
        <Note icon={<Hourglass className="size-5" />}>
          Waiting for community validation. Volunteers can take it once it's validated.
        </Note>
      )}
      {(issue.status === 'hidden' || issue.status === 'expired') && (
        <Note icon={<Hourglass className="size-5" />}>Not open for volunteers.</Note>
      )}

      {issue.status === 'validated' && <AcceptTask issue={issue} isVolunteer={Boolean(profile?.is_volunteer)} />}

      {['assigned', 'in_progress'].includes(issue.status) &&
        (isVolunteerOnTask ? <MyActiveTask issue={issue} /> : <WorkingOnIt issue={issue} />)}

      {issue.status === 'resolution_submitted' && <ResolutionReview issue={issue} isVolunteerOnTask={isVolunteerOnTask} />}

      {issue.status === 'closed' && <Closed issue={issue} />}
    </section>
  )
}

function Note({ icon, children, tone = 'muted' }: { icon: React.ReactNode; children: React.ReactNode; tone?: 'muted' | 'brand' | 'warn' }) {
  return (
    <div className={clsx('flex items-start gap-2 rounded-lg p-3 text-sm',
      tone === 'brand' ? 'bg-brand-soft' : tone === 'warn' ? 'bg-warn-soft' : 'bg-bg')}>
      <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <div className="flex-1">{children}</div>
    </div>
  )
}

function AcceptTask({ issue, isVolunteer }: { issue: Issue; isVolunteer: boolean }) {
  const { user } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  if (!user) return <Note icon={<HandHelping className="size-5" />}><Link to="/login" className="font-semibold text-brand">Log in</Link> to volunteer for this task.</Note>
  if (issue.is_mine) return <Note icon={<HandHelping className="size-5" />}>Validated! Waiting for a volunteer. (You can't take your own report.)</Note>
  if (!isVolunteer) {
    return (
      <Note icon={<HandHelping className="size-5" />}>
        Validated and waiting for a volunteer. <Link to="/volunteer" className="font-semibold text-brand">Become a volunteer</Link> to take it on.
      </Note>
    )
  }

  async function accept() {
    setBusy(true)
    try {
      await acceptTask(issue.id)
      toast.success(`It's yours! Post an update at least every ${settings?.lock_hours ?? 72} hours.`)
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
      invalidate(issue.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm">
        Taking this task locks it for you. Post a progress update at least every{' '}
        <strong>{settings?.lock_hours ?? 72} hours</strong> or it returns to the pool (and you lose {Math.abs(settings?.rep_task_expired ?? 5)} reputation).
        You can release it any time without penalty.
      </p>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy} onClick={accept}>
          {busy ? <Spinner className="size-4 text-brand-ink" /> : <HandHelping className="size-4" />} Accept this task
        </button>
        <button className="btn-soft" onClick={() => navigate('/volunteer')}>More tasks</button>
      </div>
    </div>
  )
}

function WorkingOnIt({ issue }: { issue: Issue }) {
  return (
    <Note icon={<Wrench className="size-5" />} tone="brand">
      <Link to={`/u/${issue.volunteer_username}`} className="font-semibold hover:underline">
        {displayName(issue.volunteer_full_name, issue.volunteer_username)}
      </Link>{' '}
      took this on {issue.assigned_at ? timeAgo(issue.assigned_at) : ''}. Their lock runs out in{' '}
      {timeLeft(issue.lock_expires_at).replace(' left', '')} unless they post progress.
    </Note>
  )
}

function MyActiveTask({ issue }: { issue: Issue }) {
  const { user } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [mode, setMode] = useState<'progress' | 'resolve' | null>(null)
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const radius = settings?.resolution_radius_m ?? 200
  const loc = useOnSiteLocation(issue)
  const left = hoursLeft(issue.lock_expires_at)

  async function sendProgress() {
    if (!user) return
    setBusy(true)
    try {
      const media = await uploadMedia(user.id, files)
      await postProgress(issue.id, note, media)
      toast.success(`Update posted. Your lock is extended by ${settings?.lock_hours ?? 72} hours.`)
      setNote(''); setFiles([]); setMode(null)
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  async function sendResolution() {
    if (!user || !loc.pos) return
    setBusy(true)
    try {
      const media = await uploadMedia(user.id, files)
      await submitResolution(issue.id, note, loc.pos.lat, loc.pos.lng, loc.pos.accuracy, media)
      toast.success('Fix submitted! The reporter and neighbours will confirm it.')
      setNote(''); setFiles([]); setMode(null)
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  async function release() {
    const reason = window.prompt('Why are you releasing this task? (optional)')
    if (reason === null) return
    try {
      await releaseTask(issue.id, reason)
      toast.success('Task released. No penalty — thanks for being honest.')
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <div className="space-y-3">
      <div className={clsx('flex items-center gap-2 rounded-lg p-3 text-sm font-semibold',
        left < 24 ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand')}>
        <Clock className="size-5" />
        This is your task · {timeLeft(issue.lock_expires_at)} on your lock
      </div>

      {mode === null && (
        <div className="grid gap-2 sm:grid-cols-3">
          <button className="btn-soft" onClick={() => setMode('progress')}><Upload className="size-4" /> Post progress</button>
          <button className="btn-primary" onClick={() => setMode('resolve')}><CheckCircle2 className="size-4" /> Submit fix</button>
          <button className="btn-ghost" onClick={release}><Undo2 className="size-4" /> Release</button>
        </div>
      )}

      {mode && (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <h3 className="font-semibold">{mode === 'progress' ? 'Progress update' : 'Submit the fix'}</h3>
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={mode === 'progress'
              ? issue.resolver === 'authority'
                ? 'e.g. Filed complaint with DNCC hotline 16106, reference #…'
                : 'e.g. Gathered 4 people and gloves, cleaning on Friday'
              : 'What was done? Who fixed it?'} />
          <MediaPicker files={files} onChange={setFiles} required={mode === 'resolve'} imagesOnly={mode === 'resolve'} />
          {mode === 'resolve' && <LocationStatus loc={loc} radius={radius} />}
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1"
              disabled={busy || note.trim().length < 3 || (mode === 'resolve' && (!loc.pos || files.length === 0))}
              onClick={mode === 'progress' ? sendProgress : sendResolution}
            >
              {busy && <Spinner className="size-4 text-brand-ink" />} {mode === 'progress' ? 'Post update' : 'Submit fix'}
            </button>
            <button className="btn-ghost" onClick={() => setMode(null)}>Cancel</button>
          </div>
          {mode === 'resolve' && (
            <p className="text-xs text-muted">
              Take the "after" photo from the same spot as the original. Fake fixes get disputed and cost {Math.abs(settings?.rep_task_reopened ?? 15)} reputation.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ResolutionReview({ issue, isVolunteerOnTask }: { issue: Issue; isVolunteerOnTask: boolean }) {
  const { user } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [busy, setBusy] = useState(false)
  const media = useQuery({ queryKey: ['media', issue.id], queryFn: () => getIssueMedia(issue.id) }).data ?? []
  const after: MediaItem[] = media
    .filter((m) => m.kind === 'resolution')
    .map((m) => ({ id: m.id, kind: m.kind, media_type: m.media_type, path: m.storage_path }))

  async function review(fixed: boolean) {
    setBusy(true)
    try {
      let pos = getLastKnownPosition()
      if (!issue.is_mine && !issue.my_confirmed && !pos) {
        pos = await getCurrentPosition().catch(() => null)
      }
      const status = await reviewResolution(issue.id, fixed, pos?.lat, pos?.lng)
      toast.success(
        status === 'closed' ? 'Issue closed. Thank you!'
          : status === 'validated' ? 'Issue reopened for another volunteer.'
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
        <strong>{displayName(issue.volunteer_full_name, issue.volunteer_username)}</strong> says it's fixed
        {issue.resolution_submitted_at ? ` (${timeAgo(issue.resolution_submitted_at)})` : ''}:
        <p className="mt-1 whitespace-pre-line">{issue.resolution_note}</p>
      </Note>
      {after.length > 0 && <div className="overflow-hidden rounded-lg"><MediaGallery items={after} /></div>}

      {isVolunteerOnTask ? (
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
              ? 'As the reporter, your answer decides immediately.'
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

  async function rate() {
    setBusy(true)
    try {
      await rateVolunteer(issue.id, stars, review)
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
        Resolved {issue.closed_at ? timeAgo(issue.closed_at) : ''} by{' '}
        <Link to={`/u/${issue.volunteer_username}`} className="font-semibold hover:underline">
          {displayName(issue.volunteer_full_name, issue.volunteer_username)}
        </Link>.
        {issue.resolution_note && <p className="mt-1 whitespace-pre-line">{issue.resolution_note}</p>}
      </Note>
      {issue.is_mine && !issue.is_rated && issue.volunteer_id && (
        <div className="space-y-2 rounded-lg border border-line p-3">
          <p className="text-sm font-semibold">Rate the volunteer</p>
          <div className="flex gap-1" role="radiogroup" aria-label="Stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} aria-label={`${n} stars`} onClick={() => setStars(n)}>
                <Star className={clsx('size-8', n <= stars ? 'fill-warn text-warn' : 'text-line')} />
              </button>
            ))}
          </div>
          <textarea className="input" rows={2} maxLength={500} placeholder="Say thanks or give feedback (optional)"
            value={review} onChange={(e) => setReview(e.target.value)} />
          <button className="btn-primary w-full" disabled={busy || stars === 0} onClick={rate}>Submit rating</button>
        </div>
      )}
    </div>
  )
}
