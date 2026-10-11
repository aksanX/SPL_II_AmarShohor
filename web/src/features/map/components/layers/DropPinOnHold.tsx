import { useMapEvents } from 'react-leaflet'

/** Right-click (desktop) or long-press (phone) anywhere on the map drops the search pin there. */
export function DropPinOnHold({ onDrop }: { onDrop: (lat: number, lng: number) => void }) {
  useMapEvents({ contextmenu: (e) => onDrop(e.latlng.lat, e.latlng.lng) })
  return null
}
