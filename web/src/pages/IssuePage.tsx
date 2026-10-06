import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  AlarmClock, BadgeCheck, Building2, Camera, CheckCircle2, CircleX, Crown, Eye, EyeOff, Flag, Hash, Hourglass,
  LogOut, MapPin, Megaphone, PencilLine, PlusCircle, RotateCcw, Scale, Siren, Tags, Undo2, UserMinus, UserPlus, Users,
  Wrench,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Comments } from '../components/Comments'
import { IssueCard } from '../components/IssueCard'
import { MediaGallery } from '../components/MediaGallery'
import { MiniMap } from '../components/map/LocationPicker'
import { Avatar, Empty, PageSpinner } from '../components/ui'
import { AdminIssueTools } from '../components/AdminIssueTools'
import { useInvalidateIssue } from '../components/IssueDialogs'
import { StillThereBox } from '../components/StillThereBox'
import { VolunteerPanel } from '../components/VolunteerPanel'
import { useAuth } from '../hooks/useAuth'
import { useAppSettings } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import {
  getCategoryVotes, getIssue, getIssueAlert, getIssueEvents, getIssueMedia, voteSeverity, withdrawCategorySuggestion,
} from '../lib/api'
import { EMERGENCY_VERSION } from '../lib/categories'
import { SEVERITIES, SEVERITY_META, displayName, timeAgo } from '../lib/format'
import type { Issue, IssueEvent, MediaItem, Severity } from '../lib/types'

export function IssuePage() {
  const { id = '' } = useParams()
  const location = useLocation()
  const openConfirm = Boolean((location.state as { openConfirm?: boolean } | null)?.openConfirm)
  const [tab, setTab] = useState<'discussion' | 'timeline' | 'evidence'>('discussion')
  const { data: issue, isLoading, error } = useQuery({ queryKey: ['issue', id], queryFn: () => getIssue(id) })
  const alert = useQuery({ queryKey: ['issue_alert', id], queryFn: () => getIssueAlert(id), refetchInterval: 60_000 }).data

  if (isLoading) return <PageSpinner />
  if (error) return <div className="mx-auto max-w-2xl p-4"><Empty title="Couldn't load this issue">{(error as Error).message}</Empty></div>
  if (!issue) return <div className="mx-auto max-w-2xl p-4"><Empty title="Issue not found">It may have been deleted by its reporter.</Empty></div>

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
        <SeverityVote issue={issue} />
        {alert?.status !== 'active' && !['closed', 'expired', 'hidden'].includes(issue.status) && <RaiseEmergency issue={issue} />}
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
          <a className="text-sm font-semibold text-brand hover:underline" target="_blank" rel="noreferrer"
            href={`https://www.openstreetmap.org/?mlat=${issue.lat}&mlon=${issue.lng}#map=18/${issue.lat}/${issue.lng}`}>
            Open in OpenStreetMap →
          </a>
        </section>
      </aside>
    </div>
  )
}

