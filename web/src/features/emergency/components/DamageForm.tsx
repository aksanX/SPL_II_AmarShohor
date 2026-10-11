import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MediaPicker } from '@/features/media/components/MediaPicker'
import { Spinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useCategories } from '@/features/categories/hooks/useCategories'
import { useToast } from '@/shared/hooks/useToast'
import { emergencyService } from '@/features/emergency/services/emergency.service'
import { isNetworkError } from '@/features/media/lib/mediaRules'
import { mediaService } from '@/features/media/services/media.service'
import type { EmergencyAlert } from '@/models'
import { emergencyLabel } from '@/features/emergency/components/emergencyKinds'

/** The damage an emergency left behind, logged by an official: goes straight to their City Corporation. */
export function DamageForm({ a, onCancel }: { a: EmergencyAlert; onCancel: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const categories = (useCategories().data ?? []).filter((c) => c.is_active)
  const [title, setTitle] = useState(`Damage after the ${emergencyLabel(a.kind).toLowerCase()}${a.address ? ` near ${a.address}` : ''}`.slice(0, 120))
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!user) return
    setBusy(true)
    try {
      const media = await mediaService.uploadMedia(user.id, files)
      const id = await emergencyService.officialLogDamage(a.id, { title, category, description, size: null }, media)
      toast.success('Logged. It is in your New list.')
      navigate(`/issue/${id}`)
    } catch (e) {
      if (!isNetworkError(e)) await mediaService.discardUploads(files)
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 border-t border-warn/40 pt-2">
      <p className="text-sm font-semibold">Log the damage</p>
      <p className="text-xs text-muted">
        Residents confirmed the emergency, so this skips validation and goes straight to the {a.authority_short_name ?? 'City Corporation'} New list.
      </p>
      <input className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
        <option value="">What was damaged?</option>
        {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
      </select>
      <textarea className="input" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)}
        placeholder="Details (optional)" aria-label="Details" />
      <MediaPicker files={files} onChange={setFiles} required imagesOnly />
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-primary" disabled={busy || title.trim().length < 5 || !category || !files.length} onClick={submit}>
          {busy && <Spinner className="size-4 text-brand-ink" />} Log for repair
        </button>
        <button className="btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
