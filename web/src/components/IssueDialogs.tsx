import { useQueryClient } from '@tanstack/react-query'
import { Camera, LocateFixed, MapPin } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAppSettings, useCategories } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { confirmIssue, deleteIssue, flagIssue, updateIssue } from '../lib/api'
import { distanceM, formatDistance, getCurrentPosition, type Position } from '../lib/geo'
import { deleteFiles, uploadMedia } from '../lib/media'
import type { FlagReason, Issue } from '../lib/types'
import { MediaPicker } from './MediaPicker'
import { Modal, Spinner } from './ui'

export function useInvalidateIssue() {
  const qc = useQueryClient()
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ['feed'] })
    qc.invalidateQueries({ queryKey: ['tasks'] })
    qc.invalidateQueries({ queryKey: ['map'] })
    if (id) {
      qc.invalidateQueries({ queryKey: ['issue', id] })
      qc.invalidateQueries({ queryKey: ['events', id] })
      qc.invalidateQueries({ queryKey: ['media', id] })
    }
  }
}

/** Gets a GPS fix and shows how far the user is from the issue. */
export function useOnSiteLocation(target: { lat: number; lng: number }) {
  const [pos, setPos] = useState<Position | null>(null)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locate = async () => {
    setLocating(true)
    setError(null)
    try {
      setPos(await getCurrentPosition())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLocating(false)
    }
  }
  const distance = pos ? distanceM(pos, target) : null
  return { pos, locating, error, locate, distance }
}

export function LocationStatus({ loc, radius }: { loc: ReturnType<typeof useOnSiteLocation>; radius: number }) {
  const ok = loc.distance !== null && loc.distance <= radius + Math.min(loc.pos?.accuracy ?? 0, 100)
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <MapPin className={ok ? 'size-5 text-brand' : 'size-5 text-muted'} />
          {loc.distance === null ? (
            <span className="text-muted">You must be within {radius} m of the issue.</span>
          ) : ok ? (
            <span className="font-semibold text-brand">You're on-site ({formatDistance(loc.distance)} away)</span>
          ) : (
            <span className="font-semibold text-danger">
              You're {formatDistance(loc.distance)} away — go within {radius} m
            </span>
          )}
        </div>
        <button type="button" className="btn-soft shrink-0" onClick={loc.locate} disabled={loc.locating}>
          {loc.locating ? <Spinner className="size-4" /> : <LocateFixed className="size-4" />}
          {loc.pos ? 'Refresh' : 'Use my location'}
        </button>
      </div>
      {loc.pos && <p className="mt-1 text-xs text-muted">GPS accuracy ±{Math.round(loc.pos.accuracy)} m</p>}
      {loc.error && <p className="mt-1 text-xs text-danger">{loc.error}</p>}
    </div>
  )
}

