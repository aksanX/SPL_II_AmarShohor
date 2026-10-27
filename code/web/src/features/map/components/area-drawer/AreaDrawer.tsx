import clsx from 'clsx'
import { Eraser, Hand, MousePointerClick, PenLine, Search, Shapes, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip } from 'react-leaflet'
import type { Boundary } from '@/models'
import { DHAKA } from '@/shared/geo/location.service'
import { placeSearchService } from '@/shared/geo/placeSearch.service'
import { Spinner } from '@/shared/ui'
import { areaLabel } from '@/features/city-corp/lib/areaLabel'
import { authorityService } from '@/features/city-corp/services/authority.service'
import { ClickToAdd } from '@/features/map/components/area-drawer/ClickToAdd'
import { Freehand } from '@/features/map/components/area-drawer/Freehand'
import { MoveTo } from '@/features/map/components/area-drawer/MoveTo'
import { type Thana, loadThanas, thanaKey, thanaPositions, guessArea } from '@/features/map/components/area-drawer/thanas'
import { type Ward, loadWards, shareInWards, wardCount, wardPositions } from '@/features/map/components/area-drawer/wards'
import { matchAreas } from '@/features/map/components/area-drawer/areaNames'
import { TILE_ATTRIBUTION, TILE_URL } from '@/features/map/lib/leaflet'
import { type LatLng, ringCrossesItself, ringFromGeoJSON } from '@/features/map/lib/outline'

/** Corner dots get in the way on a long outline from a search; the shape alone is enough there. */
const MAX_DOTS = 60

/** A thana the wards cover less than this much of is one they miss, so it's suggested on top of them. */
const MISSED_BY_WARDS = 0.5

const WARDS_SOURCE = 'Ward outlines: geoBoundaries (BBS, OCHA ROAP), CC BY 3.0 IGO.'

type Mode = 'move' | 'thanas' | 'draw' | 'corners'

const MODES: { id: Mode; label: string; icon: typeof Hand }[] = [
  { id: 'move', label: 'Move map', icon: Hand },
  { id: 'thanas', label: 'Pick thanas', icon: Shapes },
  { id: 'draw', label: 'Draw', icon: PenLine },
  { id: 'corners', label: 'Tap corners', icon: MousePointerClick },
]

/**
 * Outline a service area: search for it by name ("DNCC", "Chittagong") to build it from its 2011 wards or take
 * OpenStreetMap's outline, build it from suggested thanas, trace it freehand, or tap it corner by corner. `name` (the City Corporation being edited) picks the suggested thanas.
 */
