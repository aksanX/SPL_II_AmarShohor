import { keepPreviousData, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Flame, Hexagon, Info, LocateFixed, MapPin, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AreaPanel, RADII } from '../components/map/AreaPanel'
import { HexPanel, hexCenter } from '../components/map/HexPanel'
import {
  ClusterLayer, DropPinOnHold, HEX_COLORS, HeatLayer, HexLayer, SearchPinLayer, hexBreaks,
} from '../components/map/layers'
import { MapSearch, type SearchPick } from '../components/map/MapSearch'
import { Modal, Spinner } from '../components/ui'
import { useAppSettings, useCategories, useCategoryGroups } from '../hooks/useData'
import { useTitle } from '../hooks/useTitle'
import { useToast } from '../hooks/useToast'
import { getFeed, getHeatmapHex, getHeatmapPoints, getMapIssues, type BBox } from '../lib/api'
import { DHAKA, distanceM, getCurrentPosition, parseLatLng, reverseGeocode, searchPlaces } from '../lib/geo'
import { mainGroupOf } from '../lib/categories'
import type { HexCell } from '../lib/types'
import { TILE_ATTRIBUTION, TILE_URL } from '../lib/leaflet'

type Mode = 'pins' | 'hex' | 'heat'
type PinLayer = 'active' | 'unverified' | 'resolved'
const PIN_LAYERS: readonly PinLayer[] = ['active', 'unverified', 'resolved']

// Real-world hexagon edge length for each zoom level, so a hexagon is always a few dozen pixels wide.
//z is the Leaflet zoom level
function hexSizeForZoom(z: number) {
  // Zoomed out over several cities: big hexagons, so they stay visible and few.
  if (z <= 6) return 20000
  if (z === 7) return 12000
  if (z === 8) return 6000
  if (z === 9) return 3500
  if (z === 10) return 2000
  if (z === 11) return 1200
  if (z === 12) return 700
  if (z === 13) return 400
  if (z === 14) return 220
  if (z === 15) return 130
  return 80
}

interface Viewport { bbox: BBox; zoom: number }

function ViewportWatcher({ onChange }: { onChange: (v: Viewport) => void }) {
  const map = useMap()
  const emit = useCallback(() => {
    const b = map.getBounds().pad(0.15)
    const r = (n: number) => Math.round(n * 1000) / 1000 // stable cache keys while nudging the map
    onChange({
      zoom: map.getZoom(), //z comes from here
      bbox: { minLng: r(b.getWest()), minLat: r(b.getSouth()), maxLng: r(b.getEast()), maxLat: r(b.getNorth()) },
    })
  }, [map, onChange])
  useEffect(() => { emit() }, [emit])
  useMapEvents({ moveend: emit, zoomend: emit })
  return null
}

/** Where the map should move to. `bbox` is [south, west, north, east] for areas, so a whole neighbourhood fits. */
interface Focus { lat: number; lng: number; bbox?: [number, number, number, number] | null; zoom?: number }

function FocusController({ target }: { target: Focus | null }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    const b = target.bbox
    // Tiny bounding boxes (a single building) would zoom in too far; treat them as points.
    if (b && distanceM({ lat: b[0], lng: b[1] }, { lat: b[2], lng: b[3] }) > 300) {
      map.flyToBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [40, 40], maxZoom: 16 })
    } else {
      map.flyTo([target.lat, target.lng], target.zoom ?? Math.max(map.getZoom(), 15))
    }
  }, [target, map])
  return null
}

/** Radius that roughly covers a searched area: half its diagonal, rounded up to one of the radius choices. */
function radiusForBBox(b: [number, number, number, number] | null | undefined) {
  if (!b) return RADII[0]
  const half = distanceM({ lat: b[0], lng: b[1] }, { lat: b[2], lng: b[3] }) / 2
  return RADII.find((r) => r >= half) ?? RADII[RADII.length - 1]
}

const round6 = (n: number) => String(Math.round(n * 1e6) / 1e6)

