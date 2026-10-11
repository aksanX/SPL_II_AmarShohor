import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { useToast } from '@/shared/hooks/useToast'
import { issueService } from '@/features/issues/services/issue.service'
import { volunteerService } from '@/features/volunteer/services/volunteer.service'
import { displayName, timeAgo } from '@/shared/lib/format'
import { locationService } from '@/shared/geo/location.service'
import type { Issue, MediaItem } from '@/models'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { MediaGallery } from '@/features/media/components/MediaGallery'
import { Note } from '@/features/volunteer/components/task-panel/Note'

export function ResolutionReview({ issue, cannotReview }: { issue: Issue; cannotReview: boolean }) {
  const { user } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [busy, setBusy] = useState(false)
  const media = useQuery({ queryKey: ['media', issue.id], queryFn: () => issueService.getIssueMedia(issue.id) }).data ?? []
  const after: MediaItem[] = media
    .filter((m) => m.kind === 'resolution')
    .map((m) => ({ id: m.id, kind: m.kind, media_type: m.media_type, path: m.storage_path }))
  const who = issue.assignee_role === 'official'
    ? `${displayName(issue.volunteer_full_name, issue.volunteer_username)} (${issue.authority_short_name})`
    : displayName(issue.volunteer_full_name, issue.volunteer_username)

  async function review(fixed: boolean) {
    setBusy(true)
    try {
      let pos = locationService.getLastKnownPosition()
      if (!issue.is_mine && !issue.my_confirmed && !pos) {
        pos = await locationService.getCurrentPosition().catch(() => null)
      }
      const status = await volunteerService.reviewResolution(issue.id, fixed, pos?.lat, pos?.lng)
      toast.success(
        status === 'closed' ? 'Issue closed. Thank you!'
          : status === 'validated' ? 'Issue reopened for another volunteer.'
            : status === 'escalated' ? 'Issue sent back to the City Corporation.'
              : 'Your vote is recorded. Waiting for more neighbours.',
      )
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  const autoClose = settings?.auto_close_days ?? 7
  return (
    <div className="space-y-3">
      <Note icon={<CheckCircle2 className="size-5 text-brand" />} tone="brand">
        <strong>{who}</strong> says it's fixed
        {issue.resolution_submitted_at ? ` (${timeAgo(issue.resolution_submitted_at)})` : ''}:
        <p className="mt-1 whitespace-pre-line">{issue.resolution_note}</p>
      </Note>
      {after.length > 0 && <div className="overflow-hidden rounded-lg"><MediaGallery items={after} /></div>}
      {after.length === 0 && issue.assignee_role === 'official' && (
        <p className="text-sm text-muted">No "after" photo was added. If you're nearby, check whether it's gone or still there.</p>
      )}

      {cannotReview ? (
        <p className="text-sm text-muted">
          Waiting for the reporter or {settings?.resolution_quorum ?? 2} neighbours to confirm. It closes automatically after{' '}
          {autoClose} days if nobody disputes it.
        </p>
      ) : !user ? (
        <p className="text-sm"><Link to="/login" className="font-semibold text-brand">Log in</Link> to confirm the fix.</p>
      ) : (
        <>
          <p className="text-sm font-semibold">
            {issue.is_mine ? 'You reported this. Is it really fixed?' : 'Live nearby? Is it really fixed?'}
          </p>
          {issue.my_resolution_review !== null && (
            <p className="text-sm text-muted">You answered: {issue.my_resolution_review ? 'fixed' : 'not fixed'}. You can change it.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => review(true)}>
              <ThumbsUp className="size-4" /> Yes, it's fixed
            </button>
            <button className="btn-danger" disabled={busy} onClick={() => review(false)}>
              <ThumbsDown className="size-4" /> No, still there
            </button>
          </div>
          <p className="text-xs text-muted">
            {issue.is_mine
              ? 'As the reporter, "fixed" closes it right away. "Not fixed" reopens it alone only once; after that, neighbours must agree.'
              : `Needs ${settings?.resolution_quorum ?? 2} neighbours agreeing (within ${((settings?.reviewer_radius_m ?? 3000) / 1000).toFixed(0)} km or who confirmed it on-site). Auto-closes after ${autoClose} days if undisputed.`}
          </p>
        </>
      )}
    </div>
  )
}
