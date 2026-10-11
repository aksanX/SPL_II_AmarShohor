import { useMapEvents } from 'react-leaflet'
import type { LatLng } from '@/features/map/lib/outline'

export function ClickToAdd({ onAdd }: { onAdd: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onAdd([e.latlng.lat, e.latlng.lng]) })
  return null
}
