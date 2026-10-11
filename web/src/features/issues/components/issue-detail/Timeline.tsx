import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlarmClock, BadgeCheck, Building2, Camera, CheckCircle2, CircleX, Crown, Eye, EyeOff, Flag, Hash, Hourglass, LogOut, MapPin, Megaphone, PencilLine, PlusCircle, RotateCcw, Scale, Siren, Tags, Undo2, UserMinus, UserPlus, Users, Wrench } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Issue, IssueEvent } from '@/models'
import { displayName, timeAgo } from '@/shared/lib/format'
import { Avatar, PageSpinner } from '@/shared/ui'
import { issueService } from '@/features/issues/services/issue.service'
import { MediaGallery } from '@/features/media/components/MediaGallery'

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
  team_requested: { icon: <Users className="size-4 text-brand" />, text: 'asked nearby volunteers for help' },
  team_closed: { icon: <Users className="size-4" />, text: 'has enough people now' },
  team_removed: { icon: <UserMinus className="size-4" />, text: "removed a team member who didn't come" },
  team_left: { icon: <LogOut className="size-4" />, text: 'left the team' },
  checked_in: { icon: <MapPin className="size-4 text-brand" />, text: 'checked in at the site' },
  lead_changed: { icon: <Crown className="size-4 text-brand" />, text: 'now leads the team' },
  complaint_ref: { icon: <Hash className="size-4" />, text: 'recorded the complaint reference' },
  send_back_requested: { icon: <Users className="size-4" />, text: 'asked to send it to volunteers' },
  send_back_rejected: { icon: <Scale className="size-4" />, text: 'kept it with the City Corporation (admin)' },
  review_dismissed: { icon: <Scale className="size-4" />, text: 'looked at it and left it as it is (admin)' },
  overdue: { icon: <AlarmClock className="size-4 text-danger" />, text: 'The City Corporation is past its target time' },
  assignee_removed: { icon: <UserMinus className="size-4 text-danger" />, text: 'removed an inactive worker (admin)' },
  still_there: { icon: <Eye className="size-4" />, text: 'said it is still there' },
  appealed: { icon: <Scale className="size-4" />, text: 'appealed: says the report is real' },
  appeal_accepted: { icon: <Eye className="size-4 text-brand" />, text: 'restored the report after an appeal (admin)' },
  appeal_rejected: { icon: <EyeOff className="size-4" />, text: 'kept the report hidden after an appeal (admin)' },
  referred: { icon: <Building2 className="size-4 text-warn" />, text: 'referred it to another authority (admin)' },
}

/** "moved the issue" says where to: volunteers, the City Corporation, or only a new category. */
function eventText(e: IssueEvent, text: string) {
  if (e.type === 'escalated') return 'sent the issue to the City Corporation'
  if (e.type !== 'rerouted') return text
  if (e.data.from === e.data.to && e.data.category) return 'changed the category (admin)'
  if (e.data.to === 'community') return 'routed the issue to volunteers (admin)'
  if (e.data.to === 'authority') return 'routed the issue to the City Corporation (admin)'
  return text
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

export function Timeline({ issue }: { issue: Issue }) {
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['events', issue.id],
    queryFn: () => issueService.getIssueEvents(issue.id),
  })
  if (isLoading) return <PageSpinner />
  // An admin sending it to the City Corporation logs both 'escalated' (which one) and 'rerouted', in one go:
  // show it once, as 'escalated'.
  const escalatedBy = new Set(events.filter((e) => e.type === 'escalated' && e.actor_id).map((e) => `${e.actor_id}@${e.created_at}`))
  const shown = events.filter((e) => !(e.type === 'rerouted' && e.data.to === 'authority' && escalatedBy.has(`${e.actor_id}@${e.created_at}`)))
  return (
    <ol className="relative space-y-4 border-l-2 border-line pl-6">
      {shown.map((e) => {
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
                  {e.actor_city_admin_of && <span className="chip bg-card-hover px-1.5 text-[10px] text-muted">{e.actor_city_admin_of} Admin</span>}
                  <span>{eventText(e, meta.text)}</span>
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
