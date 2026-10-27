// The city thana outlines (public/data, from geoBoundaries) and guessing which ones belong to a City Corporation.
import { areaLabel } from '@/features/city-corp/lib/areaLabel'
import { areaKeys } from '@/features/map/components/area-drawer/areaNames'
import type { LatLng } from '@/features/map/lib/outline'

/** One thana of a city that has them (Dhaka, Chattogram, Khulna, Rajshahi). `area`: the City Corporation area it suggests. */
export interface Thana { name: string; area: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }

let thanasLoading: Promise<Thana[]> | null = null

/** The thana outlines in public/data (from geoBoundaries), fetched the first time the picker opens. */
export function loadThanas(): Promise<Thana[]> {
  thanasLoading ??= fetch(`${import.meta.env.BASE_URL}data/city-thanas.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`thanas ${r.status}`)
      return r.json() as Promise<{ thanas: Thana[] }>
    })
    .then((j) => j.thanas)
  thanasLoading.catch(() => { thanasLoading = null })  // try again next time
  return thanasLoading
}

export const thanaKey = (t: Thana) => `${t.area}:${t.name}`

/** A thana's polygons as Leaflet [lat, lng] rings. */
export const thanaPositions = (g: Thana['geometry']): LatLng[][][] =>
  (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((poly) => poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as LatLng)))

/** The thana area that matches the City Corporation being edited, e.g. "Dhaka North City Corporation" -> "Dhaka North". */
export function guessArea(name: string, areas: string[]): string | undefined {
  const n = areaLabel(name).toLowerCase()
  if (!n) return undefined
  return areas.find((a) => areaKeys(a).some((k) => n.includes(k)))
}