/** "I see this too": on-site confirmation with a photo. */
export function ConfirmOnSiteDialog({ issue, open, onClose }: { issue: Issue; open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const settings = useAppSettings().data
  const radius = settings?.confirm_radius_m ?? 200
  const loc = useOnSiteLocation(issue)
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const invalidate = useInvalidateIssue()

  async function submit() {
    if (!user || !loc.pos) return
    setBusy(true)
    try {
      const media = await uploadMedia(user.id, files)
      await confirmIssue(issue.id, loc.pos.lat, loc.pos.lng, loc.pos.accuracy, note, media)
      toast.success('Thanks! Your on-site confirmation counts double.')
      invalidate(issue.id)
      setFiles([])
      setNote('')
      onClose()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="I see this too">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Standing at the problem right now? Confirm it with a fresh photo. An on-site confirmation counts
          double toward validation, and replaces your upvote.
        </p>
        <LocationStatus loc={loc} radius={radius} />
        <div>
          <span className="label">Photo from the spot</span>
          <MediaPicker files={files} onChange={setFiles} required imagesOnly />
        </div>
        <div>
          <label className="label" htmlFor="confirm-note">Anything to add? (optional)</label>
          <textarea id="confirm-note" className="input" rows={2} maxLength={500} value={note}
            onChange={(e) => setNote(e.target.value)} placeholder="e.g. It got worse after last night's rain" />
        </div>
        <button className="btn-primary w-full" disabled={busy || !loc.pos || files.length === 0} onClick={submit}>
          {busy ? <Spinner className="size-4 text-brand-ink" /> : <Camera className="size-4" />}
          Confirm on-site
        </button>
      </div>
    </Modal>
  )
}

const FLAG_REASONS: { value: FlagReason; label: string; help: string }[] = [
  { value: 'fake_or_scam', label: 'Fake or scam', help: 'This problem does not exist or the photo is not real.' },
  { value: 'wrong_location', label: 'Wrong location', help: 'The pin is not where the problem is.' },
  { value: 'duplicate', label: 'Duplicate', help: 'Someone already reported this exact problem.' },
  { value: 'already_fixed', label: 'Already fixed', help: 'The problem is gone.' },
  { value: 'spam', label: 'Spam / advertising', help: 'Not a civic issue at all.' },
  { value: 'inappropriate', label: 'Inappropriate', help: 'Offensive content or shows private people.' },
]

export function FlagDialog({ issue, open, onClose }: { issue: Issue; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState<FlagReason>('fake_or_scam')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const settings = useAppSettings().data

  async function submit() {
    setBusy(true)
    try {
      await flagIssue(issue.id, reason, details)
      toast.success('Flag recorded. Reports are hidden automatically when flags outweigh support.')
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
          There are no admins: the community decides. A post is hidden when at least {settings?.hide_min_flags ?? 5} people
          flag it <em>and</em> flags outweigh support. The reporter won't see who flagged.
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
        <textarea className="input" rows={2} maxLength={500} placeholder="Details (optional)" value={details}
          onChange={(e) => setDetails(e.target.value)} />
        <button className="btn-danger w-full" disabled={busy} onClick={submit}>
          {busy && <Spinner className="size-4 text-white" />} Submit report
        </button>
      </div>
    </Modal>
  )
}

export function EditIssueDialog({ issue, open, onClose }: { issue: Issue; open: boolean; onClose: () => void }) {
  const categories = useCategories().data ?? []
  const [title, setTitle] = useState(issue.title)
  const [description, setDescription] = useState(issue.description)
  const [category, setCategory] = useState(issue.category)
  const [address, setAddress] = useState(issue.address)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const invalidate = useInvalidateIssue()

  async function save() {
    setBusy(true)
    try {
      await updateIssue(issue.id, title, description, category, address)
      toast.success('Report updated')
      invalidate(issue.id)
      onClose()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit report">
      <div className="space-y-3">
        <p className="text-xs text-muted">You can edit until the community validates the report.</p>
        <div>
          <label className="label" htmlFor="e-title">Title</label>
          <input id="e-title" className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="e-cat">Category</label>
          <select id="e-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="e-desc">Description</label>
          <textarea id="e-desc" className="input" rows={4} maxLength={2000} value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="e-addr">Address / landmark</label>
          <input id="e-addr" className="input" value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <button className="btn-primary w-full" disabled={busy || title.trim().length < 5} onClick={save}>
          {busy && <Spinner className="size-4 text-brand-ink" />} Save changes
        </button>
      </div>
    </Modal>
  )
}

export function useDeleteIssue() {
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const navigate = useNavigate()
  return async (issue: Issue, goHome = false) => {
    if (!window.confirm('Delete this report? This cannot be undone.')) return
    try {
      const paths = await deleteIssue(issue.id)
      await deleteFiles(paths).catch(() => undefined)
      toast.success('Report deleted')
      invalidate()
      if (goHome) navigate('/feed')
    } catch (e) {
      toast.error(e)
    }
  }
}
