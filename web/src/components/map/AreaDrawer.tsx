import { Eraser, Undo2 } from 'lucide-react'
import { CircleMarker, MapContainer, Polygon, TileLayer, useMapEvents } from 'react-leaflet'
import { DHAKA } from '../../lib/geo'
import type { LatLng } from '../../lib/mapMath'
import { TILE_ATTRIBUTION, TILE_URL } from '../../lib/leaflet'

function ClickToAdd({ onAdd }: { onAdd: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onAdd([e.latlng.lat, e.latlng.lng]) })
  return null
}

/** Tap the map to outline a service area, corner by corner. */
export function AreaDrawer({ points, onChange, others = [], height = 360 }: {
  points: LatLng[]
  onChange: (points: LatLng[]) => void
  others?: { name: string; ring: LatLng[] }[]
  height?: number
}) {
  const start = points[0] ?? [DHAKA.lat, DHAKA.lng]
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-line" style={{ height }}>
        <MapContainer center={start} zoom={12} className="size-full" scrollWheelZoom>
          <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
          <ClickToAdd onAdd={(p) => onChange([...points, p])} />
          {others.map((o) => (
            <Polygon key={o.name} positions={o.ring} pathOptions={{ color: '#64748b', weight: 1, fillOpacity: 0.05, dashArray: '4' }} />
          ))}
          {points.length >= 3 && <Polygon positions={points} pathOptions={{ color: '#b45309', weight: 2, fillOpacity: 0.15 }} />}
          {points.map((p, i) => (
            <CircleMarker key={i} center={p} radius={5} pathOptions={{ color: '#b45309', fillOpacity: 1 }} />
          ))}
        </MapContainer>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="mr-auto text-muted">
          Tap the map to add corners ({points.length} so far{points.length < 3 ? ', need at least 3' : ''}). Grey dashed areas belong to other City Corporations.
        </span>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={!points.length} onClick={() => onChange(points.slice(0, -1))}>
          <Undo2 className="size-3.5" /> Undo
        </button>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={!points.length} onClick={() => onChange([])}>
          <Eraser className="size-3.5" /> Clear
        </button>
      </div>
    </div>
  )
}
