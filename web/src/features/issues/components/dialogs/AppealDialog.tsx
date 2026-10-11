import { useState } from 'react'
import type { Issue } from '@/models'
import { useToast } from '@/shared/hooks/useToast'
import { Modal, Spinner } from '@/shared/ui'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { issueService } from '@/features/issues/services/issue.service'

/** The reporter of a hidden report asks an admin to look again. Once per report. */
export function AppealDialog({ issue, open, onClose }: { issue: Issue; open: boolean; onClose: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const invalidate = useInvalidateIssue()

  async function submit() {
    setBusy(true)
    try {
      await issueService.appealHiddenIssue(issue.id, note)
      toast.success('Appeal sent. An admin will check it and you will be notified.')
      invalidate(issue.id)
      onClose()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Appeal: my report is real">
      <div className="space-y-3">
        <p className="text-sm text-muted">
          An admin will look at your photos and the flags. If they agree, your report comes back and you get your
          reputation back. You can appeal each report once.
        </p>
        <textarea className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Why is it real? e.g. The bin is behind the clinic wall, not in front" aria-label="Why is it real?" />
        <button className="btn-primary w-full" disabled={busy || note.trim().length < 10} onClick={submit}>
          {busy && <Spinner className="size-4 text-brand-ink" />} Send appeal
        </button>
      </div>
    </Modal>
  )
}
