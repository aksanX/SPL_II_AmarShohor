import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { type Boundary } from '@/models'
import { type LatLng } from '@/features/map/lib/outline'

/** Moves the map to what was picked: a search result (its outline, or just the place), or a set of thanas. */
export function MoveTo({ target, fit }: { target: Boundary | null; fit: LatLng[] | null }) {
  const map = useMap()
  useEffect(() => {
    if (target?.ring) map.fitBounds(target.ring, { padding: [20, 20] })
    else if (target) map.setView(target.center, 13)
  }, [map, target])
  useEffect(() => {
    if (fit?.length) map.fitBounds(fit, { padding: [20, 20] })
  }, [map, fit])
  return null
}
