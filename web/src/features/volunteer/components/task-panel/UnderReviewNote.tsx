import { useQuery } from '@tanstack/react-query'
import { Scale } from 'lucide-react'
import type { Issue } from '@/models'
import { issueService } from '@/features/issues/services/issue.service'
import { Note } from '@/features/volunteer/components/task-panel/Note'

const REVIEW_REQUESTS = ['send_back_requested', 'escalation_requested', 'reported_wrong']

/** Says who asked the admin for what, from the latest request on the timeline. */
export function UnderReviewNote({ issue }: { issue: Issue }) {
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
