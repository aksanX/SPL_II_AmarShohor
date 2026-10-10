// The map's calculations, kept apart from React and Leaflet so they can be unit tested on their own.
import { distanceM } from './geo'
import type { HeatPoint, HexCell, MapIssue, Severity } from './types'

// ---------- viewport ----------

export type MapMode = 'pins' | 'hex' | 'heat'

/** Real-world hexagon edge length in metres for each Leaflet zoom level, so a hexagon is always a few dozen pixels wide. */
export function hexSizeForZoom(z: number) {
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

/** Radius choices for the circle around the search pin, in metres. */
export const RADII = [500, 1000, 2000, 5000] as const

/** Radius that roughly covers a searched area: half its diagonal, rounded up to one of the radius choices. */
export function radiusForBBox(b: [number, number, number, number] | null | undefined) {
  if (!b) return RADII[0]
  const half = distanceM({ lat: b[0], lng: b[1] }, { lat: b[2], lng: b[3] }) / 2
  return RADII.find((r) => r >= half) ?? RADII[RADII.length - 1]
}

// ---------- pin filters in the URL ----------

export type PinLayer = 'active' | 'unverified' | 'resolved'
export const PIN_LAYERS: readonly PinLayer[] = ['active', 'unverified', 'resolved']

/** ?pins= value → ticked pin types. No ?pins means the default (validated only); ?pins= with nothing ticked stays empty. */
export function parsePinLayers(param: string | null): PinLayer[] {
  if (param === null) return ['active']
  const parts = param.split(',')
  return PIN_LAYERS.filter((l) => parts.includes(l))
}

/** Ticked pin types → ?pins= value, or null for the default so plain links stay clean. Order and repeats don't matter. */
export function pinLayersParam(layers: readonly PinLayer[]): string | null {
  const ordered = PIN_LAYERS.filter((l) => layers.includes(l))
  return ordered.length === 1 && ordered[0] === 'active' ? null : ordered.join(',')
}

// ---------- time filter ----------

/** Time choices in the Filters panel. days = only issues reported in the last N days; null = all time. */
export const TIME_RANGES = [
  { days: null, label: 'All time' },
  { days: 30, label: 'Last 30 days' },
  { days: 7, label: 'Last 7 days' },
] as const

export type TimeRange = (typeof TIME_RANGES)[number]['days']

/** ?days= value → a time choice. Anything else (missing, typo, an edited link) means all time. */
export function parseDays(param: string | null): TimeRange {
  return TIME_RANGES.find((t) => t.days !== null && String(t.days) === param)?.days ?? null
}

// ---------- counting ----------

export type MapResult =
  | { kind: 'pins'; data: MapIssue[] }
  | { kind: 'hex'; data: HexCell[] }
  | { kind: 'heat'; data: HeatPoint[] }

/** "N issues in view". Hexagons and heat points each merge several issues, so their counts are added up. */
export function countInView(result: MapResult | undefined) {
  if (!result) return 0
  if (result.kind === 'hex') return result.data.reduce((s, c) => s + c.issue_count, 0)
  // A database without 0027 sends no issue_count: count each point as one issue, as before.
  if (result.kind === 'heat') return result.data.reduce((s, p) => s + (p.issue_count ?? 1), 0)
  return result.data.length
}

// ---------- hexagon colours ----------

/** Sequential palette (light → dark red) for hexagon intensity. */
export const HEX_COLORS = ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15']

/**
 * Upper limits of the first four colours: 10%, 25%, 50% and 75% of the hottest hexagon.
 * Exact, not rounded: rounding put a hexagon right on a limit into the wrong colour. Round only for display (formatBreak).
 */
export function hexBreaks(cells: HexCell[]) {
  const max = Math.max(...cells.map((c) => Number(c.weight)), 0)
  return [0.1, 0.25, 0.5, 0.75].map((f) => max * f)
}

/** A colour limit for the legend: 2 decimals under 1, so small limits don't all read "0.1". */
export const formatBreak = (b: number) => (b < 1 ? b.toFixed(2) : b.toFixed(1))

/** The most pins map_issues returns for one view (its `limit`, migration 0013). */
export const MAX_PINS = 2000

/** True when Pins mode got as many pins as the database sends, so some may be missing. */
export const pinsCapped = (result: MapResult | undefined) => result?.kind === 'pins' && result.data.length >= MAX_PINS

export function hexColor(weight: number, breaks: number[]) {
  const idx = breaks.findIndex((b) => weight <= b)
  return HEX_COLORS[idx === -1 ? HEX_COLORS.length - 1 : idx]
}

/** The hexagon grid is fixed for a given size, so a hexagon's first corners identify it across results. */
export const hexKey = (c: HexCell) =>
  c.hex.coordinates[0].slice(0, 2).map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';')

