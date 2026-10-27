// The City Corporation ward outlines (public/data, from geoBoundaries / BBS 2011).
import type { LatLng } from '@/features/map/lib/outline'

/**
 * One City Corporation ward as it was in 2011, with its 2011 number (Dhaka North and South, Chattogram, Khulna,
 * Rajshahi, Barishal, Sylhet). Wards added since are missing. `area`: the City Corporation it belongs to.
 */
export interface Ward { name: string; area: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }

let wardsLoading: Promise<Ward[]> | null = null

/** The ward outlines in public/data, fetched the first time the admin searches. */
export function loadWards(): Promise<Ward[]> {
  wardsLoading ??= fetch(`${import.meta.env.BASE_URL}data/city-wards.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`wards ${r.status}`)
      return r.json() as Promise<{ wards: Ward[] }>
    })
    .then((j) => j.wards)
  wardsLoading.catch(() => { wardsLoading = null })  // try again next time
  return wardsLoading
}

/** A ward's polygons as Leaflet [lat, lng] rings. */
export const wardPositions = (g: Ward['geometry']): LatLng[][][] =>
  (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((poly) => poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as LatLng)))

/** How many wards a list holds: a ward split in parts ("Ward 2 (part)") counts once. */
export const wardCount = (wards: Ward[]) => new Set(wards.map((w) => w.name.replace(' (part)', ''))).size

type Position = GeoJSON.Position

/** Ray casting: is [lng, lat] inside the ring? */
function inRing([x, y]: Position, ring: Position[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inShape(p: Position, g: Ward['geometry']) {
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  return polygons.some(([outer, ...holes]) => inRing(p, outer) && !holes.some((h) => inRing(p, h)))
}

/**
 * How much of a shape (0 to 1) the wards cover, from a 10 × 10 grid of points over it. Tells which thanas the
 * 2011 wards miss (in Dhaka, the areas added in 2016).
 */
export function shareInWards(g: Ward['geometry'], wards: Ward[]): number {
  const outer = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flatMap((poly) => poly[0])
  const xs = outer.map((p) => p[0])
  const ys = outer.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const grid = Array.from({ length: 100 }, (_, k): Position =>
    [x0 + ((x1 - x0) * ((k % 10) + 0.5)) / 10, y0 + ((y1 - y0) * (Math.floor(k / 10) + 0.5)) / 10])
  const inside = grid.filter((p) => inShape(p, g))
  if (!inside.length) return 0
  return inside.filter((p) => wards.some((w) => inShape(p, w.geometry))).length / inside.length
}
