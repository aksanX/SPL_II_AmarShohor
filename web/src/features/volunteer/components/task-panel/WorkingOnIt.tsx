import { Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { displayName, timeAgo } from '@/shared/lib/format'
import { lockNote } from '@/features/volunteer/lib/volunteer'
import type { Issue } from '@/models'
import { Note } from '@/features/volunteer/components/task-panel/Note'

export function WorkingOnIt({ issue }: { issue: Issue }) {
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
