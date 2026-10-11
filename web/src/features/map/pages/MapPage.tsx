import { keepPreviousData, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Flame, Hexagon, Info, Link2, LocateFixed, MapPin, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, ZoomControl } from 'react-leaflet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AreaPanel } from '@/features/map/components/AreaPanel'
import { HexPanel } from '@/features/map/components/HexPanel'
import { ClusterLayer } from '@/features/map/components/layers/ClusterLayer'
import { DropPinOnHold } from '@/features/map/components/layers/DropPinOnHold'
import { HeatLayer } from '@/features/map/components/layers/HeatLayer'
import { HexLayer } from '@/features/map/components/layers/HexLayer'
import { SearchPinLayer } from '@/features/map/components/layers/SearchPinLayer'
import { MapSearch, type SearchPick } from '@/features/map/components/MapSearch'
import { Modal, Spinner } from '@/shared/ui'
import { useCategories, useCategoryGroups } from '@/features/categories/hooks/useCategories'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { useTitle } from '@/shared/hooks/useTitle'
import { useToast } from '@/shared/hooks/useToast'
import { feedService } from '@/features/feed/services/feed.service'
import { mapService } from '@/features/map/services/map.service'
import { placeSearchService } from '@/shared/geo/placeSearch.service'
import { DHAKA, locationService } from '@/shared/geo/location.service'
import { parseLatLng } from '@/shared/geo/placeText'
import { formatDistance } from '@/shared/geo/distance'
import { mainGroupOf } from '@/features/categories/lib/categoryTree'
import { HEAT_LEGEND_CSS } from '@/features/map/lib/heat'
import { formatBreak, HEX_COLORS, hexBreaks, hexCenter, hexMaxWeight } from '@/features/map/lib/hexGrid'
import { countInView, MAX_PINS, pinsCapped } from '@/features/map/lib/pins'
import { parseDays, parsePinLayers, type PinLayer, pinLayersParam, TIME_RANGES } from '@/features/map/lib/urlFilters'
import { hexSizeForZoom, type MapMode, parsePin, RADII, radiusForBBox } from '@/features/map/lib/viewport'
import type { HexCell } from '@/models'
import { TILE_ATTRIBUTION, TILE_URL } from '@/features/map/lib/leaflet'
import { type Viewport, ViewportWatcher } from '@/features/map/components/ViewportWatcher'
import { type Focus, FocusController } from '@/features/map/components/FocusController'

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
  const mode: MapMode = modeParam === 'pins' || modeParam === 'heat' ? modeParam : 'hex'
  const category = params.get('category')
  // Time filter (?days=7 or 30): only issues reported in the last N days. Missing = all time.
  const days = parseDays(params.get('days'))
  // Pin filters live in the URL too (?pins=active,resolved), so a shared link shows the same pins.
  // No ?pins means the default (validated only); ?pins= with nothing ticked stays empty.
  const pinsParam = params.get('pins')
  const layers = useMemo(() => parsePinLayers(pinsParam), [pinsParam])
  const [view, setView] = useState<Viewport | null>(null)
  const [locating, setLocating] = useState(false)
  // Open on wide screens; folded on phones, where it would cover half the map.
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia?.('(min-width: 768px)').matches ?? true)
  const [help, setHelp] = useState(false)

  // The search pin lives in the URL (?lat=&lng=&r=&place=&issue=) so a searched area can be shared or bookmarked.
  const pin = parsePin(params.get('lat'), params.get('lng'))
  const radiusParam = Number(params.get('r'))
  const radiusM = (RADII as readonly number[]).includes(radiusParam) ? radiusParam : 1000
  const [initialPin] = useState(pin)

  // A dropped or dragged pin has no name yet: show its street address instead, like Google Maps.
  const placeName = params.get('place')
  const address = useQuery({
    queryKey: ['reverse-geocode', pin && Math.round(pin.lat * 1e4), pin && Math.round(pin.lng * 1e4)],
    enabled: Boolean(pin) && !placeName,
    staleTime: Infinity,
    queryFn: () => placeSearchService.reverseGeocode(pin!.lat, pin!.lng),
  })
  const pinLabel = placeName || (pin && address.data) || null
  const [selectedHex, setSelectedHex] = useState<HexCell | null>(null)
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
  const setLayers = (next: PinLayer[]) => setParam('pins', pinLayersParam(next))

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
        const [place] = await placeSearchService.searchPlaces(topQuery, view?.bbox, undefined, true)
        if (cancelled) return
        if (place) return onSearchPick({ kind: 'place', place })
        const [issue] = await feedService.getFeed({ sort: 'hot', scope: 'all', search: topQuery, limit: 1 })
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
  // A different filter, time, view mode or zoom (hexagon size) means a different set of hexagons: drop the selection.
  const hexKeyNow = `${category}|${days}|${mode}|${cellM}`
  const [hexFilterKey, setHexFilterKey] = useState(hexKeyNow)
  if (hexFilterKey !== hexKeyNow) {
    setHexFilterKey(hexKeyNow)
    setSelectedHex(null)
  }
  // Escape closes the hexagon panel, unless the user is typing in a box or the help window has the key.
  useEffect(() => {
    if (!selectedHex || help) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) setSelectedHex(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedHex, help])
  const query = useQuery({
    queryKey: ['map', mode, view?.bbox, mode === 'hex' ? cellM : null, category, days, mode === 'pins' ? layers : null],
    enabled: Boolean(view) && (mode !== 'pins' || layers.length > 0),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const b = view!.bbox
      if (mode === 'pins') return { kind: 'pins' as const, data: await mapService.getMapIssues(b, category, layers, days) }
      if (mode === 'hex') return { kind: 'hex' as const, data: await mapService.getHeatmapHex(b, cellM, category, days) }
      return { kind: 'heat' as const, data: await mapService.getHeatmapPoints(b, category, days) }
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
      const p = await locationService.getCurrentPosition()
      // No label: "My location" would be saved in the link and shown to whoever it is shared with.
      // The pin shows its street address instead.
      placePin({ lat: p.lat, lng: p.lng, label: null })
      setFocus({ lat: p.lat, lng: p.lng, zoom: 15 })
    } catch (e) {
      toast.error(e)
    } finally {
      setLocating(false)
    }
  }

  // With no pin type ticked the query stops, but its last result is still kept: show nothing instead.
  const count = mode === 'pins' && layers.length === 0 ? 0 : countInView(result)
  // Pins stop at MAX_PINS per view: say so instead of letting the count look complete.
  const capped = mode === 'pins' && layers.length > 0 && pinsCapped(result)

  // Say why the map is blank instead of leaving people to guess. Only for a finished, current result.
  const noPinTypes = mode === 'pins' && layers.length === 0
  const emptyView = noPinTypes || (query.isSuccess && !query.isPlaceholderData && !query.isFetching && count === 0)
  const timeText = days ? ` reported in the last ${days} days` : ''
  const emptyText = noPinTypes
    ? 'Tick at least one pin type in Filters to see issues.'
    : mode === 'pins'
      ? `No issues of these types${timeText} here. Try zooming out or ticking more pin types.`
      : category
        ? `No validated issues in this category${timeText} here. Try zooming out or another category.`
        : `No validated issues${timeText} here. Try zooming out${days ? ' or a longer time' : ''}.`

  // The whole view (mode, filters, time, pin) is in the URL, so copying the address shares exactly this map.
  async function shareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Map link copied. Anyone who opens it sees this view.')
    } catch {
      toast.error(new Error('Could not copy the link. Copy it from the address bar instead.'))
    }
  }

  return (
    <div className="relative h-[calc(100dvh-56px-64px)] md:h-[calc(100dvh-56px)]">
      <MapContainer
        center={initialPin ? [initialPin.lat, initialPin.lng] : [DHAKA.lat, DHAKA.lng]}
        zoom={initialPin ? 14 : 12}
        className="size-full"
        zoomControl={false}
        minZoom={5}
      >
        {/* + / − buttons for mouse and keyboard users; hidden on phones (pinch to zoom), see index.css. */}
        <ZoomControl position="bottomright" />
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <ViewportWatcher onChange={setView} />
        <FocusController target={focus} />
        <DropPinOnHold onDrop={(lat, lng) => placePin({ lat, lng, label: null })} />
        {result?.kind === 'pins' && mode === 'pins' && layers.length > 0 && <ClusterLayer issues={result.data} onOpen={openIssue} />}
        {result?.kind === 'hex' && mode === 'hex' && (
          <HexLayer cells={result.data} selected={selectedHex} onSelect={setSelectedHex} />
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
                aria-pressed={mode === m}
                className={clsx('flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold',
                  mode === m ? 'bg-brand text-brand-ink' : 'text-muted hover:bg-card-hover')}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
        </div>

        <div className="card shadow-lg">
          <button className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold" onClick={() => setPanelOpen(!panelOpen)}
            aria-expanded={panelOpen} aria-controls="map-filters">
            <span className="flex items-center gap-2"><SlidersHorizontal className="size-4" /> Filters</span>
            <span className="flex items-center gap-2 text-xs font-normal text-muted">
              {query.isFetching && <Spinner className="size-3.5" />}
              {/* Nothing until the first result: "0 issues" while loading would look like an empty map. */}
              {(result || noPinTypes) && <>{count}{capped && '+'} issue{count === 1 ? '' : 's'} in view</>}
            </span>
          </button>
          {capped && (
            <p role="status" className="border-t border-line px-3 py-2 text-xs text-warn">
              Showing the first {MAX_PINS.toLocaleString('en')} pins here. Zoom in to see them all.
            </p>
          )}
          {panelOpen && (
            <div id="map-filters" className="space-y-3 border-t border-line p-3">
              <select className="input" value={category ?? ''} onChange={(e) => setParam('category', e.target.value || null)} aria-label="Category">
                <option value="">All categories</option>
                {mainGroups.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
                {linkedCategory && <option value={linkedCategory.slug}>{linkedCategory.name}</option>}
              </select>
              {/* A radio group: Tab reaches only the chosen time, and the arrow keys move between them. */}
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-bg p-1" role="radiogroup" aria-label="Reported"
                onKeyDown={(e) => {
                  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
                  if (!step) return
                  e.preventDefault()
                  const next = (TIME_RANGES.findIndex((t) => t.days === days) + step + TIME_RANGES.length) % TIME_RANGES.length
                  const t = TIME_RANGES[next]
                  setParam('days', t.days === null ? null : String(t.days))
                  e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
                }}>
                {TIME_RANGES.map((t) => (
                  <button key={t.label} role="radio" aria-checked={days === t.days} tabIndex={days === t.days ? 0 : -1}
                    onClick={() => setParam('days', t.days === null ? null : String(t.days))}
                    className={clsx('rounded-md py-1 text-xs font-semibold', days === t.days ? 'bg-card shadow-sm' : 'text-muted hover:text-ink')}>
                    {t.label}
                  </button>
                ))}
              </div>
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
        disabled={locating}
        aria-label="Go to my location"
        title="Go to my location"
        className="card absolute right-3 top-3 z-[500] grid size-11 place-items-center shadow-lg hover:bg-card-hover"
      >
        {locating ? <Spinner className="size-5" /> : <LocateFixed className="size-5" />}
      </button>
      <button
        onClick={shareLink}
        aria-label="Copy a link to this map view"
        title="Copy a link to this map view"
        className="card absolute right-3 top-16 z-[500] grid size-11 place-items-center shadow-lg hover:bg-card-hover"
      >
        <Link2 className="size-5" />
      </button>

      {selectedHex && mode === 'hex' && (
        <div className="absolute inset-x-3 bottom-3 z-[650] md:inset-x-auto md:bottom-auto md:right-3 md:top-28 md:w-80">
          <HexPanel
            days={days}
            cell={selectedHex}
            cellM={cellM}
            mostly={categoryName(selectedHex.top_category)}
            category={category}
            categories={categories}
            onOpenIssue={openIssue}
            onShowPins={() => {
              setFocus({ ...hexCenter(selectedHex), zoom: 18 })
              setSelectedHex(null)
              // With every pin type unticked the pins map would be empty: go back to the default (validated) pins.
              updateParams({ mode: 'pins', ...(layers.length === 0 ? { pins: null } : {}) })
            }}
            onClose={() => setSelectedHex(null)}
          />
        </div>
      )}

      {pin && !(selectedHex && mode === 'hex') && (
        <div className="absolute inset-x-3 bottom-3 z-[600] md:inset-x-auto md:bottom-auto md:right-3 md:top-28 md:w-80">
          <AreaPanel
            days={days}
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

      {query.isError && !query.isFetching && (
        <div className={clsx('absolute inset-x-0 bottom-6 z-[500] flex justify-center px-3', (pin || selectedHex) && 'hidden md:flex')}>
          <p role="alert" className="card flex max-w-sm items-center gap-3 px-4 py-2.5 text-sm shadow-lg">
            <span>Could not load the map data. {(query.error as Error).message}</span>
            <button className="btn-soft shrink-0 px-3 py-1 text-xs" onClick={() => query.refetch()}>Retry</button>
          </p>
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
          <p className="mb-1.5 font-semibold">Heat score per hexagon ({formatDistance(cellM)} sides)</p>
          <div className="flex">
            {HEX_COLORS.map((c) => <span key={c} className="h-3 w-9" style={{ background: c }} />)}
          </div>
          <div className="flex justify-between text-muted">
            <span>low</span>
            <span>{hexMaxWeight(result.data).toFixed(1)}</span>
          </div>
          <p className="mt-1 text-muted">Breaks: {hexBreaks(result.data).map(formatBreak).join(' · ')}</p>
        </div>
      )}
      {result?.kind === 'heat' && mode === 'heat' && result.data.length > 0 && (
        <div className={clsx('card absolute bottom-6 left-3 z-[500] p-3 text-xs shadow-lg', pin && 'hidden md:block')}>
          <p className="mb-1.5 font-semibold">Issue intensity</p>
          <div className="h-3 w-44 rounded" style={{ background: HEAT_LEGEND_CSS }} />
          <div className="flex justify-between text-muted"><span>low</span><span>high</span></div>
        </div>
      )}

      <Modal open={help} onClose={() => setHelp(false)} title="How the heatmap works">
        <div className="space-y-3 text-sm">
          <p><strong>Which issues count:</strong> only issues the community has <em>validated</em> and that are not fixed yet
            (validated, assigned, in progress, fix awaiting confirmation). Unverified posts, hidden fakes and resolved issues are excluded,
            so the map shows real, current problems.</p>
          <p><strong>Time filter:</strong> "Last 7 days" or "Last 30 days" in Filters keeps only issues <em>reported</em> in that time.
            The hexagon lists and the dropped pin's summary use the same filter, so their numbers always match the map.</p>
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
            is the sum of its issues' heat. Hexagon size adapts to zoom and is corrected for map projection, so a 220 m hexagon is
            really 220 m on the ground in Dhaka.</p>
          <p><strong>Heat</strong> is a smooth blur of the same weighted points — nicer looking but less precise. <strong>Pins</strong> show
            individual issues, clustered when zoomed out.</p>
          <p><strong>Location accuracy:</strong> GPS pins worse than ±{settings?.max_gps_accuracy_m ?? 100} m are rejected unless the reporter
            places the pin by hand, and pins outside Bangladesh are refused.</p>
        </div>
      </Modal>
    </div>
  )
}
