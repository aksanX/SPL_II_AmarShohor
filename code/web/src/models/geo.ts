// Places and positions: a GPS fix, a searched place and an area outline found by name.

/** A GPS fix: where the device is and how sure it is, in metres. */
export interface Position {
  lat: number
  lng: number
  accuracy: number
}

/** An area found by name: its official outline from OpenStreetMap as [lat, lng] corners, if OSM has one. */
export interface Boundary {
  name: string
  detail: string
  /** null: OSM only knows where the place is (most city corporations), so the outline is drawn by hand. */
  ring: [number, number][] | null
  center: [number, number]
}

/** A searched place (a road, building or area) from OpenStreetMap. */
export interface Place {
  name: string
  detail: string
  lat: number
  lng: number
  /** [south, west, north, east] when the place is an area (e.g. a neighbourhood), so the map can fit it. */
  bbox: [number, number, number, number] | null
  /** A neighbourhood, sector or city rather than one spot: the user still has to tap the exact place. */
  isArea: boolean
  /** Warning shown under the result, e.g. when it doesn't match part of what was typed. */
  note?: string
  /** House number the user typed ("House 12"). OSM rarely has them, so it's kept for the address text only. */
  house?: string
}
