import { Circle, Marker, Tooltip } from 'react-leaflet'
import L from '@/features/map/lib/leaflet'

const searchIcon = L.divIcon({
  className: '',
  html: '<div class="search-pin"><span></span></div>',
  iconSize: [34, 34],
  iconAnchor: [17, 34],
})

/** The searched / dropped point: drag it to refine; the circle is the area the summary describes. */
export function SearchPinLayer({ lat, lng, radiusM, label, onMove }: {
  lat: number
  lng: number
  radiusM: number
  /** Place name shown above the pin, like Google Maps. */
  label: string | null
  onMove: (lat: number, lng: number) => void
}) {
  return (
    <>
      <Circle
        center={[lat, lng]}
        radius={radiusM}
        interactive={false}
        pathOptions={{ color: '#1a6fd1', weight: 1.5, dashArray: '6 6', fillColor: '#1a6fd1', fillOpacity: 0.06 }}
      />
      <Marker
        position={[lat, lng]}
        icon={searchIcon}
        draggable
        zIndexOffset={1000}
        eventHandlers={{
          dragend: (e) => {
            const p = (e.target as L.Marker).getLatLng()
            onMove(p.lat, p.lng)
          },
        }}
      >
        {label && (
          // Keyed by label: react-leaflet doesn't update a permanent tooltip's text in place.
          <Tooltip key={label} permanent direction="top" offset={[0, -34]} className="search-pin-label">
            {label}
          </Tooltip>
        )}
      </Marker>
    </>
  )
}
