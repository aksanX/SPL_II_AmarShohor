// Hexagons: their colours, identity, middle and size, and which issues fall inside one.
import { distanceM } from '@/shared/geo/distance'
import type { HexCell, MapIssue, Severity } from '@/models'

/** Sequential palette (light → dark red) for hexagon intensity. */
export const HEX_COLORS = ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15']

/**
 * Upper limits of the first four colours: 10%, 25%, 50% and 75% of the hottest hexagon.
 * Exact, not rounded: rounding put a hexagon right on a limit into the wrong colour. Round only for display (formatBreak).
 */
export function hexBreaks(cells: HexCell[]) {
  const max = hexMaxWeight(cells)
  return [0.1, 0.25, 0.5, 0.75].map((f) => max * f)
}

/** Heat of the hottest hexagon (0 with none); the top of the legend. */
export const hexMaxWeight = (cells: HexCell[]) => cells.reduce((m, c) => Math.max(m, Number(c.weight) || 0), 0)

/** A colour limit for the legend: 2 decimals under 1, so small limits don't all read "0.1". */
export const formatBreak = (b: number) => (b < 1 ? b.toFixed(2) : b.toFixed(1))

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
