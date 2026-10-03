import { useEffect } from 'react'
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { DHAKA } from '../../lib/geo'
import { TILE_ATTRIBUTION, TILE_URL, pinIcon } from '../../lib/leaflet'

const icon = pinIcon('#e5383b')

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lng], Math.max(map.getZoom(), 17))
  }, [lat, lng, map])
  return null
}

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

/** Map where the user taps or drags the pin to the exact spot. */
export function LocationPicker({ value, accuracy, onPick, height = 280 }: {
  value: { lat: number; lng: number } | null
  accuracy?: number | null
  onPick: (lat: number, lng: number) => void
  height?: number
}) {
  const center = value ?? DHAKA
  return (
    <div className="overflow-hidden rounded-lg border border-line" style={{ height }}>
      <MapContainer center={[center.lat, center.lng]} zoom={value ? 17 : 12} className="size-full" scrollWheelZoom>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <ClickToPlace onPick={onPick} />
        {value && (
          <>
            <Recenter lat={value.lat} lng={value.lng} />
            <Marker
              position={[value.lat, value.lng]}
              icon={icon}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const p = e.target.getLatLng()
                  onPick(p.lat, p.lng)
                },
              }}
            />
            {accuracy ? (
              <Circle center={[value.lat, value.lng]} radius={accuracy} pathOptions={{ color: '#1a6fd1', weight: 1, fillOpacity: 0.1 }} />
            ) : null}
          </>
        )}
      </MapContainer>
    </div>
  )
}

/** Read-only map showing one issue. */
export function MiniMap({ lat, lng, color, height = 220 }: { lat: number; lng: number; color: string; height?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line" style={{ height }}>
      <MapContainer center={[lat, lng]} zoom={16} className="size-full" scrollWheelZoom={false}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <Marker position={[lat, lng]} icon={pinIcon(color)} />
      </MapContainer>
    </div>
  )
}
