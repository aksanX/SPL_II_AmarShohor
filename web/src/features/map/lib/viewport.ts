// The map's view: hexagon size per zoom, keeping the view inside real coordinates, the dropped pin and its radius.
import { distanceM } from '@/shared/geo/distance'

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

type Box = { minLng: number; minLat: number; maxLng: number; maxLat: number }

/**
 * Keeps a viewport inside real coordinates. Zoomed far out (or with the 15% padding near the edge of the world),
 * Leaflet reports longitudes past ±180, and PostGIS refuses those for geography ("out of range"), so the map broke.
 */
export const clampBBox = (b: Box): Box => ({
  minLng: Math.max(b.minLng, -180), minLat: Math.max(b.minLat, -90),
  maxLng: Math.min(b.maxLng, 180), maxLat: Math.min(b.maxLat, 90),
})

/**
 * The dropped pin from the link (?lat=&lng=), or null when it is missing or not a real place.
 * Number('') is 0, so an empty ?lat= used to put the pin in the sea at 0, 0.
 */
export function parsePin(lat: string | null, lng: string | null): { lat: number; lng: number } | null {
  if (!lat?.trim() || !lng?.trim()) return null
  const p = { lat: Number(lat), lng: Number(lng) }
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 ? p : null
}

/** Radius choices for the circle around the search pin, in metres. */
export const RADII = [500, 1000, 2000, 5000] as const

/** Radius that roughly covers a searched area: half its diagonal, rounded up to one of the radius choices. */
export function radiusForBBox(b: [number, number, number, number] | null | undefined) {
  if (!b) return RADII[0]
  const half = distanceM({ lat: b[0], lng: b[1] }, { lat: b[2], lng: b[3] }) / 2
  return RADII.find((r) => r >= half) ?? RADII[RADII.length - 1]
}
