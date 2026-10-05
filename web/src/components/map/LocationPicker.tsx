import { MousePointerClick, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { DHAKA, type Place } from '../../lib/geo'
import { TILE_ATTRIBUTION, TILE_URL, pinIcon } from '../../lib/leaflet'
import { MapSearch } from './MapSearch'

const icon = pinIcon('#e5383b')

/**
 * Brings the pin into view when it comes from GPS or search (off-screen, or the map is zoomed out).
 * A tap or drag on a zoomed-in map leaves the view alone, so the map doesn't jump under the finger.
 */
function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    if (map.getZoom() < 16 || !map.getBounds().pad(-0.1).contains([lat, lng])) {
      map.setView([lat, lng], Math.max(map.getZoom(), 17))
    }
  }, [lat, lng, map])
  return null
}

/** Shows a searched area (e.g. "Uttara") whole, so the user can find and tap the exact spot inside it. */
function ShowArea({ area }: { area: Place }) {
  const map = useMap()
  useEffect(() => {
    const b = area.bbox
    if (b) map.flyToBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [20, 20], maxZoom: 17 })
    else map.flyTo([area.lat, area.lng], 15)
  }, [area, map])
  return null
}

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

/**
 * Map where the user searches for a place, then taps or drags the pin to the exact spot.
 * `label` is set when the pin came from a search result (the place's name and area).
 * A searched road or building drops the pin on it. A searched area (a neighbourhood or sector) only moves the
 * map there: its centre is not where the problem is, so the user taps the spot.
 */
export function LocationPicker({ value, accuracy, onPick, height = 280 }: {
  value: { lat: number; lng: number } | null
  accuracy?: number | null
  onPick: (lat: number, lng: number, label?: string) => void
  height?: number
}) {
  const center = value ?? DHAKA
  const [area, setArea] = useState<Place | null>(null)
  const place = (lat: number, lng: number, label?: string) => {
    setArea(null)
    onPick(lat, lng, label)
  }

  return (
    <div className="space-y-2">
      <MapSearch
        // Favour places around the current pin (or Dhaka before one is placed).
        near={{ minLat: center.lat - 0.05, maxLat: center.lat + 0.05, minLng: center.lng - 0.05, maxLng: center.lng + 0.05 }}
        includeIssues={false}
        className="border border-line"
        placeholder="Search a road, landmark or area, e.g. Road 12 Sector 7 Uttara"
        onPick={(o) => {
          if (o.kind === 'coords') return place(o.lat, o.lng)
          if (o.kind !== 'place') return
          if (o.place.isArea) return setArea(o.place)
          place(o.place.lat, o.place.lng, [o.place.house, o.place.name, o.place.detail].filter(Boolean).join(', '))
        }}
      />
      <div className="relative isolate overflow-hidden rounded-lg border border-line" style={{ height }}>
        <MapContainer center={[center.lat, center.lng]} zoom={value ? 17 : 12} className="size-full" scrollWheelZoom>
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
          <ClickToPlace onPick={(lat, lng) => place(lat, lng)} />
          {area && <ShowArea area={area} />}
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
                    place(p.lat, p.lng)
                  },
                }}
              />
              {accuracy ? (
                <Circle center={[value.lat, value.lng]} radius={accuracy} pathOptions={{ color: '#1a6fd1', weight: 1, fillOpacity: 0.1 }} />
              ) : null}
            </>
          )}
        </MapContainer>
        {area && (
          <div className="pointer-events-none absolute inset-x-2 top-2 z-[1000] flex justify-center">
            <p className="pointer-events-auto flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-xs font-semibold shadow-lg">
              <MousePointerClick className="size-4 shrink-0 text-brand" />
              Now tap the exact spot in {area.name}
              <button type="button" onClick={() => setArea(null)} aria-label="Dismiss" className="text-muted hover:text-ink">
                <X className="size-3.5" />
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}


/** Read-only map showing one issue. */
export function MiniMap({ lat, lng, color, height = 220 }: { lat: number; lng: number; color: string; height?: number }) {
  return (
    <div className="isolate overflow-hidden rounded-lg border border-line" style={{ height }}>
      <MapContainer center={[lat, lng]} zoom={16} className="size-full" scrollWheelZoom={false}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        <Marker position={[lat, lng]} icon={pinIcon(color)} />
      </MapContainer>
    </div>
  )
}
