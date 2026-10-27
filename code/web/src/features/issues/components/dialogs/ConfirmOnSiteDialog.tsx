import clsx from 'clsx'
import { Camera } from 'lucide-react'
import { useState } from 'react'
import type { Issue } from '@/models'
import { useToast } from '@/shared/hooks/useToast'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { Modal, Spinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { CategorySelect } from '@/features/categories/components/CategorySelect'
import { EmergencyHint } from '@/features/issues/components/dialogs/EmergencyHint'
import { LocationStatus } from '@/features/issues/components/dialogs/LocationStatus'
import { useOnSiteEvidence } from '@/features/issues/components/OnSiteEvidence'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { useOnSiteLocation } from '@/features/issues/hooks/useOnSiteLocation'
import { issueService } from '@/features/issues/services/issue.service'
import { isNetworkError } from '@/features/media/lib/mediaRules'

/** "I see this too": on-site confirmation with a photo. */
export function ConfirmOnSiteDialog({ issue, open, onClose }: { issue: Issue; open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const settings = useAppSettings().data
  const radius = settings?.confirm_radius_m ?? 200
  const loc = useOnSiteLocation(issue)
  const evidence = useOnSiteEvidence()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // "Is this a <category>?" — null until answered; false = it's something else.
  const [rightCategory, setRightCategory] = useState<boolean | null>(issue.category ? null : true)
  const [actual, setActual] = useState('')
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const categoryAnswered = rightCategory === true || (rightCategory === false && actual !== '')

  async function submit() {
    if (!user || !loc.pos || !categoryAnswered) return
    setBusy(true)
    try {
      const media = await evidence.upload(user.id)
      await issueService.confirmIssue(issue.id, loc.pos.lat, loc.pos.lng, loc.pos.accuracy, note, media, rightCategory ? null : actual)
      toast.success(rightCategory
        ? 'Thanks! Your on-site confirmation counts double.'
        : 'Thanks! Counted as support, and as a vote for the right category.')
      invalidate(issue.id)
      evidence.reset()
      setNote('')
      onClose()
    } catch (e) {
      // Refused (not a lost connection): the photos won't be used, don't leave them in Storage.
      if (!isNetworkError(e)) await evidence.discard()
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  // Closed without sending: live photos can't be used later (their codes expire), so delete them now.
  function close() {
    if (busy) return
    evidence.discard()
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title="I see this too">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Standing at the problem right now? Confirm it with a fresh photo. An on-site confirmation counts
          double toward validation, and replaces your upvote.
        </p>
        <LocationStatus loc={loc} radius={radius} />
        <div>
          <span className="label">Photo from the spot</span>
          {evidence.picker}
        </div>
        {issue.category && (
          <div className="space-y-2">
            <span className="label">Is this a “{issue.category_name}”?</span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Is the category right?">
              {([true, false] as const).map((v) => (
                <button key={String(v)} type="button" role="radio" aria-checked={rightCategory === v}
                  onClick={() => setRightCategory(v)}
                  className={clsx('rounded-lg border p-2 text-sm',
                    rightCategory === v ? 'border-brand bg-brand-soft font-semibold' : 'border-line hover:bg-card-hover')}>
                  {v ? 'Yes, that’s it' : 'No, it’s something else'}
                </button>
              ))}
            </div>
            {rightCategory === false && (
              <>
                <CategorySelect value={actual} onChange={setActual} exclude={issue.category} />
                <EmergencyHint issueId={issue.id} category={actual} />
              </>
            )}
          </div>
        )}
        <div>
          <label className="label" htmlFor="confirm-note">Anything to add? (optional)</label>
          <textarea id="confirm-note" className="input" rows={2} maxLength={500} value={note}
            onChange={(e) => setNote(e.target.value)} placeholder="e.g. It got worse after last night's rain" />
        </div>
        <button className="btn-primary w-full" disabled={busy || !loc.pos || !evidence.ready || !categoryAnswered} onClick={submit}>
          {busy ? <Spinner className="size-4 text-brand-ink" /> : <Camera className="size-4" />}
          Confirm on-site
        </button>
      </div>
    </Modal>
  )
}
