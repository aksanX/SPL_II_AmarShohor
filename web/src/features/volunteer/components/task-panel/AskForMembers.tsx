import { CheckCircle2, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { useToast } from '@/shared/hooks/useToast'
import { volunteerService } from '@/features/volunteer/services/volunteer.service'
import { plural } from '@/features/volunteer/lib/volunteer'
import type { Issue } from '@/models'
import { useInvalidateIssue } from '@/features/issues/components/IssueDialogs'
import { Spinner } from '@/shared/ui'

/**
 * Too big to do alone: the volunteer leading the task asks nearby volunteers to join (0066), and closes the
 * open spots once there are enough people. Anyone working on a task may ask.
 */
export function AskForMembers({ issue }: { issue: Issue }) {
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [busy, setBusy] = useState(false)
  const maxSize = settings?.team_max_size ?? 10
  const people = issue.team_count + 1
  const recruiting = issue.team_size > people

  async function run(action: () => Promise<unknown>, ok: (r: unknown) => string) {
    setBusy(true)
    try {
      const r = await action()
      toast.success(ok(r))
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  if (recruiting) {
    return (
      <div className="space-y-2 rounded-lg bg-bg p-3 text-sm">
        <p className="flex items-start gap-2">
          <UserPlus className="mt-0.5 size-4 shrink-0 text-brand" />
          <span>Nearby volunteers can join your team ({people} of up to {maxSize} so far). Plan the work day with them in the discussion below.</span>
        </p>
        <button className="btn-ghost w-full text-xs" disabled={busy}
          onClick={() => run(() => volunteerService.closeTeamRecruiting(issue.id), () => 'Nobody else can join now.')}>
          <CheckCircle2 className="size-3.5" /> We have enough people
        </button>
      </div>
    )
  }
  if (people >= maxSize) return null
  return (
    <button className="btn-soft w-full" disabled={busy}
      onClick={() => run(() => volunteerService.askForVolunteers(issue.id), (n) => n
        ? `Asked ${plural(Number(n), 'nearby volunteer')} to join your team.`
        : 'Your task is open for a team, but no volunteer lives nearby yet. Others can still find it on the Volunteer page.')}>
      {busy ? <Spinner className="size-4" /> : <UserPlus className="size-4" />}
      {people > 1 ? 'Ask for more volunteers' : 'Too big alone? Ask for more volunteers'}
    </button>
  )
}
