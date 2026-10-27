import { MapContainer, Marker, TileLayer } from 'react-leaflet'
import L, { TILE_ATTRIBUTION, TILE_URL, pinIcon } from '@/features/map/lib/leaflet'

/** Read-only map showing one issue. */
export function MiniMap({ lat, lng, color, height = 220 }: { lat: number; lng: number; color: string; height?: number }) {
  return (
    <div className="isolate overflow-hidden rounded-lg border border-line" style={{ height }}>
      {/* On phones a one-finger swipe scrolls the page instead of getting stuck panning this small map. */}
      <MapContainer center={[lat, lng]} zoom={16} className="size-full" scrollWheelZoom={false} dragging={!L.Browser.mobile}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <Marker position={[lat, lng]} icon={pinIcon(color)} />
      </MapContainer>
    </div>
  )
}
