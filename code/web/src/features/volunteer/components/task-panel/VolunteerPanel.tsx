import type { Issue } from '@/models'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { AcceptTask } from '@/features/volunteer/components/task-panel/AcceptTask'
import { AskForMembers } from '@/features/volunteer/components/task-panel/AskForMembers'
import { Closed } from '@/features/volunteer/components/task-panel/Closed'
import { MyActiveTask } from '@/features/volunteer/components/task-panel/MyActiveTask'
import { OfficialAccept } from '@/features/volunteer/components/task-panel/OfficialAccept'
import { ResolutionReview } from '@/features/volunteer/components/task-panel/ResolutionReview'
import { TeamPanel } from '@/features/volunteer/components/task-panel/TeamPanel'
import { WorkingOnIt } from '@/features/volunteer/components/task-panel/WorkingOnIt'

/** Everything about getting an issue fixed: accept → progress → fix → confirm → rate. Hidden when there is nothing to do or show. */
export function VolunteerPanel({ issue }: { issue: Issue }) {
  const { user, profile, role } = useAuth()
  const isOnTask = Boolean(user) && issue.volunteer_id === user?.id
  const active = ['assigned', 'in_progress'].includes(issue.status)
  const canTake = issue.status === 'validated' && issue.route === 'community' && (!user || (!issue.is_mine && role === 'citizen'))
  const officialCanTake = issue.status === 'escalated' && Boolean(issue.authority_id) && issue.i_am_official_here
  if (!canTake && !officialCanTake && !active && !['resolution_submitted', 'closed'].includes(issue.status)) return null

  return (
    <section className="card space-y-3 p-4">
      {canTake && <AcceptTask issue={issue} isVolunteer={Boolean(profile?.is_volunteer)} />}
      {officialCanTake && <OfficialAccept issue={issue} />}

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
