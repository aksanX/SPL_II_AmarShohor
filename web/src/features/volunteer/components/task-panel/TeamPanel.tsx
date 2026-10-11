import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Crown, LogOut, MapPin, Users } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Issue } from '@/models'
import { useToast } from '@/shared/hooks/useToast'
import { displayName, timeAgo } from '@/shared/lib/format'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { Avatar } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { LocationStatus } from '@/features/issues/components/dialogs/LocationStatus'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { useOnSiteLocation } from '@/features/issues/hooks/useOnSiteLocation'
import { Note } from '@/features/volunteer/components/task-panel/Note'
import { teamService } from '@/features/volunteer/services/team.service'
import { volunteerService } from '@/features/volunteer/services/volunteer.service'

export function TeamPanel({ issue }: { issue: Issue }) {
  const { user, profile } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [busy, setBusy] = useState(false)
  const loc = useOnSiteLocation(issue)
  const team = useQuery({ queryKey: ['team', issue.id], queryFn: () => teamService.getTeam(issue.id) }).data ?? []
  const isLeader = user?.id === issue.volunteer_id
  const [handingTo, setHandingTo] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
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
            {isLeader && !m.is_leader && handingTo !== m.user_id && removing !== m.user_id && (
              <>
                <button className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => setHandingTo(m.user_id)}>
                  Hand over
                </button>
                {/* Someone who checked in at the site keeps their place (and reward). */}
                {!m.checked_in_at && (
                  <button className="btn-ghost px-2 py-1 text-xs text-danger" disabled={busy} onClick={() => setRemoving(m.user_id)}>
                    Remove
                  </button>
                )}
              </>
            )}
            {isLeader && removing === m.user_id && (
              <span className="flex items-center gap-1 text-xs">
                Remove from the team?
                <button className="btn-danger px-2 py-1 text-xs" disabled={busy}
                  onClick={() => { setRemoving(null); run(() => volunteerService.removeTeamMember(issue.id, m.user_id), 'Removed. Their spot is open again.') }}>
                  Yes
                </button>
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setRemoving(null)}>No</button>
              </span>
            )}
            {isLeader && handingTo === m.user_id && (
              <span className="flex items-center gap-1 text-xs">
                Make them leader?
                <button className="btn-primary px-2 py-1 text-xs" disabled={busy}
                  onClick={() => { setHandingTo(null); run(() => teamService.offerLead(issue.id, m.user_id), 'Asked them to take over. They need to accept.') }}>
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
            onClick={() => run(() => teamService.acceptLead(issue.id), 'You now lead this task.')}>
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
                onClick={() => run(() => teamService.checkIn(issue.id, loc.pos!.lat, loc.pos!.lng, loc.pos!.accuracy), 'Checked in. Thanks for showing up!')}>
                <MapPin className="size-4" /> I'm here
              </button>
            </>
          )}
          <button className="btn-ghost w-full text-xs" disabled={busy}
            onClick={() => run(() => teamService.leaveTeam(issue.id), 'You left the team.')}>
            <LogOut className="size-3.5" /> Leave the team (no penalty)
          </button>
        </div>
      )}

      {!isLeader && !issue.my_team_member && spots > 0 && user && profile?.is_volunteer && !issue.is_mine && (
        <button className="btn-soft w-full" disabled={busy}
          onClick={() => run(() => teamService.joinTeam(issue.id), 'You joined the team!')}>
          <Users className="size-4" /> Join the team ({spots} {spots === 1 ? 'spot' : 'spots'} left)
        </button>
      )}
    </div>
  )
}
