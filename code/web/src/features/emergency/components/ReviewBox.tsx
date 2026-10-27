import { useQueryClient } from '@tanstack/react-query'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/shared/hooks/useToast'
import { emergencyService } from '@/features/emergency/services/emergency.service'

/** Admins and the area's officials: look at the live evidence of a verified alert, keep or reject it. */
export function ReviewBox({ alertId, onDone }: { alertId: string; onDone: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function decide(keep: boolean) {
    setBusy(true)
    try {
      await emergencyService.reviewEmergency(alertId, keep, reason)
      toast.success(keep ? 'Kept. The emergency stands.' : 'Rejected. The alert is hidden and the issue goes back to normal.')
      qc.invalidateQueries({ queryKey: ['emergency_reviews'] })
      onDone()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-warn bg-warn-soft p-3">
      <p className="text-sm font-semibold">Check the evidence</p>
      <p className="text-xs text-muted">
        People on site verified this. Look at the live photos below: do they show this emergency at this place?
        Rejecting hides it, removes the issue's critical severity and costs the reporter and confirmers reputation.
      </p>
      <textarea className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (needed to reject)" aria-label="Review note" />
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-primary" disabled={busy} onClick={() => decide(true)}><ThumbsUp className="size-4" /> Keep</button>
        <button className="btn-danger" disabled={busy || reason.trim().length < 5} onClick={() => decide(false)}>
          <ThumbsDown className="size-4" /> Reject
        </button>
      </div>
    </div>
  )
}