export function MapPage() {
  useTitle('Map')
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const categoriesQuery = useCategories()
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data])
  const groupsQuery = useCategoryGroups()
  const categoryGroups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])
  const settings = useAppSettings().data

  const modeParam = params.get('mode')
  // Unknown values (an old or mistyped link) fall back to hexagons instead of loading data and drawing nothing.
  const mode: Mode = modeParam === 'pins' || modeParam === 'heat' ? modeParam : 'hex'
  const category = params.get('category')
  // Pin filters live in the URL too (?pins=active,resolved), so a shared link shows the same pins.
  // No ?pins means the default (validated only); ?pins= with nothing ticked stays empty.
  const pinsParam = params.get('pins')
  const layers = useMemo<PinLayer[]>(
    () => pinsParam === null ? ['active'] : PIN_LAYERS.filter((l) => pinsParam.split(',').includes(l)),
    [pinsParam],
  )
  const [view, setView] = useState<Viewport | null>(null)
  const [locating, setLocating] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [help, setHelp] = useState(false)

  // The search pin lives in the URL (?lat=&lng=&r=&place=&issue=) so a searched area can be shared or bookmarked.
  const pinLat = Number(params.get('lat'))
  const pinLng = Number(params.get('lng'))
  const pin = params.has('lat') && params.has('lng') && Number.isFinite(pinLat) && Number.isFinite(pinLng)
    ? { lat: pinLat, lng: pinLng } : null
  const radiusParam = Number(params.get('r'))
  const radiusM = (RADII as readonly number[]).includes(radiusParam) ? radiusParam : 1000
  const [initialPin] = useState(pin)

  // A dropped or dragged pin has no name yet: show its street address instead, like Google Maps.
  const placeName = params.get('place')
  const address = useQuery({
    queryKey: ['reverse-geocode', pin && Math.round(pin.lat * 1e4), pin && Math.round(pin.lng * 1e4)],
    enabled: Boolean(pin) && !placeName,
    staleTime: Infinity,
    queryFn: () => reverseGeocode(pin!.lat, pin!.lng),
  })
  const pinLabel = placeName || (pin && address.data) || null
  const [selectedHex, setSelectedHex] = useState<HexCell | null>(null)
  // A different filter or view mode means a different set of hexagons: drop the selection.
  const [hexFilterKey, setHexFilterKey] = useState(`${category}|${mode}`)
  if (hexFilterKey !== `${category}|${mode}`) {
    setHexFilterKey(`${category}|${mode}`)
    setSelectedHex(null)
  }
  const [focus, setFocus] = useState<Focus | null>(null)

  const updateParams = useCallback((changes: Record<string, string | null>) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(changes)) {
        if (v === null) next.delete(k)
        else next.set(k, v)
      }
      return next
    }, { replace: true })
  }, [setParams])
  const setParam = (k: string, v: string | null) => updateParams({ [k]: v })
  const setLayers = (next: PinLayer[]) => {
    const ordered = PIN_LAYERS.filter((l) => next.includes(l))
    setParam('pins', ordered.length === 1 && ordered[0] === 'active' ? null : ordered.join(','))
  }

  const placePin = useCallback((p: { lat: number; lng: number; label?: string | null; issue?: string | null; radius?: number }) => {
    updateParams({
      lat: round6(p.lat), lng: round6(p.lng), place: p.label || null, issue: p.issue ?? null,
      ...(p.radius ? { r: p.radius === 1000 ? null : String(p.radius) } : {}),
    })
  }, [updateParams])
  const clearPin = () => updateParams({ lat: null, lng: null, place: null, issue: null, r: null })

  const onSearchPick = useCallback((o: SearchPick) => {
    if (o.kind === 'place') {
      const radius = radiusForBBox(o.place.bbox)
      placePin({ lat: o.place.lat, lng: o.place.lng, label: o.place.name, radius })
      setFocus({ lat: o.place.lat, lng: o.place.lng, bbox: o.place.bbox })
    } else if (o.kind === 'issue') {
      placePin({ lat: o.issue.lat, lng: o.issue.lng, label: o.issue.title, issue: o.issue.id, radius: 500 })
      setFocus({ lat: o.issue.lat, lng: o.issue.lng, zoom: 17 })
    } else {
      placePin({ lat: o.lat, lng: o.lng, label: null })
      setFocus({ lat: o.lat, lng: o.lng, zoom: 16 })
    }
  }, [placePin])

  // Search submitted from the top bar while on the map (?q=…): jump to the best place, else the best matching issue.
  const topQuery = params.get('q')
  const [searchSeed, setSearchSeed] = useState<string | undefined>(topQuery ?? undefined)
  useEffect(() => {
    if (!topQuery) return
    let cancelled = false
    setSearchSeed(topQuery)
    updateParams({ q: null })
    ;(async () => {
      const coords = parseLatLng(topQuery)
      if (coords) return onSearchPick({ kind: 'coords', ...coords })
      try {
        const [place] = await searchPlaces(topQuery, view?.bbox, undefined, true)
        if (cancelled) return
        if (place) return onSearchPick({ kind: 'place', place })
        const [issue] = await getFeed({ sort: 'hot', scope: 'all', search: topQuery, limit: 1 })
        if (cancelled) return
        if (issue) return onSearchPick({ kind: 'issue', issue })
        toast.error(new Error(`Nothing found for “${topQuery}”.`))
      } catch (e) {
        if (!cancelled) toast.error(e)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per submitted query
  }, [topQuery])

  const cellM = view ? hexSizeForZoom(view.zoom) : 400
  const query = useQuery({
    queryKey: ['map', mode, view?.bbox, mode === 'hex' ? cellM : null, category, mode === 'pins' ? layers : null],
    enabled: Boolean(view) && (mode !== 'pins' || layers.length > 0),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const b = view!.bbox
      if (mode === 'pins') return { kind: 'pins' as const, data: await getMapIssues(b, category, layers) }
      if (mode === 'hex') return { kind: 'hex' as const, data: await getHeatmapHex(b, cellM, category) }
      return { kind: 'heat' as const, data: await getHeatmapPoints(b, category) }
    },
  })
  const result = query.data

  const openIssue = useCallback((id: string) => navigate(`/issue/${id}`), [navigate])
  // The map talks in main groups ("Roads, Mobility & Transportation"), not the 40 detailed categories.
  // Hexagons name their top main group (0015); older databases still send a category.
  const categoryName = useCallback(
    (slug: string) => categoryGroups.find((g) => g.slug === slug)?.name
      ?? mainGroupOf(slug, categories, categoryGroups)?.name
      ?? categories.find((c) => c.slug === slug)?.name ?? slug,
    [categories, categoryGroups],
  )
  const mainGroups = categoryGroups.filter((g) => !g.parent_slug)
  // An old link such as /map?category=pothole: keep it selectable until the user picks a group.
  const linkedCategory = category && !mainGroups.some((g) => g.slug === category)
    ? categories.find((c) => c.slug === category) : undefined

  async function locate() {
    setLocating(true)
    try {
      const p = await getCurrentPosition()
      placePin({ lat: p.lat, lng: p.lng, label: 'My location' })
      setFocus({ lat: p.lat, lng: p.lng, zoom: 15 })
    } catch (e) {
      toast.error(e)
    } finally {
      setLocating(false)
    }
  }

  // Hexagons and heat points each merge several issues, so add up their counts instead of counting rows.
  // With no pin type ticked the query stops, but its last result is still kept: show nothing instead.
  const count = mode === 'pins' && layers.length === 0 ? 0 : result
    ? result.kind === 'hex'
      ? result.data.reduce((s, c) => s + c.issue_count, 0)
      : result.kind === 'heat'
        ? result.data.reduce((s, p) => s + (p.issue_count ?? 1), 0)
        : result.data.length
    : 0

  // Say why the map is blank instead of leaving people to guess. Only for a finished, current result.
  const noPinTypes = mode === 'pins' && layers.length === 0
  const emptyView = noPinTypes || (query.isSuccess && !query.isPlaceholderData && !query.isFetching && count === 0)
  const emptyText = noPinTypes
    ? 'Tick at least one pin type in Filters to see issues.'
    : mode === 'pins'
      ? 'No issues of these types here. Try zooming out or ticking more pin types.'
      : category
        ? 'No validated issues in this category here. Try zooming out or another category.'
        : 'No validated issues here. Try zooming out.'

  return (
    <div className="relative h-[calc(100dvh-56px-64px)] md:h-[calc(100dvh-56px)]">
      <MapContainer
        center={initialPin ? [initialPin.lat, initialPin.lng] : [DHAKA.lat, DHAKA.lng]}
        zoom={initialPin ? 14 : 12}
        className="size-full"
        zoomControl={false}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <ViewportWatcher onChange={setView} />
        <FocusController target={focus} />
        <DropPinOnHold onDrop={(lat, lng) => placePin({ lat, lng, label: null })} />
        {result?.kind === 'pins' && mode === 'pins' && layers.length > 0 && <ClusterLayer issues={result.data} onOpen={openIssue} />}
        {result?.kind === 'hex' && mode === 'hex' && (
          <HexLayer cells={result.data} version={query.dataUpdatedAt} selected={selectedHex} onSelect={setSelectedHex} />
        )}
        {result?.kind === 'heat' && mode === 'heat' && <HeatLayer points={result.data} />}
        {pin && (
          <SearchPinLayer lat={pin.lat} lng={pin.lng} radiusM={radiusM} label={pinLabel}
            onMove={(lat, lng) => placePin({ lat, lng, label: null })} />
        )}
      </MapContainer>

      {/* Controls */}
      <div className="absolute left-3 top-3 z-[500] w-[min(320px,calc(100%-80px))] space-y-2">
        <MapSearch key={searchSeed} initialQuery={searchSeed} near={view?.bbox ?? null} onPick={onSearchPick} />
        <div className="card p-1.5 shadow-lg">
          <div className="grid grid-cols-3 gap-1">
            {([
              ['hex', 'Hexagons', Hexagon],
              ['heat', 'Heat', Flame],
              ['pins', 'Pins', MapPin],
            ] as const).map(([m, label, Icon]) => (
              <button
                key={m}
                onClick={() => setParam('mode', m === 'hex' ? null : m)}
                className={clsx('flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold',
                  mode === m ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-card-hover')}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
        </div>

        <div className="card shadow-lg">
          <button className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold" onClick={() => setPanelOpen(!panelOpen)}>
            <span className="flex items-center gap-2"><SlidersHorizontal className="size-4" /> Filters</span>
            <span className="flex items-center gap-2 text-xs font-normal text-muted">
              {query.isFetching && <Spinner className="size-3.5" />}
              {count} issue{count === 1 ? '' : 's'} in view
            </span>
          </button>
          {panelOpen && (
            <div className="space-y-3 border-t border-line p-3">
              <select className="input" value={category ?? ''} onChange={(e) => setParam('category', e.target.value || null)} aria-label="Category">
                <option value="">All categories</option>
                {mainGroups.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
                {linkedCategory && <option value={linkedCategory.slug}>{linkedCategory.name}</option>}
              </select>
              {mode === 'pins' ? (
                <div className="space-y-1.5">
                  {([
                    ['active', 'Validated & being fixed', 'solid pin'],
                    ['unverified', 'Needs validation', 'dashed pin'],
                    ['resolved', 'Resolved', 'grey pin'],
                  ] as const).map(([v, label, hint]) => (
                    <label key={v} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="checkbox" className="accent-[var(--brand)]" checked={layers.includes(v)}
                        onChange={(e) => setLayers(e.target.checked ? [...layers, v] : layers.filter((x) => x !== v))} />
                      {label} <span className="text-xs text-muted">({hint})</span>
                    </label>
                  ))}
                </div>
              ) : mode === 'hex' && (
                <p className="flex items-start gap-1.5 text-xs text-muted">
                  <Hexagon className="mt-0.5 size-3.5 shrink-0" />
                  Each hexagon adds up the heat of the open issues inside it. Darker means hotter.
                </p>
              )}
              <p className="flex items-start gap-1.5 text-xs text-muted">
                <MapPin className="mt-0.5 size-3.5 shrink-0" />
                Search above, or right-click / long-press the map to drop a pin and see how hot that area is.
              </p>
              <button className="flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline" onClick={() => setHelp(true)}>
                <Info className="size-3.5" /> How is the heat calculated?
              </button>
            </div>
          )}
        </div>
      </div>

      <button
        onClick={locate}
        aria-label="Go to my location"
        className="card absolute right-3 top-3 z-[500] grid size-11 place-items-center shadow-lg hover:bg-card-hover"
      >
        {locating ? <Spinner className="size-5" /> : <LocateFixed className="size-5" />}
      </button>

      {selectedHex && mode === 'hex' && (
        <div className="absolute inset-x-3 bottom-3 z-[650] md:inset-x-auto md:bottom-auto md:right-3 md:top-16 md:w-80">
          <HexPanel
            cell={selectedHex}
            mostly={categoryName(selectedHex.top_category)}
            category={category}
            categories={categories}
            onOpenIssue={openIssue}
            onShowPins={() => {
              setFocus({ ...hexCenter(selectedHex), zoom: 18 })
              setSelectedHex(null)
              setParam('mode', 'pins')
            }}
            onClose={() => setSelectedHex(null)}
          />
        </div>
      )}

      {pin && !(selectedHex && mode === 'hex') && (
        <div className="absolute inset-x-3 bottom-3 z-[600] md:inset-x-auto md:bottom-auto md:right-3 md:top-16 md:w-80">
          <AreaPanel
            lat={pin.lat}
            lng={pin.lng}
            label={pinLabel}
            radiusM={radiusM}
            category={category}
            categories={categories}
            groups={categoryGroups}
            issueId={params.get('issue')}
            onRadius={(m) => setParam('r', m === 1000 ? null : String(m))}
            onOpenIssue={openIssue}
            onClose={clearPin}
          />
        </div>
      )}

      {emptyView && (
        <div className={clsx('pointer-events-none absolute inset-x-0 bottom-6 z-[500] flex justify-center px-3',
          (pin || selectedHex) && 'hidden md:flex')}>
          <p role="status" className="card max-w-sm px-4 py-2.5 text-center text-sm shadow-lg">{emptyText}</p>
        </div>
      )}

      {/* Legend */}
      {result?.kind === 'hex' && mode === 'hex' && result.data.length > 0 && (
        <div className={clsx('card absolute bottom-6 left-3 z-[500] p-3 text-xs shadow-lg', pin && 'hidden md:block')}>
          <p className="mb-1.5 font-semibold">Heat score per {cellM >= 1000 ? `${(cellM / 1000).toFixed(1)} km` : `${cellM} m`} hexagon</p>
          <div className="flex">
            {HEX_COLORS.map((c) => <span key={c} className="h-3 w-9" style={{ background: c }} />)}
          </div>
          <div className="flex justify-between text-muted">
            <span>low</span>
            <span>{Math.max(...result.data.map((c) => Number(c.weight))).toFixed(1)}</span>
          </div>
          <p className="mt-1 text-muted">Breaks: {hexBreaks(result.data).join(' · ')}</p>
        </div>
      )}
      {result?.kind === 'heat' && mode === 'heat' && result.data.length > 0 && (
        <div className={clsx('card absolute bottom-6 left-3 z-[500] p-3 text-xs shadow-lg', pin && 'hidden md:block')}>
          <p className="mb-1.5 font-semibold">Issue intensity</p>
          <div className="h-3 w-44 rounded" style={{ background: 'linear-gradient(90deg,#2c7bb6,#abd9e9,#ffffbf,#fdae61,#d7191c)' }} />
          <div className="flex justify-between text-muted"><span>low</span><span>high</span></div>
        </div>
      )}

      <Modal open={help} onClose={() => setHelp(false)} title="How the heatmap works">
        <div className="space-y-3 text-sm">
          <p><strong>Which issues count:</strong> only issues the community has <em>validated</em> and that are not fixed yet
            (validated, assigned, in progress, fix awaiting confirmation). Unverified posts, hidden fakes and resolved issues are excluded,
            so the map shows real, current problems.</p>
          <p><strong>No double counting:</strong> duplicates are merged at reporting time ("I see this too"), so one pothole is one issue
            — ten people reporting it make it <em>hotter</em>, not ten dots.</p>
          <p><strong>Each issue's heat =</strong></p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Severity:</strong> low 1 · medium 2 · high 3 · critical 4 (decided by the community)</li>
            <li><strong>× Evidence:</strong> 1 + ln(1 + on-site confirmations) + 0.25 × ln(1 + upvotes)</li>
            <li><strong>× Freshness:</strong> halves every {settings?.heat_half_life_days ?? 30} days since validation, but never below 35% —
              an old unfixed problem is still a problem.</li>
          </ul>
          <p><strong>Hexagons</strong> (most accurate): each issue is placed in exactly one hexagon on a fixed grid, and the hexagon's colour
            is the sum of its issues' heat. Hexagon size adapts to zoom and is corrected for map projection, so a 250 m hexagon is
            really 250 m on the ground in Dhaka.</p>
          <p><strong>Heat</strong> is a smooth blur of the same weighted points — nicer looking but less precise. <strong>Pins</strong> show
            individual issues, clustered when zoomed out.</p>
          <p><strong>Location accuracy:</strong> GPS pins worse than ±{settings?.max_gps_accuracy_m ?? 100} m are rejected unless the reporter
            places the pin by hand, and pins outside Bangladesh are refused.</p>
        </div>
      </Modal>
    </div>
  )
}
