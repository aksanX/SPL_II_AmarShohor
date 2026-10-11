import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/shared/hooks/useToast'
import { emergencyService } from '@/features/emergency/services/emergency.service'

/** Admins: remove an obvious fake before anyone verifies it. Verified alerts go through the evidence check. */
export function AdminRemove({ alertId, onDone }: { alertId: string; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    try {
      await emergencyService.adminHideAlert(alertId, reason)
      toast.success('Removed. The reporter lost reputation and was told why.')
      onDone()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-danger/40 bg-danger-soft p-3">
      <p className="text-sm font-semibold">Admin: obvious fake?</p>
      <p className="text-xs text-muted">
        Only for clear spam or pranks. Real but unverified alerts should stay up: residents nearby confirm or deny them.
      </p>
      <input className="input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (shown on the alert), e.g. the photo is from the internet" aria-label="Reason" />
      <button className="btn-danger w-full" disabled={busy || reason.trim().length < 5} onClick={remove}>
        <Trash2 className="size-4" /> Remove as fake
      </button>
    </div>
  )
}
