import clsx from 'clsx'
import { Eraser, Hand, MousePointerClick, PenLine, Search, Shapes, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip } from 'react-leaflet'
import type { Boundary } from '@/models'
import { DHAKA } from '@/shared/geo/location.service'
import { placeSearchService } from '@/shared/geo/placeSearch.service'
import { Spinner } from '@/shared/ui'
import { authorityService } from '@/features/city-corp/services/authority.service'
import { ClickToAdd } from '@/features/map/components/area-drawer/ClickToAdd'
import { Freehand } from '@/features/map/components/area-drawer/Freehand'
import { MoveTo } from '@/features/map/components/area-drawer/MoveTo'
import { type Thana, loadThanas, thanaKey, thanaPositions, guessArea } from '@/features/map/components/area-drawer/thanas'
import { TILE_ATTRIBUTION, TILE_URL } from '@/features/map/lib/leaflet'
import { type LatLng, ringCrossesItself, ringFromGeoJSON } from '@/features/map/lib/outline'

/** Corner dots get in the way on a long outline from a search; the shape alone is enough there. */
const MAX_DOTS = 60

type Mode = 'move' | 'thanas' | 'draw' | 'corners'

const MODES: { id: Mode; label: string; icon: typeof Hand }[] = [
  { id: 'move', label: 'Move map', icon: Hand },
  { id: 'thanas', label: 'Pick thanas', icon: Shapes },
  { id: 'draw', label: 'Draw', icon: PenLine },
  { id: 'corners', label: 'Tap corners', icon: MousePointerClick },
]

/**
 * Outline a service area: search for it by name ("Chittagong"), build it from suggested thanas, trace it
 * freehand, or tap it corner by corner. `name` (the City Corporation being edited) picks the suggested thanas.
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
  const [results, setResults] = useState<Boundary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Boundary | null>(null)
  const [mode, setMode] = useState<Mode>('move')
  const [thanas, setThanas] = useState<Thana[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [merging, setMerging] = useState(false)
  const [fit, setFit] = useState<LatLng[] | null>(null)
  const crosses = ringCrossesItself(points)
  const thanaAreas = [...new Set((thanas ?? []).map((t) => t.area))]

  function chooseArea(area: string, list: Thana[] = thanas ?? []) {
    const picked = list.filter((t) => t.area === area)
    setChosen(new Set(picked.map(thanaKey)))
    setFit(picked.flatMap((t) => thanaPositions(t.geometry).flat(2)))
  }

  async function openThanas() {
    setMode('thanas')
    setError('')
    try {
      const list = thanas ?? await loadThanas()
      setThanas(list)
      const guess = chosen.size ? undefined : guessArea(name, [...new Set(list.map((t) => t.area))])
      if (guess) chooseArea(guess, list)
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

  async function makeOutline() {
    setMerging(true)
    setError('')
    try {
      const outline = await authorityService.mergeAreas((thanas ?? []).filter((t) => chosen.has(thanaKey(t))).map((t) => t.geometry))
      onChange(ringFromGeoJSON(outline))
      setMode('move')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join the thanas.')
    } finally {
      setMerging(false)
    }
  }

  async function search() {
    // Enter skips the disabled Find button, so a second press must not start another lookup (Nominatim allows 1/s).
    if (query.trim().length < 2 || searching) return
    setSearching(true)
    setError('')
    try {
      const found = await placeSearchService.searchBoundaries(query.trim())
      setResults(found)
      if (!found.length) setError(`Nothing found for "${query.trim()}". Try another spelling (Chattogram, Chittagong) or draw it by hand.`)
    } catch {
      setError('Search is not available right now. Draw the area by hand, or try again in a moment.')
    } finally {
      setSearching(false)
    }
  }

  function pick(b: Boundary) {
    if (b.ring) onChange(b.ring)
    setPicked(b)
    setResults(null)
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search for an area" maxLength={200}
          placeholder="Search an area, e.g. Chittagong City Corporation"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search() } }} />
        <button type="button" className="btn-soft shrink-0" disabled={searching || query.trim().length < 2} onClick={search}>
          {searching ? <Spinner className="size-4" /> : <Search className="size-4" />} Find
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
      {results && results.length > 0 && (
        <ul className="card divide-y divide-line">
          {results.map((b, i) => (
            <li key={i}>
              <button type="button" className="w-full p-2 text-left text-sm hover:bg-card-hover" onClick={() => pick(b)}>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{b.name}</span>
                  {b.ring
                    ? <span className="chip bg-brand-soft px-1.5 text-[10px] text-brand">Outline</span>
                    : <span className="chip bg-card-hover px-1.5 text-[10px] text-muted">Location only</span>}
                </span>
                <span className="block truncate text-xs text-muted">{b.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
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
        {mode === 'thanas' && 'The suggested thanas are filled in. Click a thana to add or remove it, then make the outline.'}
        {mode === 'draw' && 'Hold the mouse (or your finger) down and trace all the way round the area, then let go. A new line replaces the old outline.'}
        {mode === 'corners' && 'Tap the map at each corner of the area, in order round its edge.'}
      </p>

      {mode === 'thanas' && thanas && (
        <div className="space-y-2 rounded-lg bg-bg p-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted">Suggest:</span>
            {thanaAreas.map((a) => (
              <button key={a} type="button" onClick={() => chooseArea(a)}
                className={clsx('chip', guessArea(name, thanaAreas) === a ? 'bg-brand-soft text-brand' : 'bg-card-hover text-muted')}>
                {a}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{chosen.size} thana{chosen.size === 1 ? '' : 's'} picked</span>
            <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={!chosen.size} onClick={() => setChosen(new Set())}>Unpick all</button>
            <button type="button" className="btn-primary ml-auto" disabled={!chosen.size || merging} onClick={makeOutline}>
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
          {mode === 'corners' && <ClickToAdd onAdd={(p) => onChange([...points, p])} />}
          {mode === 'draw' && <Freehand onDone={onChange} />}
          <MoveTo target={picked} fit={fit} />
          {others.map((o, i) => (
            // Index too: two City Corporations may share a name (e.g. an inactive old one), and keys must differ.
            <Polygon key={`${i}:${o.name}`} positions={o.ring} pathOptions={{ color: '#64748b', weight: 1, fillOpacity: 0.05, dashArray: '4', interactive: false }} />
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
        <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={!points.length} onClick={() => onChange(points.slice(0, -1))}>
          <Undo2 className="size-3.5" /> Undo
        </button>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={!points.length} onClick={() => onChange([])}>
          <Eraser className="size-3.5" /> Clear
        </button>
      </div>
    </div>
  )
}
