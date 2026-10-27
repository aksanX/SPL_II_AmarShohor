import { useState } from 'react'
import type { FlagReason, Issue } from '@/models'
import { useToast } from '@/shared/hooks/useToast'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { Modal, Spinner } from '@/shared/ui'
import { CategorySelect } from '@/features/categories/components/CategorySelect'
import { EmergencyHint } from '@/features/issues/components/dialogs/EmergencyHint'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { issueService } from '@/features/issues/services/issue.service'

// Not a flag_reason in the database: a correction, so it never counts towards hiding the report.
type ReportReason = FlagReason | 'wrong_category'

const FLAG_REASONS: { value: ReportReason; label: string; help: string }[] = [
  { value: 'wrong_category', label: 'Wrong category / photo doesn’t match', help: 'The problem is real but it’s a different kind (e.g. listed as a pothole, the photo shows a fire).' },
  { value: 'fake_or_scam', label: 'Fake or scam', help: 'This problem does not exist or the photo is not real.' },
  { value: 'wrong_location', label: 'Wrong location', help: 'The pin is not where the problem is.' },
  { value: 'duplicate', label: 'Duplicate', help: 'Someone already reported this exact problem.' },
  { value: 'already_fixed', label: 'Already fixed', help: 'The problem is gone.' },
  { value: 'spam', label: 'Spam / advertising', help: 'Not a civic issue at all.' },
  { value: 'inappropriate', label: 'Inappropriate', help: 'Offensive content or shows private people.' },
]

export function FlagDialog({ issue, open, onClose }: { issue: Issue; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>('fake_or_scam')
  const [actual, setActual] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const settings = useAppSettings().data

  async function submit() {
    setBusy(true)
    try {
      if (reason === 'wrong_category') {
        await issueService.suggestCategory(issue.id, actual, details)
        toast.success(`Thanks. When ${settings?.recategorize_votes ?? 3} people agree, the category changes.`)
      } else {
        await issueService.flagIssue(issue.id, reason, details)
        toast.success('Flag recorded. Reports are hidden automatically when flags outweigh support.')
      }
      invalidate(issue.id)
      onClose()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Report this post">
      <div className="space-y-3">
        <p className="text-sm text-muted">
          The community decides. A post is hidden when at least {settings?.hide_min_flags ?? 5} people flag it{' '}
          <em>and</em> flags outweigh support; the reporter then loses reputation and can appeal. The reporter won't see
          who flagged. Flag honestly: if your "fake" flags keep landing on issues that turn out to be real, your flags
          count for less.
        </p>
        <div className="space-y-2">
          {FLAG_REASONS.map((r) => (
            <label key={r.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:bg-card-hover">
              <input type="radio" name="reason" className="mt-1 accent-[var(--brand)]" checked={reason === r.value}
                onChange={() => setReason(r.value)} />
              <span>
                <span className="block text-sm font-semibold">{r.label}</span>
                <span className="block text-xs text-muted">{r.help}</span>
              </span>
            </label>
          ))}
        </div>
        {reason === 'wrong_category' && (
          <>
            <CategorySelect value={actual} onChange={setActual} exclude={issue.category} />
            <EmergencyHint issueId={issue.id} category={actual} />
          </>
        )}
        <textarea className="input" rows={2} maxLength={500} placeholder="Details (optional)" value={details}
          onChange={(e) => setDetails(e.target.value)} aria-label="Details (optional)" />
        <button className="btn-danger w-full" disabled={busy || (reason === 'wrong_category' && !actual)} onClick={submit}>
          {busy && <Spinner className="size-4 text-white" />} Submit report
        </button>
      </div>
    </Modal>
  )
}
