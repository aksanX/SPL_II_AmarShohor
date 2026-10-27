import { Hourglass, HandHelping } from 'lucide-react'
import { useState } from 'react'
import type { Issue } from '@/models'
import { useToast } from '@/shared/hooks/useToast'
import { Spinner } from '@/shared/ui'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { Note } from '@/features/volunteer/components/task-panel/Note'
import { volunteerService } from '@/features/volunteer/services/volunteer.service'

export function OfficialAccept({ issue }: { issue: Issue }) {
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [busy, setBusy] = useState(false)
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
      await volunteerService.acceptTask(issue.id)
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
    </div>
  )
}
