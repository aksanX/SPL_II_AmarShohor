import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { distanceM } from '@/shared/geo/distance'

/** Where the map should move to. `bbox` is [south, west, north, east] for areas, so a whole neighbourhood fits. */
export interface Focus { lat: number; lng: number; bbox?: [number, number, number, number] | null; zoom?: number }

export function FocusController({ target }: { target: Focus | null }) {
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
