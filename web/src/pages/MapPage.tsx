import { keepPreviousData, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Flame, Hexagon, Info, Layers, LocateFixed, MapPin, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ClusterLayer, HEX_COLORS, HeatLayer, HexLayer, hexBreaks } from '../components/map/layers'
import { Modal, Spinner } from '../components/ui'
import { useAppSettings, useCategories } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getHeatmapHex, getHeatmapPoints, getMapIssues, type BBox } from '../lib/api'
import { DHAKA, getCurrentPosition } from '../lib/geo'
import { TILE_ATTRIBUTION, TILE_URL } from '../lib/leaflet'

type Mode = 'pins' | 'hex' | 'heat'

// Real-world hexagon edge length for each zoom level, so a hexagon is always a few dozen pixels wide.
function hexSizeForZoom(z: number) {
  if (z <= 10) return 2000
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
      zoom: map.getZoom(),
      bbox: { minLng: r(b.getWest()), minLat: r(b.getSouth()), maxLng: r(b.getEast()), maxLat: r(b.getNorth()) },
    })
  }, [map, onChange])
  useEffect(() => { emit() }, [emit])
  useMapEvents({ moveend: emit, zoomend: emit })
  return null
}

function FlyTo({ target }: { target: { lat: number; lng: number } | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 15)
  }, [target, map])
  return null
}

export function MapPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const categoriesQuery = useCategories()
  const categories = useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data])
  const settings = useAppSettings().data

  const mode = (params.get('mode') as Mode) || 'hex'
  const category = params.get('category')
  const [layers, setLayers] = useState<string[]>(['active'])
  const [view, setView] = useState<Viewport | null>(null)
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [help, setHelp] = useState(false)

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v === null) next.delete(k)
    else next.set(k, v)
    setParams(next, { replace: true })
  }

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
  const categoryName = useCallback(
    (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug,
    [categories],
  )

  async function locate() {
    setLocating(true)
    try {
      const p = await getCurrentPosition()
      setFlyTarget({ lat: p.lat, lng: p.lng })
    } catch (e) {
      toast.error(e)
    } finally {
      setLocating(false)
    }
  }

  const count = result
    ? result.kind === 'hex'
      ? result.data.reduce((s, c) => s + c.issue_count, 0)
      : result.data.length
    : 0

  return (
    <div className="relative h-[calc(100dvh-56px-64px)] md:h-[calc(100dvh-56px)]">
      <MapContainer center={[DHAKA.lat, DHAKA.lng]} zoom={12} className="size-full" zoomControl={false}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <ViewportWatcher onChange={setView} />
        <FlyTo target={flyTarget} />
        {result?.kind === 'pins' && mode === 'pins' && <ClusterLayer issues={result.data} onOpen={openIssue} />}
        {result?.kind === 'hex' && mode === 'hex' && <HexLayer cells={result.data} categoryName={categoryName} />}
        {result?.kind === 'heat' && mode === 'heat' && <HeatLayer points={result.data} />}
      </MapContainer>

      {/* Controls */}
      <div className="absolute left-3 top-3 z-[500] w-[min(320px,calc(100%-24px))] space-y-2">
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
                {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
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
              ) : (
                <p className="flex items-start gap-1.5 text-xs text-muted">
                  <Layers className="mt-0.5 size-3.5 shrink-0" />
                  Only community-validated, still-open issues heat the map. Unverified, hidden and resolved issues never do.
                </p>
              )}
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

      {/* Legend */}
      {result?.kind === 'hex' && mode === 'hex' && result.data.length > 0 && (
        <div className="card absolute bottom-6 left-3 z-[500] p-3 text-xs shadow-lg">
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
      {mode === 'heat' && (
        <div className="card absolute bottom-6 left-3 z-[500] p-3 text-xs shadow-lg">
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
