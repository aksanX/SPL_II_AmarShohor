import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Building2, CheckCircle2, Clock, Copy, Crown, Hourglass, HandHelping, LogOut, MapPin, Phone, Scale,
  Star, ThumbsDown, ThumbsUp, Undo2, Upload, Users, Wrench,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAppSettings } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import {
  acceptLead, acceptTask, checkIn, getIssueMedia, getMyTasks, getTeam, joinTeam, leaveTeam, offerLead, postProgress, rateVolunteer,
  releaseTask, requestSendBack, reviewResolution, setComplaintRef, submitResolution,
} from '../lib/api'
import { ROUTE_LABEL, displayName, dueText, hoursLeft, timeAgo } from '../lib/format'
import { ledTaskCount, lockNote, myLockText, plural, starLabel } from '../lib/volunteer'
import { getCurrentPosition, getLastKnownPosition } from '../lib/geo'
import { discardUploads, isNetworkError, uploadMedia } from '../lib/media'
import type { Issue, MediaItem, ReleaseKind, WrongType } from '../lib/types'
import { LocationStatus, useInvalidateIssue, useOnSiteLocation } from './IssueDialogs'
import { MediaGallery } from './MediaGallery'
import { MediaPicker } from './MediaPicker'
import { Avatar, Modal, Spinner } from './ui'

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
      {issue.status === 'under_review' && (
        <Note icon={<Scale className="size-5" />} tone="warn">
          A volunteer asked for a decision (see the timeline). An admin will decide what happens next.
        </Note>
      )}

      {issue.status === 'validated' && issue.route === 'pending' && (
        <Note icon={<Scale className="size-5" />} tone="warn">
          Validated. An admin is deciding whether volunteers or the City Corporation should fix it.
        </Note>
      )}
      {issue.status === 'validated' && issue.route === 'community' && (
        <AcceptTask issue={issue} isVolunteer={Boolean(profile?.is_volunteer)} />
      )}

      {isAuthority && !['community_review', 'hidden', 'expired'].includes(issue.status) && <CityCorpInfo issue={issue} />}
      {issue.status === 'escalated' && <OfficialAccept issue={issue} />}

      {active && (isOnTask ? <MyActiveTask issue={issue} /> : <WorkingOnIt issue={issue} />)}
      {active && issue.team_size > 1 && <TeamPanel issue={issue} />}

      {issue.status === 'resolution_submitted' && (
        <ResolutionReview issue={issue}
          cannotReview={isOnTask || issue.my_team_member || issue.my_authority_covers || role === 'admin' || role === 'city_admin'} />
      )}

      {issue.status === 'closed' && <Closed issue={issue} />}
    </section>
  )
}

