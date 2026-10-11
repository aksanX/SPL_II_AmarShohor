import { Building2, Hourglass, Scale, Wrench } from 'lucide-react'
import type { Issue } from '@/models'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { AcceptTask } from '@/features/volunteer/components/task-panel/AcceptTask'
import { AskForMembers } from '@/features/volunteer/components/task-panel/AskForMembers'
import { Closed } from '@/features/volunteer/components/task-panel/Closed'
import { MyActiveTask } from '@/features/volunteer/components/task-panel/MyActiveTask'
import { Note } from '@/features/volunteer/components/task-panel/Note'
import { OfficialAccept } from '@/features/volunteer/components/task-panel/OfficialAccept'
import { ResolutionReview } from '@/features/volunteer/components/task-panel/ResolutionReview'
import { RouteInfo } from '@/features/volunteer/components/task-panel/RouteInfo'
import { TeamPanel } from '@/features/volunteer/components/task-panel/TeamPanel'
import { UnderReviewNote } from '@/features/volunteer/components/task-panel/UnderReviewNote'
import { WorkingOnIt } from '@/features/volunteer/components/task-panel/WorkingOnIt'

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