export function AreaDrawer({ points, onChange, others = [], height = 360, name = '' }: {
  points: LatLng[]
  onChange: (points: LatLng[]) => void
  others?: { name: string; ring: LatLng[] }[]
  height?: number
  name?: string
}) {
  const start = points[0] ?? [DHAKA.lat, DHAKA.lng]
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Boundary | null>(null)
  const [mode, setMode] = useState<Mode>('move')
  const [thanas, setThanas] = useState<Thana[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState(false)
  const [fit, setFit] = useState<LatLng[] | null>(null)
  const [wards, setWards] = useState<Ward[]>([])
  const [wardMatches, setWardMatches] = useState<string[]>([])
  /** Where the outline came from when that needs a warning (2011 wards), shown under the search. */
  const [note, setNote] = useState('')
  /** The thana picker's suggested area, and whether its 2011 wards go into the outline with the picked thanas. */
  const [suggested, setSuggested] = useState('')
  const [withWards, setWithWards] = useState(true)
  const crosses = ringCrossesItself(points)
  const thanaAreas = [...new Set((thanas ?? []).map((t) => t.area))]
  const guessed = guessArea(name, thanaAreas)
  const areaWards = wards.filter((w) => w.area === suggested)
  const baseWards = withWards ? areaWards : []
  const thanaHint = baseWards.length
    ? `${suggested}'s 2011 wards are filled in (blue), with the thanas they miss. Click a thana to add or remove it, then make the outline.`
    : !thanas || guessed
      ? 'The suggested thanas are filled in. Click a thana to add or remove it, then make the outline.'
      : chosen.size || !areaLabel(name).trim()
        ? 'Click a thana to add or remove it, then make the outline.'
        : `There are no thanas for ${areaLabel(name)} here. Search for it above, or use Draw.`

  /** Suggest an area's thanas; when its wards are in, only the thanas they miss. */
  function chooseArea(area: string, list: Thana[] = thanas ?? [], allWards: Ward[] = wards, include = withWards) {
    const inArea = list.filter((t) => t.area === area)
    const base = include ? allWards.filter((w) => w.area === area) : []
    const picked = base.length ? inArea.filter((t) => shareInWards(t.geometry, base) < MISSED_BY_WARDS) : inArea
    setSuggested(area)
    setChosen(new Set(picked.map(thanaKey)))
    setFit(inArea.flatMap((t) => thanaPositions(t.geometry).flat(2)))
  }

  function toggleWards(include: boolean) {
    setWithWards(include)
    if (suggested) chooseArea(suggested, thanas ?? [], wards, include)
  }

  async function openThanas() {
    setMode('thanas')
    setError('')
    try {
      // Without the wards the picker still works, just with thanas only.
      const [list, allWards] = await Promise.all([thanas ?? loadThanas(), wards.length ? wards : loadWards().catch(() => [])])
      setThanas(list)
      setWards(allWards)
      const areas = [...new Set(list.map((t) => t.area))]
      // The City Corporation being edited, else the one whose wards were just picked in the search.
      const guess = chosen.size ? undefined : guessArea(name, areas) ?? areas.find((a) => a === suggested)
      if (guess) chooseArea(guess, list, allWards)
    } catch {
      setError('Could not load the thanas. Draw the area instead, or try again.')
    }
  }

  function toggleThana(t: Thana) {
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(thanaKey(t))) next.delete(thanaKey(t))
      else next.add(thanaKey(t))
      return next
    })
  }

  /** Any change except building from wards: the 2011-wards note no longer describes the outline. */
  function change(next: LatLng[]) {
    setNote('')
    onChange(next)
  }

  async function makeOutline() {
    const picked = (thanas ?? []).filter((t) => chosen.has(thanaKey(t)))
    setMerging(true)
    setError('')
    try {
      const outline = await authorityService.mergeAreas([...baseWards, ...picked].map((t) => t.geometry))
      change(ringFromGeoJSON(outline))
      if (baseWards.length) {
        setNote(`Made from ${suggested}'s wards as they were in 2011` + (picked.length
          ? `, and ${picked.length} thana${picked.length === 1 ? '' : 's'} for the parts they miss. Thana edges are rougher than ward edges, so check them before saving.`
          : '. Wards added since then (in Dhaka, the 2016 ones) are not in it, so check the edges before saving.') + ` ${WARDS_SOURCE}`)
      }
      setMode('move')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join the thanas.')
    } finally {
      setMerging(false)
    }
  }

  async function search() {
    // Enter skips the disabled Find button, so a second press must not start another lookup (Nominatim allows 1/s).
    if (query.trim().length < 2 || searching || merging) return
    const q = query.trim()
    setSearching(true)
    setError('')
    setWardMatches([])
    try {
      // The City Corporation's own wards first: the closest to its real area, and there even when OpenStreetMap is down.
      const list = wards.length ? wards : await loadWards().catch(() => [])
      setWards(list)
      const matches = matchAreas(q, [...new Set(list.map((w) => w.area))])
      if (matches.length === 1) return void await pickWards(matches[0], list)
      // A name that fits more than one ("Dhaka": North or South) is the one time there's a choice to make.
      if (matches.length > 1) return setWardMatches(matches)
      let found: Boundary[]
      try {
        found = await placeSearchService.searchBoundaries(q)
      } catch {
        return setError('Search is not available right now. Draw the area by hand, or try again in a moment.')
      }
      // Best match first, outlines before places OpenStreetMap only has a point for.
      const best = found.find((b) => b.ring) ?? found[0]
      if (best) pick(best)
      else setError(`Nothing found for "${q}". Try another spelling (Chattogram, Chittagong) or draw it by hand.`)
    } finally {
      setSearching(false)
    }
  }

  function pick(b: Boundary) {
    setMode('move')
    setNote('')
    if (b.ring) change(b.ring)
    setPicked(b)
    // Not b.detail: its address ("Bogura, Bogura District, …") reads as if the district had been picked.
    if (b.ring) setNote(`Outline of ${b.name} from OpenStreetMap. Check that it covers the City Corporation before saving.`)
  }

  async function pickWards(area: string, list: Ward[] = wards) {
    const inArea = list.filter((w) => w.area === area)
    setSuggested(area)
    setWardMatches([])
    setPicked(null)
    setMode('move')
    setMerging(true)
    setError('')
    try {
      const outline = await authorityService.mergeAreas(inArea.map((w) => w.geometry))
      onChange(ringFromGeoJSON(outline))
      setNote(`Made from ${area}'s wards as they were in 2011. Wards added since then (in Dhaka, the 2016 ones) are not in it, so check `
        + `the edges before saving: Pick thanas can add the missing parts. ${WARDS_SOURCE}`)
      setFit(inArea.flatMap((w) => wardPositions(w.geometry).flat(2)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join the wards.')
    } finally {
      setMerging(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search for an area" maxLength={200}
          placeholder="Search an area, e.g. Dhaka North City Corporation or DNCC"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search() } }} />
        <button type="button" className="btn-soft shrink-0" disabled={searching || merging || query.trim().length < 2} onClick={search}>
          {searching || (merging && mode !== 'thanas') ? <Spinner className="size-4" /> : <Search className="size-4" />} Find
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {wardMatches.length > 0 && (
        <ul className="card divide-y divide-line" aria-label="Which City Corporation?">
          {wardMatches.map((a) => {
            const count = wardCount(wards.filter((w) => w.area === a))
            return (
              <li key={`wards:${a}`}>
                <button type="button" className="w-full p-2 text-left text-sm hover:bg-card-hover" onClick={() => pickWards(a)}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{a} City Corporation</span>
                    <span className="chip bg-brand-soft px-1.5 text-[10px] text-brand">From wards</span>
                  </span>
                  <span className="block truncate text-xs text-muted">Its {count} wards as they were in 2011 (BBS census)</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {note && <p className="rounded-lg bg-warn-soft p-2 text-xs text-warn">{note}</p>}
      {picked && !picked.ring && (
        <p className="rounded-lg bg-warn-soft p-2 text-xs text-warn">
          OpenStreetMap has no outline for {picked.name}, so the map moved there. Tap the map to add its corners.
        </p>
      )}

      <div className="flex gap-1 rounded-lg border border-line p-1" role="radiogroup" aria-label="What the mouse does on the map">
        {MODES.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => (id === 'thanas' ? openThanas() : setMode(id))}
            className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold',
              mode === id ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-card-hover')}>
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">
        {mode === 'move' && 'Drag and zoom to the City Corporation (or search above). Then pick its thanas, or draw it.'}
        {mode === 'thanas' && thanaHint}
        {mode === 'draw' && 'Hold the mouse (or your finger) down and trace all the way round the area, then let go. A new line replaces the old outline.'}
        {mode === 'corners' && 'Tap the map at each corner of the area, in order round its edge.'}
      </p>

      {mode === 'thanas' && thanas && (
        <div className="space-y-2 rounded-lg bg-bg p-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted">Suggest:</span>
            {thanaAreas.map((a) => (
              <button key={a} type="button" onClick={() => chooseArea(a)}
                className={clsx('chip', guessed === a ? 'bg-brand-soft text-brand' : 'bg-card-hover text-muted')}>
                {a}
              </button>
            ))}
          </div>
          {areaWards.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withWards} onChange={(e) => toggleWards(e.target.checked)} />
              Start from {suggested}'s {wardCount(areaWards)} wards (2011), and pick only the thanas they miss
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">
              {baseWards.length > 0 && `${wardCount(baseWards)} wards + `}{chosen.size} thana{chosen.size === 1 ? '' : 's'} picked
            </span>
            <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={!chosen.size} onClick={() => setChosen(new Set())}>Unpick all</button>
            <button type="button" className="btn-primary ml-auto" disabled={(!chosen.size && !baseWards.length) || merging} onClick={makeOutline}>
              {merging && <Spinner className="size-4 text-brand-ink" />} Make outline
            </button>
          </div>
          <p className="text-[11px] text-muted">
            Which thanas belong to which City Corporation is a suggestion; check before saving. Only Dhaka, Chattogram, Khulna and
            Rajshahi have city thanas here; for other cities use Draw. Thana outlines: geoBoundaries (BBS, OCHA ROAP), CC BY 3.0 IGO.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-line" style={{ height }}>
        <MapContainer center={start} zoom={12} className="size-full" scrollWheelZoom>
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
          {mode === 'corners' && <ClickToAdd onAdd={(p) => change([...points, p])} />}
          {mode === 'draw' && <Freehand onDone={change} />}
          <MoveTo target={picked} fit={fit} />
          {others.map((o, i) => (
            // Index too: two City Corporations may share a name (e.g. an inactive old one), and keys must differ.
            <Polygon key={`${i}:${o.name}`} positions={o.ring} pathOptions={{ color: '#64748b', weight: 1, fillOpacity: 0.05, dashArray: '4', interactive: false }} />
          ))}
          {mode === 'thanas' && baseWards.map((w, i) => (
            <Polygon key={`ward:${i}`} positions={wardPositions(w.geometry)}
              pathOptions={{ color: '#2563eb', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.3, interactive: false }} />
          ))}
          {mode === 'thanas' && thanas?.map((t) => {
            const on = chosen.has(thanaKey(t))
            return (
              <Polygon key={thanaKey(t)} positions={thanaPositions(t.geometry)} eventHandlers={{ click: () => toggleThana(t) }}
                pathOptions={{ color: on ? '#b45309' : '#64748b', weight: 1, fillColor: on ? '#f59e0b' : '#94a3b8', fillOpacity: on ? 0.4 : 0.08 }}>
                <Tooltip sticky>{t.name} · {t.area}{on ? ' · picked' : ''}</Tooltip>
              </Polygon>
            )
          })}
          {points.length >= 3 && mode !== 'thanas' && (
            <Polygon positions={points} pathOptions={{ color: '#b45309', weight: 2, fillOpacity: 0.15, interactive: false }} />
          )}
          {points.length <= MAX_DOTS && points.map((p, i) => (
            <CircleMarker key={i} center={p} radius={5} pathOptions={{ color: '#b45309', fillOpacity: 1 }} />
          ))}
        </MapContainer>
      </div>
      {crosses && (
        <p className="rounded-lg bg-danger-soft p-2 text-xs text-danger">
          The outline crosses itself, so it can't be saved. Draw it again without the line crossing over.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="mr-auto text-muted">
          {points.length === 0 ? 'No outline yet.' : points.length < 3 ? `${points.length} corners so far, need at least 3.` : `Outline with ${points.length} corners.`}
          {' '}Grey dashed areas belong to other City Corporations.
        </span>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={!points.length} onClick={() => change(points.slice(0, -1))}>
          <Undo2 className="size-3.5" /> Undo
        </button>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={!points.length} onClick={() => change([])}>
          <Eraser className="size-3.5" /> Clear
        </button>
      </div>
    </div>
  )
}