/** Ray casting: is the point inside the hexagon? Matches the server, which puts each issue in exactly one hexagon. */
export function insidePolygon(lat: number, lng: number, ring: GeoJSON.Position[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Middle of a hexagon (the closing corner, a repeat of the first, is left out). */
export function hexCenter(cell: HexCell) {
  const ring = cell.hex.coordinates[0].slice(0, -1)
  return {
    lat: ring.reduce((s, p) => s + p[1], 0) / ring.length,
    lng: ring.reduce((s, p) => s + p[0], 0) / ring.length,
  }
}

/** Distance from a hexagon's middle to its corners, in metres (the same as its edge length). */
export function hexRadiusM(cell: HexCell) {
  const [lng, lat] = cell.hex.coordinates[0][0]
  return distanceM(hexCenter(cell), { lat, lng })
}

/** How exactly to name a hexagon: a neighbourhood fits a small one; a big one only gets its district or city. */
export const hexNameDetail = (cell: HexCell): 'neighbourhood' | 'district' =>
  hexRadiusM(cell) <= 1500 ? 'neighbourhood' : 'district'

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 }

/** A hexagon's issues: only the ones inside it, worst first, then the best confirmed, then the most upvoted. */
export function hexIssues(issues: MapIssue[], ring: GeoJSON.Position[]) {
  return issues
    .filter((i) => insidePolygon(i.lat, i.lng, ring))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
      || b.confirmation_count - a.confirmation_count || b.upvote_count - a.upvote_count)
}

// ---------- pins and heat ----------

/** Everything a pin's icon and popup show: a pin is only rebuilt when one of these changes. */
export const pinSignature = (i: MapIssue) =>
  [i.lat, i.lng, i.status, i.title, i.category_color, i.upvote_count, i.confirmation_count, i.thumb_path, i.thumb_type].join('|')

/** Heat intensity cap: twice the 95th percentile weight (at least 1), so one hotspot can't wash out the rest. */
export function heatMax(points: HeatPoint[]) {
  const weights = points.map((p) => Number(p.weight)).sort((a, b) => a - b)
  const p95 = weights.length ? weights[Math.floor(weights.length * 0.95)] : 1
  return Math.max(p95 * 2, 1)
}

// ---------- area summary ----------

// Heat per km² → plain-language level. One typical validated issue (medium severity, a little evidence)
// is worth about 3 heat, so "moderate" ≈ a couple of active issues per km².
export const HEAT_LEVELS = [
  { max: 0, label: 'No active issues', color: '#9ca3af' },
  { max: 1.5, label: 'Low', color: HEX_COLORS[1] },
  { max: 5, label: 'Moderate', color: HEX_COLORS[2] },
  { max: 12, label: 'High', color: HEX_COLORS[3] },
  { max: Infinity, label: 'Severe', color: HEX_COLORS[4] },
]

/** Level for an area. Rounded heat per km² can be 0.00 for one small issue in a big circle, so the count decides "none". */
export function areaLevel(active: number, heatPerKm2: number) {
  if (active === 0) return HEAT_LEVELS[0]
  const perKm2 = Math.max(heatPerKm2, 0.01)
  return HEAT_LEVELS.find((l) => perKm2 <= l.max)!
}

// ---------- drawing a City Corporation's area ----------

export type LatLng = [number, number]

/** Outer ring of the first polygon, as Leaflet [lat, lng] points (closing point dropped). */
export function ringFromGeoJSON(area: GeoJSON.MultiPolygon | GeoJSON.Polygon | null | undefined): LatLng[] {
  if (!area) return []
  const ring = area.type === 'MultiPolygon' ? area.coordinates[0]?.[0] : area.coordinates[0]
  return (ring ?? []).slice(0, -1).map(([lng, lat]) => [lat, lng])
}

export function polygonFromRing(points: LatLng[]): GeoJSON.Polygon {
  const ring = points.map(([lat, lng]) => [lng, lat])
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] }
}
