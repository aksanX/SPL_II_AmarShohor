import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, LocateFixed, Send, Siren, UserRound, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LocationPicker } from '../components/map/LocationPicker'
import { MediaPicker } from '../components/MediaPicker'
import { Modal, Spinner, StatusBadge } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useAppSettings, useCategories, useCategoryGroups, useMySettings } from '../hooks/useData'
import { useTitle } from '../hooks/useTitle'
import { useToast } from '../hooks/useToast'
import { AppError, createIssue, findDuplicates, getMyPostingPause } from '../lib/api'
import { buildCategoryTree, CategoryIcon, EMERGENCY_VERSION } from '../lib/categories'
import { formatDistance, getCurrentPosition, reverseGeocode } from '../lib/geo'
import { timeAgo } from '../lib/format'
import { uploadMedia } from '../lib/media'
import { mediaUrl } from '../lib/supabase'
import type { Category, DuplicateCandidate, UploadedMedia } from '../lib/types'

const DRAFT_KEY = 'amarshohor:draft'
type Size = 'small' | 'medium' | 'large'

interface Draft {
  title: string
  description: string
  size: Size | null
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

const SIZES: { value: Size; label: string; help: string }[] = [
  { value: 'small', label: 'Small', help: 'One spot' },
  { value: 'medium', label: 'Medium', help: 'A street corner' },
  { value: 'large', label: 'Large', help: 'A whole area' },
]

export function NewIssuePage() {
  useTitle('Report an issue')
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const allCategories = useCategories().data
  const categories = useMemo(() => (allCategories ?? []).filter((c) => c.is_active), [allCategories])
  const categoryGroups = useCategoryGroups().data
  const tree = useMemo(() => buildCategoryTree(categoryGroups ?? [], categories), [categoryGroups, categories])
  // Active categories outside any group (e.g. "Other"), offered after the groups.
  const ungrouped = categories.filter((c) => !tree.some((g) => g.subgroups.some((s) => s.categories.includes(c))))
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const settings = useAppSettings().data
  const mySettings = useMySettings().data
  const maxAccuracy = settings?.max_gps_accuracy_m ?? 100

  const draft = loadDraft()
  const [files, setFiles] = useState<File[]>([])
  const [uploaded, setUploaded] = useState<UploadedMedia[] | null>(null)
  const [title, setTitle] = useState(draft.title ?? '')
  const [description, setDescription] = useState(draft.description ?? '')
  const [size, setSize] = useState<Size | null>(draft.size ?? null)
  const [address, setAddress] = useState(draft.address ?? '')
  const [point, setPoint] = useState<Draft['point']>(draft.point ?? null)
  const [accuracy, setAccuracy] = useState<number | null>(draft.accuracy ?? null)
  const [source, setSource] = useState<'gps' | 'manual'>(draft.source ?? 'gps')
  const [anonymous, setAnonymous] = useState(false)
  const [locating, setLocating] = useState(false)
  const pausedUntil = useQuery({ queryKey: ['posting-pause'], queryFn: getMyPostingPause, enabled: Boolean(user) }).data ?? null
  const [busy, setBusy] = useState<string | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[] | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const addressLookup = useRef(0)

  useEffect(() => {
    if (mySettings) setAnonymous(mySettings.default_anonymous)
  }, [mySettings])

  // Keep a draft so a crash, refresh or lost connection doesn't lose the report.
  useEffect(() => {
    const d: Draft = { title, description, size, address, point, accuracy, source }
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    } catch {
      /* storage unavailable */
    }
  }, [title, description, size, address, point, accuracy, source])

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
      const lookup = ++addressLookup.current
      const a = await reverseGeocode(p.lat, p.lng)
      if (a && lookup === addressLookup.current) setAddress(a)
    } catch (e) {
      toast.error(e)
    } finally {
      setLocating(false)
    }
  }

  async function onPick(lat: number, lng: number, label?: string) {
    setPoint({ lat, lng })
    setSource('manual')
    setAccuracy(null)
    // Address lookups can finish out of order (tap, tap again quickly): only the latest one may fill the field.
    const lookup = ++addressLookup.current
    // A searched place already has a good name; only tapped or dragged pins need the address looked up.
    if (label) return setAddress(label.slice(0, 200))
    const a = await reverseGeocode(lat, lng)
    if (a && lookup === addressLookup.current) setAddress(a)
  }

  const describeMissing = [
    files.length === 0 && 'a photo or video',
    !point && 'the location',
    title.trim().length < 5 && 'a title (5+ characters)',
    !size && 'the size',
    !category && 'the kind of problem',
  ].filter(Boolean) as string[]

  async function submit(skipDuplicateCheck: boolean) {
    if (!user || !point || !category || describeMissing.length) return
    try {
      let media = uploaded
      if (!media) {
        setBusy(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`)
        media = await uploadMedia(user.id, files, (n) => setBusy(`Uploading ${n}/${files.length}…`))
        setUploaded(media)
      }
      if (!skipDuplicateCheck) {
        setBusy('Checking for similar reports nearby…')
        const dups = await findDuplicates(point.lat, point.lng, category)
        if (dups.length) {
          setDuplicates(dups)
          setBusy(null)
          return
        }
      }
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
        size,
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

  const chosen = categories.find((c) => c.slug === category)
  const emergencyVersion = category ? EMERGENCY_VERSION[category] : undefined

  const categoryButton = (c: Category) => (
    <button type="button" key={c.slug} role="radio" aria-checked={category === c.slug}
      onClick={() => setCategory(c.slug === category ? null : c.slug)}
      className={clsx('flex items-center gap-2 rounded-lg border p-2 text-left text-sm',
        category === c.slug ? 'border-brand bg-brand-soft font-semibold' : 'border-line bg-card hover:bg-card-hover')}>
      <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: `${c.color}1f`, color: c.color }}>
        <CategoryIcon icon={c.icon} className="size-4" />
      </span>
      <span className="min-w-0 leading-tight">{c.name}</span>
    </button>
  )
  const categoryButtons = (list: Category[]) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Category">
      {list.map(categoryButton)}
    </div>
  )

  return (
    <div className="mx-auto max-w-2xl px-2 py-4 sm:px-4">
      <Link to="/emergency" className="mb-3 flex items-center gap-3 rounded-xl bg-danger p-3 text-danger-ink hover:brightness-110">
        <Siren className="size-6 shrink-0" />
        <span className="text-sm">
          <strong className="block">Emergency happening now?</strong>
          Fire, gas leak, building collapse, live wire, people trapped, toxic smoke: call 999 first.
        </span>
      </Link>

      <div className="card divide-y divide-line">
        <div className="p-4">
          <h1 className="text-xl font-bold">Report an issue</h1>
          <p className="text-sm text-muted">
            Your post appears in the community feed. Once enough neighbours verify it, volunteers or the
            City Corporation take it on.
          </p>
        </div>

        <section className="space-y-2 p-4">
          <h2 className="label">1. Evidence</h2>
          <MediaPicker files={files} onChange={(f) => { setFiles(f); setUploaded(null) }} required />
        </section>

        <section className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="label mb-0">2. Exact location</h2>
            <button type="button" className="btn-soft" onClick={useGps} disabled={locating}>
              {locating ? <Spinner className="size-4" /> : <LocateFixed className="size-4" />} Use my GPS
            </button>
          </div>
          <LocationPicker value={point} accuracy={accuracy} onPick={onPick} />
          <p className={clsx('text-xs', point ? 'text-muted' : 'text-warn')}>
            {!point
              ? 'Use GPS or tap the map. The pin must be on the exact spot — the heatmap and City Corporation routing depend on it.'
              : source === 'gps'
                ? `GPS location (±${Math.round(accuracy ?? 0)} m). Drag the pin if it's off.`
                : 'Pin placed manually. Make sure it is on the exact spot.'}
          </p>
          <input className="input" placeholder="Address or landmark (e.g. In front of Mirpur 10 metro station)"
            value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} />
        </section>

        <section className="space-y-3 p-4">
          <h2 className="label mb-0">3. Describe it</h2>
          <input className="input" placeholder="Short title, e.g. Open manhole near the school gate"
            value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          <textarea className="input" rows={4} maxLength={2000} value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Since when? Who is affected? Any danger?" />
          <div>
            <span className="label">How big is it?</span>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Size">
              {SIZES.map((s) => (
                <button key={s.value} type="button" role="radio" aria-checked={size === s.value}
                  onClick={() => setSize(s.value)}
                  className={clsx('rounded-lg border p-2 text-sm',
                    size === s.value ? 'border-brand bg-brand-soft font-semibold' : 'border-line hover:bg-card-hover')}>
                  {s.label}<span className="block text-xs font-normal text-muted">{s.help}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-3 p-4">
          <h2 className="label mb-0">4. What kind of problem is it?</h2>
          {categories.length === 0 && <p className="text-sm text-muted">No categories yet. An admin needs to add them first.</p>}
          {tree.length === 0 ? (
            categoryButtons(categories)
          ) : (
            <>
              {/* First the main group, then the problem itself, listed under its subcategory. */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {tree.map((g) => (
                  <button type="button" key={g.group.slug} aria-expanded={openGroup === g.group.slug}
                    onClick={() => setOpenGroup(openGroup === g.group.slug ? null : g.group.slug)}
                    className={clsx('flex items-center gap-2 rounded-lg border p-2 text-left text-sm',
                      openGroup === g.group.slug ? 'border-brand bg-brand-soft font-semibold' : 'border-line hover:bg-card-hover')}>
                    <span className="grid size-8 shrink-0 place-items-center rounded-full"
                      style={{ background: `${g.group.color}1f`, color: g.group.color }}>
                      <CategoryIcon icon={g.group.icon} className="size-4" />
                    </span>
                    <span className="min-w-0 leading-tight">{g.group.name}</span>
                  </button>
                ))}
                {ungrouped.map((c) => categoryButton(c))}
              </div>
              {tree.filter((g) => g.group.slug === openGroup).map((g) => (
                <div key={g.group.slug} className="space-y-3 rounded-lg bg-bg p-3">
                  {g.subgroups.map((s) => (
                    <div key={s.group.slug}>
                      <h3 className="mb-1.5 text-xs font-semibold text-muted">{s.group.code} {s.group.name}</h3>
                      {categoryButtons(s.categories)}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
          {chosen && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <strong className="text-ink">{chosen.name}.</strong>
              {chosen.resolver === 'authority'
                ? <><Building2 className="size-4 text-warn" /> Usually fixed by the City Corporation.</>
                : <><Users className="size-4 text-brand" /> Usually fixed by volunteers. If it turns out too big, a volunteer can ask an admin to send it to the City Corporation.</>}
            </p>
          )}
          {emergencyVersion && (
            <Link to={`/emergency?kind=${emergencyVersion.kind}`}
              className="flex items-center gap-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger hover:brightness-95">
              <Siren className="size-5 shrink-0" />
              <span>
                <strong className="block">{emergencyVersion.question}</strong>
                Then it's an emergency: call 999 and warn people nearby instead of posting it here.
              </span>
            </Link>
          )}
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
          {pausedUntil && (
            <p className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
              Several of your recent reports were hidden as fake or spam, so you can post again on{' '}
              <strong>{new Date(pausedUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</strong>.
              You can still vote, confirm and comment.
            </p>
          )}
          {describeMissing.length > 0 && <p className="text-sm text-muted">First add: {describeMissing.join(', ')}.</p>}
          <button className="btn-primary w-full py-3 text-base" disabled={Boolean(busy) || describeMissing.length > 0 || Boolean(pausedUntil)}
            onClick={() => submit(false)}>
            {busy ? <><Spinner className="size-5 text-brand-ink" /> {busy}</> : <><Send className="size-5" /> Post</>}
          </button>
        </div>
      </div>

      <Modal open={Boolean(duplicates)} onClose={() => setDuplicates(null)} title="Is it one of these?">
        <p className="mb-3 text-sm text-muted">
          Similar reports are open within {settings?.duplicate_radius_m ?? 50} m.
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
