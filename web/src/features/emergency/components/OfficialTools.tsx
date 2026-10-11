import { Megaphone, Wrench, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '@/shared/hooks/useToast'
import { emergencyService } from '@/features/emergency/services/emergency.service'
import type { EmergencyAlert } from '@/models'
import { DamageForm } from '@/features/emergency/components/DamageForm'

/** Officials of the area: tell residents what is being done, end the alert, log the damage for repair. */
export function OfficialTools({ a, onDone }: { a: EmergencyAlert; onDone: () => void }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [logging, setLogging] = useState(false)

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true)
    try {
      await action()
      toast.success(ok)
      setNote('')
      onDone()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-warn bg-warn-soft p-3">
      <p className="text-sm font-semibold">{a.authority_short_name ?? 'City Corporation'} official</p>
      <p className="text-xs text-muted">Residents on site confirm what they see. You tell them what the City Corporation is doing.</p>
      {a.can_update && (
        <>
          <textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Fire Service on scene, Gulshan Avenue closed" aria-label="Update for residents" />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary" disabled={busy || note.trim().length < 3}
              onClick={() => run(() => emergencyService.postAlertUpdate(a.id, note), 'Update posted. People following the alert were told.')}>
              <Megaphone className="size-4" /> Post update
            </button>
            {a.can_end && (
              <button className="btn-soft" disabled={busy || note.trim().length < 3} title="Uses the note as the reason"
                onClick={() => run(() => emergencyService.officialEndAlert(a.id, note), 'The alert is over.')}>
                <CheckCircle2 className="size-4" /> It's over
              </button>
            )}
          </div>
        </>
      )}
      {a.can_log_damage && (logging
        ? <DamageForm a={a} onCancel={() => setLogging(false)} />
        : (
          <button className="btn-soft w-full" onClick={() => setLogging(true)}>
            <Wrench className="size-4" /> Log the damage for repair
          </button>
        ))}
    </div>
  )
}
