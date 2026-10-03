import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Info, LocateFixed, Send, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LocationPicker } from '../components/map/LocationPicker'
import { MediaPicker } from '../components/MediaPicker'
import { Modal, Spinner, StatusBadge } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useAppSettings, useCategories, useMySettings } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { AppError, createIssue, findDuplicates } from '../lib/api'
import { CategoryIcon } from '../lib/categories'
import { formatDistance, getCurrentPosition, reverseGeocode } from '../lib/geo'
import { timeAgo } from '../lib/format'
import { uploadMedia } from '../lib/media'
import { mediaUrl } from '../lib/supabase'
import type { DuplicateCandidate } from '../lib/types'

const DRAFT_KEY = 'amarshohor:draft'

interface Draft {
  title: string
  description: string
  category: string
  address: string
  point: { lat: number; lng: number } | null
  accuracy: number | null
  source: 'gps' | 'manual'
}

function loadDraft(): Partial<Draft> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') as Partial<Draft>
  } catch {
    return {}
  }
}

export function NewIssuePage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const categories = useCategories().data ?? []
  const settings = useAppSettings().data
  const mySettings = useMySettings().data
  const maxAccuracy = settings?.max_gps_accuracy_m ?? 100

  const draft = loadDraft()
  const [files, setFiles] = useState<File[]>([])
  const [title, setTitle] = useState(draft.title ?? '')
  const [description, setDescription] = useState(draft.description ?? '')
  const [category, setCategory] = useState(draft.category ?? '')
  const [address, setAddress] = useState(draft.address ?? '')
  const [point, setPoint] = useState<Draft['point']>(draft.point ?? null)
  const [accuracy, setAccuracy] = useState<number | null>(draft.accuracy ?? null)
  const [source, setSource] = useState<'gps' | 'manual'>(draft.source ?? 'gps')
  const [anonymous, setAnonymous] = useState(false)
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null)

  useEffect(() => {
    if (mySettings) setAnonymous(mySettings.default_anonymous)
  }, [mySettings])

  // Keep a draft so a crash, refresh or lost connection doesn't lose the report.
  useEffect(() => {
    const d: Draft = { title, description, category, address, point, accuracy, source }
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    } catch {
      /* storage unavailable */
    }
  }, [title, description, category, address, point, accuracy, source])

  async function useGps() {
    setLocating(true)
    try {
      const p = await getCurrentPosition()
      setPoint({ lat: p.lat, lng: p.lng })
      setAccuracy(p.accuracy)
      if (p.accuracy > maxAccuracy) {
        setSource('manual')
        toast.info(`GPS is only accurate to ±${Math.round(p.accuracy)} m. Drag the pin to the exact spot.`)
      } else {
        setSource('gps')
      }
      setAddress((await reverseGeocode(p.lat, p.lng)) || address)
    } catch (e) {
      toast.error(e)
    } finally {
      setLocating(false)
    }
  }

  async function onPick(lat: number, lng: number) {
    setPoint({ lat, lng })
    setSource('manual')
    setAccuracy(null)
    const a = await reverseGeocode(lat, lng)
    if (a) setAddress(a)
  }

  const selectedCategory = categories.find((c) => c.slug === category)
  const missing = [
    files.length === 0 && 'a photo or video',
    !category && 'a category',
    !point && 'the location',
    title.trim().length < 5 && 'a title (5+ characters)',
  ].filter(Boolean) as string[]

  async function submit(skipDuplicateCheck: boolean) {
    if (!user || !point || missing.length) return
    try {
      if (!skipDuplicateCheck) {
        setBusy('Checking for similar reports nearby…')
        const dups = await findDuplicates(point.lat, point.lng, category)
        if (dups.length) {
          setDuplicates(dups)
          setBusy(null)
          return
        }
      }
      setBusy(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`)
      const media = await uploadMedia(user.id, files, (n) => setBusy(`Uploading ${n}/${files.length}…`))
      setBusy('Posting…')
      const id = await createIssue({
        title: title.trim(),
        description: description.trim(),
        category,
        lat: point.lat,
        lng: point.lng,
        accuracyM: source === 'gps' ? accuracy : null,
        locationSource: source,
        address: address.trim(),
        isAnonymous: anonymous,
        media,
        skipDuplicateCheck: true,
      })
      localStorage.removeItem(DRAFT_KEY)
      qc.invalidateQueries({ queryKey: ['feed'] })
      toast.success('Posted! Your neighbours can now validate it.')
      navigate(`/issue/${id}`, { replace: true })
    } catch (e) {
      if (e instanceof AppError && e.code === 'LOW_GPS_ACCURACY') setSource('manual')
      toast.error(
        e instanceof AppError && e.code === 'NETWORK'
          ? new Error('Connection lost. Your report is saved here — press Post again when you are back online.')
          : e,
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-2 py-4 sm:px-4">
      <div className="card divide-y divide-line">
        <div className="p-4">
          <h1 className="text-xl font-bold">Report an issue</h1>
          <p className="text-sm text-muted">
            Your post appears in the community feed. Once enough neighbours verify it, volunteers can take it on.
          </p>
        </div>

        <section className="space-y-2 p-4">
          <h2 className="label">1. Evidence</h2>
          <MediaPicker files={files} onChange={setFiles} required />
        </section>

        <section className="space-y-2 p-4">
          <h2 className="label">2. What kind of problem?</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {categories.map((c) => (
              <button
                type="button"
                key={c.slug}
                onClick={() => setCategory(c.slug)}
                className={clsx('flex items-center gap-2 rounded-lg border p-2 text-left text-sm',
                  category === c.slug ? 'border-brand bg-brand-soft font-semibold' : 'border-line hover:bg-card-hover')}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: `${c.color}1f`, color: c.color }}>
                  <CategoryIcon icon={c.icon} className="size-4" />
                </span>
                <span className="min-w-0 leading-tight">{c.name}</span>
              </button>
            ))}
          </div>
          {selectedCategory && (
            <p className="flex items-start gap-2 rounded-lg bg-info-soft p-2 text-xs text-info">
              <Info className="mt-0.5 size-4 shrink-0" />
              {selectedCategory.resolver === 'community'
                ? 'Volunteers can fix this kind of problem themselves (clean-up, removal, awareness).'
                : 'This needs the authority (e.g. city corporation). A volunteer will file the complaint, follow up, and confirm the fix.'}
            </p>
          )}
        </section>

        <section className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="label mb-0">3. Exact location</h2>
            <button type="button" className="btn-soft" onClick={useGps} disabled={locating}>
              {locating ? <Spinner className="size-4" /> : <LocateFixed className="size-4" />} Use my GPS
            </button>
          </div>
          <LocationPicker value={point} accuracy={accuracy} onPick={onPick} />
          <p className={clsx('text-xs', point ? 'text-muted' : 'text-warn')}>
            {!point
              ? 'Use GPS or tap the map. The pin must be on the exact spot — the heatmap depends on it.'
              : source === 'gps'
                ? `GPS location (±${Math.round(accuracy ?? 0)} m). Drag the pin if it's off.`
                : 'Pin placed manually. Make sure it is on the exact spot.'}
          </p>
          <input className="input" placeholder="Address or landmark (e.g. In front of Mirpur 10 metro station)"
            value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} />
        </section>

        <section className="space-y-3 p-4">
          <h2 className="label mb-0">4. Describe it</h2>
          <input className="input" placeholder="Short title, e.g. Open manhole near the school gate"
            value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" rows={4} maxLength={2000} value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="How big is it? Since when? Who is affected? Any danger?" />
        </section>

        <section className="p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)} />
            <span className="flex items-center gap-2 text-sm">
              <UserRound className="size-4 text-muted" />
              Post anonymously <span className="text-muted">— your name won't be shown publicly</span>
            </span>
          </label>
        </section>

        <div className="space-y-2 p-4">
          {missing.length > 0 && <p className="text-sm text-muted">Still needed: {missing.join(', ')}.</p>}
          <button className="btn-primary w-full py-3 text-base" disabled={Boolean(busy) || missing.length > 0}
            onClick={() => submit(false)}>
            {busy ? <><Spinner className="size-5 text-brand-ink" /> {busy}</> : <><Send className="size-5" /> Post</>}
          </button>
        </div>
      </div>

      <Modal open={Boolean(duplicates)} onClose={() => setDuplicates(null)} title="Is it one of these?">
        <p className="mb-3 text-sm text-muted">
          Similar {selectedCategory?.name.toLowerCase()} reports are open within {settings?.duplicate_radius_m ?? 50} m.
          If it's the same problem, confirm it instead — one strong report gets fixed faster than many weak ones.
        </p>
        <div className="space-y-2">
          {duplicates?.map((d) => (
            <div key={d.id} className="flex gap-3 rounded-lg border border-line p-2">
              {d.thumb_path && d.thumb_type === 'image' ? (
                <img src={mediaUrl(d.thumb_path)} alt="" className="size-20 shrink-0 rounded-md object-cover" />
              ) : (
                <div className="size-20 shrink-0 rounded-md bg-card-hover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 font-semibold">{d.title}</p>
                <p className="text-xs text-muted">
                  {formatDistance(d.distance_m)} away · {timeAgo(d.created_at)} · ▲ {d.upvote_count}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusBadge status={d.status} />
                  <button
                    className="btn-primary px-2.5 py-1 text-xs"
                    onClick={() => navigate(`/issue/${d.id}`, { state: { openConfirm: true } })}
                  >
                    Yes — I see this too
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button className="btn-soft mt-4 w-full" onClick={() => { setDuplicates(null); submit(true) }}>
          No, mine is a different problem — post it
        </button>
      </Modal>
    </div>
  )
}