function Note({ icon, children, tone = 'muted' }: { icon: React.ReactNode; children: React.ReactNode; tone?: 'muted' | 'brand' | 'warn' | 'danger' }) {
  return (
    <div className={clsx('flex items-start gap-2 rounded-lg p-3 text-sm',
      tone === 'brand' ? 'bg-brand-soft' : tone === 'warn' ? 'bg-warn-soft' : tone === 'danger' ? 'bg-danger-soft' : 'bg-bg')}>
      <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** Who fixes it, and whether an admin changed it. */
function RouteInfo({ issue }: { issue: Issue }) {
  const who = issue.route === 'authority' ? (issue.authority_short_name ?? ROUTE_LABEL.authority) : ROUTE_LABEL[issue.route]
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-muted">Who fixes it:</span>
        <span className={clsx('chip', issue.route === 'authority' ? 'bg-warn-soft text-warn'
          : issue.route === 'community' ? 'bg-brand-soft text-brand' : 'bg-card-hover text-muted')}>
          {issue.route === 'authority' ? <Building2 className="size-3.5" /> : <Users className="size-3.5" />} {who}
        </span>
      </div>
      {issue.route_source === 'admin' && (
        <p className="text-xs text-muted">Route decided by an admin (see the timeline for the reason).</p>
      )}
    </div>
  )
}

// ---------- volunteers ----------

function AcceptTask({ issue, isVolunteer }: { issue: Issue; isVolunteer: boolean }) {
  const { user, profile, role } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [teamSize, setTeamSize] = useState(1)
  // Same list as the volunteer dashboard (shared cache), to know how many tasks this volunteer already leads.
  const myTasks = useQuery({ queryKey: ['tasks', 'mine'], queryFn: getMyTasks, enabled: Boolean(user) && isVolunteer })

  if (!user) return <Note icon={<HandHelping className="size-5" />}><Link to="/login" className="font-semibold text-brand">Log in</Link> to volunteer for this task.</Note>
  if (issue.is_mine) return <Note icon={<HandHelping className="size-5" />}>Validated! Waiting for a volunteer. (You can't take your own report.)</Note>
  // Volunteering is for citizens.
  if (role !== 'citizen') return <Note icon={<HandHelping className="size-5" />}>Validated and waiting for a volunteer to take it on.</Note>
  if (!isVolunteer) {
    return (
      <Note icon={<HandHelping className="size-5" />}>
        Validated and waiting for a volunteer. <Link to="/volunteer" className="font-semibold text-brand">Become a volunteer</Link> to take it on.
      </Note>
    )
  }

  const canLeadTeam = (profile?.tasks_completed ?? 0) >= (settings?.team_lead_min_tasks ?? 1) && (profile?.reputation ?? 0) > 0
  const lockHours = teamSize > 1 ? settings?.team_lock_hours ?? 120 : settings?.lock_hours ?? 72
  const maxTasks = settings?.max_active_tasks ?? 3
  const atLimit = myTasks.isSuccess && ledTaskCount(myTasks.data, user.id) >= maxTasks

  async function accept() {
    setBusy(true)
    try {
      await acceptTask(issue.id, teamSize)
      toast.success(teamSize > 1
        ? `You lead this task. Nearby volunteers were asked to join. Post an update at least every ${lockHours} hours.`
        : `It's yours! Post an update at least every ${lockHours} hours.`)
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
      invalidate(issue.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="team-size">How many people does this need, including you?</label>
        <select id="team-size" className="input" value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
            <option key={n} value={n} disabled={n > 1 && !canLeadTeam}>{n === 1 ? 'Just me' : `${n} people (team)`}</option>
          ))}
        </select>
        {!canLeadTeam && (
          <p className="mt-1 text-xs text-muted">
            Leading a team needs {plural(settings?.team_lead_min_tasks ?? 1, 'completed task')} and positive reputation. You can still join other teams.
          </p>
        )}
      </div>
      <p className="text-sm">
        Taking this task locks it for you{teamSize > 1 ? ' and your team' : ''}. Post a progress update at least every{' '}
        <strong>{lockHours} hours</strong> or it returns to the pool (and you lose {Math.abs(settings?.rep_task_expired ?? 5)} reputation).
        You can release it any time without penalty.
      </p>
      {atLimit && (
        <Note icon={<Hourglass className="size-5" />} tone="warn">
          You already lead {plural(maxTasks, 'task')}, the most allowed at once. Finish or release one first.{' '}
          <Link to="/volunteer" className="font-semibold text-brand">See my tasks</Link>
        </Note>
      )}
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy || atLimit} onClick={accept}>
          {busy ? <Spinner className="size-4 text-brand-ink" /> : <HandHelping className="size-4" />}
          {teamSize > 1 ? 'Accept and lead the team' : 'Accept this task'}
        </button>
        <button className="btn-soft" onClick={() => navigate('/volunteer')}>More tasks</button>
      </div>
    </div>
  )
}