/** What people who saw it say it really is. Hidden when nobody disagrees with the category. */
function CategoryVotes({ issue }: { issue: Issue }) {
  const settings = useAppSettings().data
  const invalidate = useInvalidateIssue()
  const toast = useToast()
  const votes = useQuery({ queryKey: ['category_votes', issue.id], queryFn: () => getCategoryVotes(issue.id) })
  const list = votes.data ?? []
  if (!list.length) return null

  async function withdraw() {
    try {
      await withdrawCategorySuggestion(issue.id)
      votes.refetch()
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <section className="card space-y-2 p-4">
      <h2 className="font-bold">Is the category right?</h2>
      <p className="text-sm text-muted">
        Listed as <strong className="text-ink">{issue.category_name ?? 'no category'}</strong>, but people say it may be:
      </p>
      <ul className="space-y-1 text-sm">
        {list.map((v) => (
          <li key={v.category} className="flex items-center justify-between gap-2">
            <span>{v.name}</span>
            <span className="text-xs text-muted">{v.votes} {v.votes === 1 ? 'person' : 'people'}{v.on_site > 0 && `, ${v.on_site} on site`}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        It changes when {settings?.recategorize_confirms ?? 2} people on site, or {settings?.recategorize_votes ?? 3} in total,
        agree. Disagreements go to an admin.
      </p>
      {list.some((v) => v.mine) && (
        <button className="btn-ghost px-2 py-1 text-xs" onClick={withdraw}>Withdraw my suggestion</button>
      )}
    </section>
  )
}

/** Any open issue can get worse: send people to raise an alert linked to it. */
function RaiseEmergency({ issue }: { issue: Issue }) {
  const version = issue.category ? EMERGENCY_VERSION[issue.category] : undefined
  const to = `/emergency?issue=${issue.id}${version ? `&kind=${version.kind}` : ''}`
  return (
    <section className="card space-y-2 border-danger/40 p-4">
      <h2 className="flex items-center gap-2 font-bold text-danger"><Siren className="size-5" /> Has it become dangerous?</h2>
      <p className="text-sm text-muted">
        {version?.question ?? 'Is someone hurt or in danger right now?'} Call 999 first, then warn people nearby.
      </p>
      <Link to={to} className="btn-danger w-full">Raise an emergency alert</Link>
    </section>
  )
}

function SeverityVote({ issue }: { issue: Issue }) {
  const { user } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  if (['closed', 'expired'].includes(issue.status)) return null

  async function vote(s: Severity) {
    setBusy(true)
    try {
      await voteSeverity(issue.id, s)
      qc.invalidateQueries({ queryKey: ['issue', issue.id] })
      toast.success('Thanks — severity is decided by the community.')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-2 p-4">
      <h2 className="font-bold">How serious is it?</h2>
      <p className="text-xs text-muted">
        Severity starts from the category and switches to the community's median vote after 3 votes.
        More serious issues need fewer votes to validate.
      </p>
      <div className="grid grid-cols-4 gap-1">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            disabled={!user || busy}
            onClick={() => vote(s)}
            className={clsx('rounded-lg border px-1 py-2 text-xs font-semibold',
              issue.my_severity_vote === s ? `${SEVERITY_META[s].tone} border-current` : 'border-line hover:bg-card-hover',
              issue.severity === s && issue.my_severity_vote !== s && 'ring-2 ring-brand/30')}
          >
            {SEVERITY_META[s].label}
          </button>
        ))}
      </div>
      {!user && <p className="text-xs text-muted"><Link to="/login" className="text-brand">Log in</Link> to vote.</p>}
    </section>
  )
}

const EVENT_META: Record<string, { icon: ReactNode; text: string }> = {
  created: { icon: <PlusCircle className="size-4" />, text: 'reported the issue' },
  edited: { icon: <PencilLine className="size-4" />, text: 'edited the report' },
  confirmed: { icon: <Camera className="size-4" />, text: 'confirmed it on-site' },
  validated: { icon: <BadgeCheck className="size-4 text-info" />, text: 'Validated by the community' },
  hidden: { icon: <EyeOff className="size-4 text-danger" />, text: 'Hidden after community flags' },
  emergency_verified: { icon: <Siren className="size-4 text-danger" />, text: 'Verified as an emergency by people on site' },
  emergency_unverified: { icon: <Siren className="size-4 text-muted" />, text: 'Emergency alert hidden as false' },
  emergency_kept: { icon: <Siren className="size-4 text-danger" />, text: 'Emergency evidence checked and kept' },
  recategorized: { icon: <Tags className="size-4 text-info" />, text: 'Category changed' },
  category_kept: { icon: <Tags className="size-4" />, text: 'Admin kept the category' },
  unhidden: { icon: <Eye className="size-4" />, text: 'Visible again' },
  assigned: { icon: <Wrench className="size-4 text-brand" />, text: 'accepted the task' },
  progress: { icon: <Megaphone className="size-4 text-brand" />, text: 'posted progress' },
  released: { icon: <Undo2 className="size-4" />, text: 'released the task' },
  lock_expired: { icon: <Hourglass className="size-4 text-danger" />, text: 'Volunteer lock expired — task back in the pool' },
  resolution_submitted: { icon: <CheckCircle2 className="size-4 text-brand" />, text: 'submitted a fix' },
  resolution_review: { icon: <Flag className="size-4" />, text: 'reviewed the fix' },
  closed: { icon: <CheckCircle2 className="size-4 text-brand" />, text: 'Resolved and closed' },
  reopened: { icon: <RotateCcw className="size-4 text-danger" />, text: 'Reopened — the fix was disputed' },
  expired: { icon: <CircleX className="size-4" />, text: 'Expired without enough support' },
  escalated: { icon: <Building2 className="size-4 text-warn" />, text: 'Sent to the City Corporation' },
  rerouted: { icon: <Scale className="size-4" />, text: 'moved the issue (admin)' },
  escalation_requested: { icon: <Building2 className="size-4 text-warn" />, text: 'said it needs the City Corporation' },
  escalation_rejected: { icon: <Scale className="size-4" />, text: 'kept it with volunteers (admin)' },
  reported_wrong: { icon: <Flag className="size-4 text-danger" />, text: 'said the report is wrong' },
  wrong_report_rejected: { icon: <Scale className="size-4" />, text: 'rejected the "report is wrong" claim (admin)' },
  team_joined: { icon: <UserPlus className="size-4 text-brand" />, text: 'joined the team' },
  team_left: { icon: <LogOut className="size-4" />, text: 'left the team' },
  checked_in: { icon: <MapPin className="size-4 text-brand" />, text: 'checked in at the site' },
  lead_changed: { icon: <Crown className="size-4 text-brand" />, text: 'now leads the team' },
  complaint_ref: { icon: <Hash className="size-4" />, text: 'recorded the complaint reference' },
  send_back_requested: { icon: <Users className="size-4" />, text: 'asked to send it to volunteers' },
  overdue: { icon: <AlarmClock className="size-4 text-danger" />, text: 'The City Corporation is past its target time' },
  assignee_removed: { icon: <UserMinus className="size-4 text-danger" />, text: 'removed an inactive worker (admin)' },
  still_there: { icon: <Eye className="size-4" />, text: 'said it is still there' },
  appealed: { icon: <Scale className="size-4" />, text: 'appealed: says the report is real' },
  appeal_accepted: { icon: <Eye className="size-4 text-brand" />, text: 'restored the report after an appeal (admin)' },
  appeal_rejected: { icon: <EyeOff className="size-4" />, text: 'kept the report hidden after an appeal (admin)' },
  referred: { icon: <Building2 className="size-4 text-warn" />, text: 'referred it to another authority (admin)' },
}

function eventDetail(e: IssueEvent) {
  if (e.type === 'resolution_review') return e.data.is_fixed ? 'Said: fixed ✓' : 'Said: not fixed ✗'
  if (e.type === 'referred') return `${e.data.from ?? '—'} → ${e.data.to}${e.note ? ` · ${e.note}` : ''}`
  if (e.type === 'escalated' && e.data.authority) return `${e.data.authority}${e.note ? ` · ${e.note}` : ''}`
  if (e.type === 'closed') {
    const reason = String(e.data.reason ?? '')
    return {
      reporter_confirmed: 'The reporter confirmed the fix.',
      community_confirmed: 'Neighbours confirmed the fix.',
      auto_closed: 'Closed automatically — nobody disputed the fix.',
      confirmed_gone: 'Neighbours confirmed the problem is gone (fixed outside the app). Nobody earned reputation.',
      admin_already_fixed: `Closed after a volunteer showed it was already fixed. ${e.note ?? ''}`,
    }[reason] ?? null
  }
  return e.note
}

function Timeline({ issue }: { issue: Issue }) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['events', issue.id],
    queryFn: () => getIssueEvents(issue.id),
  })
  if (isLoading) return <PageSpinner />
  return (
    <ol className="relative space-y-4 border-l-2 border-line pl-6">
      {events.map((e) => {
        const meta = EVENT_META[e.type] ?? { icon: <PlusCircle className="size-4" />, text: e.type }
        const hasActor = Boolean(e.actor_id)
        const detail = eventDetail(e)
        return (
          <li key={e.id} className="relative">
            <span className="absolute -left-[35px] grid size-7 place-items-center rounded-full border-2 border-card bg-bg text-muted">
              {meta.icon}
            </span>
            <div className="flex flex-wrap items-center gap-x-1.5 text-sm">
              {hasActor ? (
                <>
                  <Avatar url={e.actor_avatar_url} name={displayName(e.actor_full_name, e.actor_username)} size={20} />
                  <Link to={`/u/${e.actor_username}`} className="font-semibold hover:underline">
                    {displayName(e.actor_full_name, e.actor_username)}
                  </Link>
                  {e.actor_official_of && <span className="chip bg-warn-soft px-1.5 text-[10px] text-warn">{e.actor_official_of} Official ✓</span>}
                  {e.actor_is_admin && <span className="chip bg-card-hover px-1.5 text-[10px] text-muted">Admin</span>}
                  <span>{meta.text}</span>
                </>
              ) : (
                <span className={clsx(e.type === 'created' || e.type === 'resolution_review' ? '' : 'font-semibold')}>
                  {e.type === 'created' ? 'Anonymous citizen reported the issue'
                    : e.type === 'resolution_review' ? 'The reporter reviewed the fix' : meta.text}
                </span>
              )}
              <span className="text-xs text-muted">· {timeAgo(e.created_at)}</span>
            </div>
            {detail && <p className="mt-1 whitespace-pre-line text-sm text-muted">{detail}</p>}
            {e.media.length > 0 && (
              <div className="mt-2 max-w-sm overflow-hidden rounded-lg"><MediaGallery items={e.media} /></div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Evidence({ issueId }: { issueId: string }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['media', issueId], queryFn: () => getIssueMedia(issueId) })
  if (isLoading) return <PageSpinner />
  const groups: { kind: MediaItem['kind']; title: string }[] = [
    { kind: 'report', title: 'Original report' },
    { kind: 'confirmation', title: 'On-site confirmations' },
    { kind: 'progress', title: 'Progress' },
    { kind: 'resolution', title: 'After the fix' },
  ]
  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const items: MediaItem[] = data
          .filter((m) => m.kind === g.kind)
          .map((m) => ({ id: m.id, kind: m.kind, media_type: m.media_type, path: m.storage_path }))
        if (!items.length) return null
        return (
          <section key={g.kind}>
            <h3 className="mb-2 text-sm font-semibold">{g.title} ({items.length})</h3>
            <div className="overflow-hidden rounded-lg"><MediaGallery items={items} /></div>
          </section>
        )
      })}
    </div>
  )
}
