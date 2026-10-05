import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleHelp, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { answerStillThere, getStillThere } from '../lib/api'
import { getCurrentPosition, getLastKnownPosition } from '../lib/geo'
import type { Issue } from '../lib/types'
import { useInvalidateIssue } from './IssueDialogs'
import { Spinner } from './ui'

/**
 * "Is this still there?" Problems are often fixed outside the app (the city's crew comes by).
 * When an open issue has been quiet for a while, neighbours are asked; enough "gone" answers close it,
 * so the heatmap doesn't stay red for problems that no longer exist.
 */
export function StillThereBox({ issue }: { issue: Issue }) {
  const { user } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const invalidate = useInvalidateIssue()
  const [busy, setBusy] = useState(false)
  const { data: s } = useQuery({
    queryKey: ['still-there', issue.id],
    queryFn: () => getStillThere(issue.id),
    enabled: Boolean(user),
  })

  // Only when the check is running, and not for the person responsible for the fix.
  if (!user || !s?.checkable || !s.asked_at || issue.volunteer_id === user.id) return null

  async function answer(stillThere: boolean) {
    setBusy(true)
    try {
      let pos = getLastKnownPosition()
      if (!pos && !issue.is_mine && !issue.my_following && !issue.my_confirmed) {
        pos = await getCurrentPosition().catch(() => null)
      }
      const result = await answerStillThere(issue.id, stillThere, pos?.lat, pos?.lng)
      toast.success(
        result === 'closed' ? 'Thanks! Enough neighbours say it’s gone, so the issue is closed.'
          : result === 'still_there' ? 'Thanks! The issue stays open and on the map.'
            : 'Thanks! Waiting for one more neighbour to confirm it’s gone.',
      )
      qc.invalidateQueries({ queryKey: ['still-there', issue.id] })
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-3 border-2 border-warn/40 p-4">
      <h2 className="flex items-center gap-2 font-bold">
        <CircleHelp className="size-5 text-warn" /> Is this still there?
      </h2>
      <p className="text-sm text-muted">
        Nothing has happened here for {s.quiet_days} days. If the problem is gone, tell us so it comes off the map.
        It closes when {s.quorum} people say it’s gone.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-soft" disabled={busy} onClick={() => answer(true)}>
          {busy ? <Spinner className="size-4" /> : <ThumbsUp className="size-4" />} Still there
        </button>
        <button className="btn-primary" disabled={busy} onClick={() => answer(false)}>
          <ThumbsDown className="size-4" /> It’s gone
        </button>
      </div>
      <p className="text-xs text-muted">
        So far: {s.gone} gone · {s.still} still there
        {s.my_answer !== null && ` · you said ${s.my_answer ? 'still there' : 'gone'} (you can change it)`}
      </p>
    </section>
  )
}