function WorkingOnIt({ issue }: { issue: Issue }) {
  const name = displayName(issue.volunteer_full_name, issue.volunteer_username)
  return (
    <Note icon={<Wrench className="size-5" />} tone="brand">
      <Link to={`/u/${issue.volunteer_username}`} className="font-semibold hover:underline">{name}</Link>
      {issue.assignee_role === 'official' ? ` (${issue.authority_short_name} official)` : issue.team_size > 1 ? ' (team leader)' : ''}{' '}
      took this on {issue.assigned_at ? timeAgo(issue.assigned_at) : ''}.
      {issue.lock_expires_at && <> {lockNote(issue.lock_expires_at)}</>}
    </Note>
  )
}

function TeamPanel({ issue }: { issue: Issue }) {
  const { user, profile } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [busy, setBusy] = useState(false)
  const loc = useOnSiteLocation(issue)
  const team = useQuery({ queryKey: ['team', issue.id], queryFn: () => getTeam(issue.id) }).data ?? []
  const isLeader = user?.id === issue.volunteer_id
  const [handingTo, setHandingTo] = useState<string | null>(null)
  const spots = issue.team_size - 1 - issue.team_count
  const radius = settings?.resolution_radius_m ?? 200

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try {
      await action()
      toast.success(ok)
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <h3 className="flex items-center gap-2 font-semibold">
        <Users className="size-4 text-brand" /> Team {issue.team_count + 1}/{issue.team_size}
      </h3>
      <ul className="space-y-1.5">
        {team.map((m) => (
          <li key={m.user_id} className="flex items-center gap-2 text-sm">
            <Avatar url={m.avatar_url} name={displayName(m.full_name, m.username)} size={24} />
            <Link to={`/u/${m.username}`} className="min-w-0 flex-1 truncate hover:underline">{displayName(m.full_name, m.username)}</Link>
            {m.is_leader
              ? <span className="chip bg-brand-soft text-brand"><Crown className="size-3.5" /> Leader</span>
              : m.checked_in_at
                ? <span className="chip bg-brand-soft text-brand"><MapPin className="size-3.5" /> Came</span>
                : <span className="text-xs text-muted">joined {timeAgo(m.joined_at)}</span>}
            {isLeader && !m.is_leader && handingTo !== m.user_id && (
              <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => setHandingTo(m.user_id)}>
                Hand over
              </button>
            )}
            {isLeader && handingTo === m.user_id && (
              <span className="flex items-center gap-1 text-xs">
                Make them leader?
                <button className="btn-primary px-2 py-1 text-xs" disabled={busy}
                  onClick={() => { setHandingTo(null); run(() => offerLead(issue.id, m.user_id), 'Asked them to take over. They need to accept.') }}>
                  Yes
                </button>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setHandingTo(null)}>No</button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {(issue.lead_offer_to_me || (issue.lead_offer_open && issue.my_team_member)) && (
        <Note icon={<Crown className="size-5" />} tone="warn">
          {issue.lead_offer_to_me ? 'The leader asked you to take over.' : 'The leader has been inactive. Do you want to lead this task?'}
          <button className="btn-primary mt-2 w-full" disabled={busy}
            onClick={() => run(() => acceptLead(issue.id), 'You now lead this task.')}>
            Become the leader
          </button>
        </Note>
      )}

      {issue.my_team_member && (
        <div className="space-y-2">
          {issue.my_checked_in ? (
            <p className="flex items-center gap-2 text-sm font-semibold text-brand"><CheckCircle2 className="size-4" /> You checked in at the site.</p>
          ) : (
            <>
              <p className="text-xs text-muted">On the work day, check in at the site. Only members who check in get the reward when the fix is confirmed.</p>
              <LocationStatus loc={loc} radius={radius} />
              <button className="btn-primary w-full" disabled={busy || !loc.pos}
                onClick={() => run(() => checkIn(issue.id, loc.pos!.lat, loc.pos!.lng, loc.pos!.accuracy), 'Checked in. Thanks for showing up!')}>
                <MapPin className="size-4" /> I'm here
              </button>
            </>
          )}
          <button className="btn-ghost w-full text-xs" disabled={busy}
            onClick={() => run(() => leaveTeam(issue.id), 'You left the team.')}>
            <LogOut className="size-3.5" /> Leave the team (no penalty)
          </button>
        </div>
      )}

      {!isLeader && !issue.my_team_member && spots > 0 && user && profile?.is_volunteer && !issue.is_mine && (
        <button className="btn-soft w-full" disabled={busy}
          onClick={() => run(() => joinTeam(issue.id), 'You joined the team!')}>
          <Users className="size-4" /> Join the team ({spots} {spots === 1 ? 'spot' : 'spots'} left)
        </button>
      )}
    </div>
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
  const [releasing, setReleasing] = useState(false)
  const [sendingBack, setSendingBack] = useState(false)
  const radius = settings?.resolution_radius_m ?? 200
  const loc = useOnSiteLocation(issue)
  const left = hoursLeft(issue.lock_expires_at)
  const isOfficial = issue.assignee_role === 'official'

  async function sendProgress() {
    if (!user) return
    setBusy(true)
    try {
      const media = await uploadMedia(user.id, files)
      await postProgress(issue.id, note, media)
      toast.success(isOfficial ? 'Update posted.' : `Update posted. Your lock is extended by ${issue.team_size > 1 ? settings?.team_lock_hours ?? 120 : settings?.lock_hours ?? 72} hours.`)
      setNote(''); setFiles([]); setMode(null)
      invalidate(issue.id)
    } catch (e) {
      if (!isNetworkError(e)) await discardUploads(files)
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
      if (!isNetworkError(e)) await discardUploads(files)
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
      {mode === null && isOfficial && (
        <button className="btn-ghost w-full text-xs" onClick={() => setSendingBack(true)}>
          <Users className="size-3.5" /> Volunteers can handle this — ask the admin
        </button>
      )}

      {mode && (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <h3 className="font-semibold">{mode === 'progress' ? 'Progress update' : 'Submit the fix'}</h3>
          <textarea className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
            aria-label={mode === 'progress' ? 'Progress update' : 'What was fixed'}
            placeholder={mode === 'progress'
              ? isOfficial ? 'e.g. Road team scheduled for Thursday' : 'e.g. Gathered 4 people and gloves, cleaning on Friday'
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
            {/* Clear the note and files too: a video added to an update must not stay attached to a fix (photos only). */}
            <button className="btn-ghost" onClick={() => { setMode(null); setNote(''); setFiles([]) }}>Cancel</button>
          </div>
          {mode === 'resolve' && (
            <p className="text-xs text-muted">
              Take the "after" photo from the same spot as the original.
              {!isOfficial && ` Fake fixes get disputed and cost ${Math.abs(settings?.rep_task_reopened ?? 15)} reputation.`}
            </p>
          )}
        </div>
      )}

      <ReleaseDialog issue={issue} open={releasing} onClose={() => setReleasing(false)} />
      <SendBackDialog issue={issue} open={sendingBack} onClose={() => setSendingBack(false)} />
    </div>
  )
}

const RELEASE_OPTIONS: { kind: ReleaseKind; title: string; help: string }[] = [
  { kind: 'busy', title: 'I can\'t do it right now', help: 'Back to the pool (or to your team). No penalty.' },
  { kind: 'needs_authority', title: 'This needs the City Corporation', help: 'Too big, dangerous or needs machinery. An admin decides. No reward, no penalty.' },
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
  const options = issue.assignee_role === 'official' ? RELEASE_OPTIONS.filter((o) => o.kind !== 'needs_authority') : RELEASE_OPTIONS

  async function submit() {
    if (!user) return
    setBusy(true)
    try {
      const media = needsEvidence ? await uploadMedia(user.id, files) : []
      await releaseTask(issue.id, note, kind, media, kind === 'wrong_issue' ? wrongType : null)
      toast.success(kind === 'busy' ? 'Task released. No penalty — thanks for being honest.' : 'Sent to an admin. Thanks for checking on site.')
      invalidate(issue.id)
      onClose()
    } catch (e) {
      if (needsEvidence && !isNetworkError(e)) await discardUploads(files)
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
          <label className="label" htmlFor="release-note">{needsEvidence ? 'What did you find? (required)' : 'Why? (optional)'}</label>
          <textarea id="release-note" className="input" rows={3} maxLength={1000} value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={kind === 'needs_authority' ? 'e.g. About 5 tonnes of debris, needs a truck' : kind === 'wrong_issue' ? 'e.g. The drain was cleared yesterday' : ''} />
        </div>
        {needsEvidence && (
          <div>
            <span className="label">Photo from the site (required)</span>
            <MediaPicker files={files} onChange={setFiles} required imagesOnly />
          </div>
        )}
        <button className="btn-primary w-full"
          disabled={busy || (needsEvidence && (note.trim().length < 10 || files.length === 0))} onClick={submit}>
          {busy && <Spinner className="size-4 text-brand-ink" />}
          {kind === 'busy' ? 'Release' : 'Send to an admin'}
        </button>
      </div>
    </Modal>
  )
}

// ---------- City Corporation ----------

/** Escalation details: hotline, target time, complaint reference, ready-made complaint text. */
function CityCorpInfo({ issue }: { issue: Issue }) {
  const { user, profile, isAdmin } = useAuth()
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [ref, setRef] = useState(issue.complaint_ref ?? '')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const open = ['escalated', 'assigned', 'in_progress', 'resolution_submitted'].includes(issue.status)
  // The City Corporation's officials and admins can change it; a volunteer can only add the first one.
  const canSetRef = Boolean(user) && open
    && (issue.i_am_official_here || isAdmin || (Boolean(profile?.is_volunteer) && !issue.complaint_ref))

  if (!issue.authority_id) {
    return (
      <Note icon={<Building2 className="size-5" />} tone="warn">
        No City Corporation covers this location yet. An admin has been asked to sort it out.
      </Note>
    )
  }

  function complaintText() {
    const url = `${window.location.origin}/issue/${issue.id}`
    const map = `https://www.openstreetmap.org/?mlat=${issue.lat}&mlon=${issue.lng}#map=18/${issue.lat}/${issue.lng}`
    return [
      `Complaint for ${issue.authority_name}`,
      `Problem: ${issue.title} (${issue.category_name}, severity ${issue.severity})`,
      issue.description && `Details: ${issue.description}`,
      `Location: ${issue.address || `${issue.lat.toFixed(5)}, ${issue.lng.toFixed(5)}`}`,
      `Map: ${map}`,
      `Reported ${timeAgo(issue.created_at)}, confirmed by ${issue.confirmation_count} residents on site and supported by ${issue.upvote_count} more.`,
      `Photos and full history: ${url}`,
    ].filter(Boolean).join('\n')
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(complaintText())
      toast.success('Complaint copied. Paste it into the hotline form or message.')
    } catch {
      toast.error(new Error('Could not copy. Select the text manually.'))
    }
  }

  async function saveRef() {
    setBusy(true)
    try {
      await setComplaintRef(issue.id, ref.trim())
      toast.success('Reference saved.')
      setEditing(false)
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={clsx('space-y-2 rounded-lg border p-3', issue.is_overdue ? 'border-danger bg-danger-soft/40' : 'border-line')}>
      <div className="flex flex-wrap items-center gap-2">
        <Building2 className="size-5 text-warn" />
        <span className="font-semibold">{issue.authority_name}</span>
        {issue.due_at && open && (
          <span className={clsx('chip', issue.is_overdue ? 'bg-danger text-danger-ink' : 'bg-warn-soft text-warn')}>
            <Clock className="size-3.5" /> {issue.is_overdue ? 'Overdue' : 'Target'} · {dueText(issue.due_at)}
          </span>
        )}
      </div>
      {issue.escalated_at && <p className="text-xs text-muted">Sent to {issue.authority_short_name} {timeAgo(issue.escalated_at)}.</p>}
      {issue.is_overdue && (
        <p className="text-sm">The City Corporation is past its target time. Volunteers can follow up through the hotline.</p>
      )}
      {issue.authority_hotline && (
        <p className="flex items-center gap-2 text-sm">
          <Phone className="size-4 text-muted" /> Hotline <span className="select-all font-semibold">{issue.authority_hotline}</span>
          <a className="text-xs font-semibold text-brand" href={`tel:${issue.authority_hotline}`}>Call</a>
        </p>
      )}
      {issue.authority_complaint_url && (
        <a className="block text-sm font-semibold text-brand hover:underline" href={issue.authority_complaint_url} target="_blank" rel="noreferrer">
          Official complaint page →
        </a>
      )}
      {open && <button className="btn-soft w-full" onClick={copy}><Copy className="size-4" /> Copy complaint</button>}

      <div className="text-sm">
        <span className="text-muted">Complaint reference: </span>
        {editing ? (
          <span className="mt-1 flex gap-2">
            <input className="input py-1.5" value={ref} maxLength={120} onChange={(e) => setRef(e.target.value)}
              placeholder="e.g. DNCC-16106-8812" aria-label="Complaint reference" />
            <button className="btn-primary" disabled={busy || ref.trim().length < 2} onClick={saveRef}>Save</button>
          </span>
        ) : (
          <>
            <span className="font-semibold">{issue.complaint_ref || 'not recorded yet'}</span>
            {canSetRef && <button className="ml-2 text-xs font-semibold text-brand" onClick={() => setEditing(true)}>{issue.complaint_ref ? 'Change' : 'Add'}</button>}
          </>
        )}
      </div>
    </div>
  )
}

function OfficialAccept({ issue }: { issue: Issue }) {
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [busy, setBusy] = useState(false)
  const [sendingBack, setSendingBack] = useState(false)
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
      await acceptTask(issue.id)
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
      <button className="btn-ghost w-full text-xs" onClick={() => setSendingBack(true)}>
        <Users className="size-3.5" /> Volunteers can handle this — ask the admin
      </button>
      <SendBackDialog issue={issue} open={sendingBack} onClose={() => setSendingBack(false)} />
    </div>
  )
}

function SendBackDialog({ issue, open, onClose }: { issue: Issue; open: boolean; onClose: () => void }) {
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      await requestSendBack(issue.id, note)
      toast.success('Sent to an admin for a decision.')
      invalidate(issue.id)
      onClose()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Send to volunteers?">
      <div className="space-y-3">
        <p className="text-sm text-muted">If this is small enough for local volunteers, explain why. An admin decides.</p>
        <textarea className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Only a few bags of litter, a local cleanup is enough" aria-label="Reason" />
        <button className="btn-primary w-full" disabled={busy || note.trim().length < 10} onClick={submit}>
          {busy && <Spinner className="size-4 text-brand-ink" />} Ask the admin
        </button>
      </div>
    </Modal>
  )
}

// ---------- confirming the fix ----------

function ResolutionReview({ issue, cannotReview }: { issue: Issue; cannotReview: boolean }) {
  const { user } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [busy, setBusy] = useState(false)
  const media = useQuery({ queryKey: ['media', issue.id], queryFn: () => getIssueMedia(issue.id) }).data ?? []
  const after: MediaItem[] = media
    .filter((m) => m.kind === 'resolution')
    .map((m) => ({ id: m.id, kind: m.kind, media_type: m.media_type, path: m.storage_path }))
  const who = issue.assignee_role === 'official'
    ? `${displayName(issue.volunteer_full_name, issue.volunteer_username)} (${issue.authority_short_name})`
    : displayName(issue.volunteer_full_name, issue.volunteer_username)

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
