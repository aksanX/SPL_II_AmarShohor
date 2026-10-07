import { useEffect, useRef } from 'react'
import { Circle, Marker, Polygon, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from '../../lib/leaflet'
import 'leaflet.heat'
import 'leaflet.markercluster'
import { STATUS_META } from '../../lib/format'
import { heatMax, hexBreaks, hexColor, hexKey, pinSignature } from '../../lib/mapMath'
import { mediaUrl } from '../../lib/supabase'
import type { HeatPoint, HexCell, MapIssue } from '../../lib/types'
import { pinIcon } from '../../lib/leaflet'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function pinMarker(i: MapIssue, onOpen: (id: string) => void) {
  const variant = i.status === 'community_review' ? 'unverified' : i.status === 'closed' ? 'resolved' : 'normal'
  const m = L.marker([i.lat, i.lng], { icon: pinIcon(i.category_color, variant) })
  const thumb = i.thumb_path && i.thumb_type === 'image'
    ? `<img src="${mediaUrl(i.thumb_path)}" style="width:100%;height:110px;object-fit:cover;border-radius:8px;margin-bottom:6px" />`
    : ''
  m.bindPopup(
    `<div style="width:200px">${thumb}<strong>${escapeHtml(i.title)}</strong><br/>
     <span style="font-size:12px;color:#65676b">${STATUS_META[i.status].label} · ▲ ${i.upvote_count} · ✓ ${i.confirmation_count}</span><br/>
     <a href="#" data-open="${i.id}" style="font-weight:600">Open issue →</a></div>`,
  )
  m.on('popupopen', (e) => {
    const link = (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLAnchorElement>('[data-open]')
    if (link) link.onclick = (ev) => { ev.preventDefault(); onOpen(i.id) }
  })
  return m
}

/**
 * Clustered pins: nearby markers merge into a numbered bubble when zoomed out.
 * One cluster group lives as long as the layer. A new result only adds the new pins and removes the ones
 * that left the view, so pins don't blink on every pan and an open popup stays open when the map moves
 * to fit it (that move loads a new result too).
 */
export function ClusterLayer({ issues, onOpen }: { issues: MapIssue[]; onOpen: (id: string) => void }) {
  const map = useMap()
  const groupRef = useRef<L.MarkerClusterGroup | null>(null)
  const markersRef = useRef(new Map<string, { marker: L.Marker; sig: string }>())
  const onOpenRef = useRef(onOpen)
  useEffect(() => { onOpenRef.current = onOpen }, [onOpen])

  useEffect(() => {
    const group = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 50,
      iconCreateFunction: (cluster) => {
        const n = cluster.getChildCount()
        const size = n < 10 ? 34 : n < 100 ? 42 : 50
        return L.divIcon({
          html: `<div class="marker-cluster-custom" style="width:${size}px;height:${size}px">${n}</div>`,
          className: '',
          iconSize: [size, size],
        })
      },
    })
    const markers = markersRef.current
    groupRef.current = group
    map.addLayer(group)
    return () => {
      map.removeLayer(group)
      groupRef.current = null
      markers.clear()
    }
  }, [map])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const markers = markersRef.current
    const seen = new Set<string>()
    const added: L.Marker[] = []
    const removed: L.Marker[] = []
    for (const i of issues) {
      seen.add(i.id)
      const sig = pinSignature(i)
      const old = markers.get(i.id)
      if (old?.sig === sig) continue
      if (old) removed.push(old.marker)
      const marker = pinMarker(i, (id) => onOpenRef.current(id))
      markers.set(i.id, { marker, sig })
      added.push(marker)
    }
    for (const [id, { marker }] of markers) {
      if (!seen.has(id)) {
        removed.push(marker)
        markers.delete(id)
      }
    }
    if (removed.length) group.removeLayers(removed)
    if (added.length) group.addLayers(added)
  }, [issues])

  return null
}

const HEAT_OPTIONS = {
  radius: 22,
  blur: 18,
  maxZoom: 16,
  minOpacity: 0.25,
  gradient: { 0.2: '#2c7bb6', 0.4: '#abd9e9', 0.6: '#ffffbf', 0.8: '#fdae61', 1: '#d7191c' },
}

/**
 * Smooth kernel heat layer. Intensity is capped at the 95th percentile so one hotspot can't wash out the rest.
 * The same layer is kept and its points swapped in place, so the blur doesn't flash on every pan.
 */
export function HeatLayer({ points }: { points: HeatPoint[] }) {
  const map = useMap()
  const layerRef = useRef<L.HeatLayer | null>(null)

  useEffect(() => {
    const layer = L.heatLayer([], HEAT_OPTIONS)
    layerRef.current = layer
    map.addLayer(layer)
    return () => {
      map.removeLayer(layer)
      layerRef.current = null
    }
  }, [map])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.setOptions({ ...HEAT_OPTIONS, max: heatMax(points) })
    layer.setLatLngs(points.map((p) => [p.lat, p.lng, Number(p.weight)] as [number, number, number]))
  }, [points])

  return null
}

/**
 * Hexagon grid: every validated open issue counted once in the hexagon that contains it.
 * Hexagons that stay in view are only recoloured; new ones fade in and ones that left the view are removed,
 * so the grid doesn't pop on every pan.
 */
export function HexLayer({ cells, selected, onSelect }: {
  cells: HexCell[]
  /** The hexagon whose issues are listed, outlined on the map. */
  selected: HexCell | null
  onSelect: (cell: HexCell) => void
}) {
  const map = useMap()
  const groupRef = useRef<L.FeatureGroup | null>(null)
  const shapesRef = useRef(new Map<string, { shape: L.Polygon; cell: HexCell }>())
  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])

  useEffect(() => {
    const group = L.featureGroup().addTo(map)
    const shapes = shapesRef.current
    groupRef.current = group
    return () => {
      group.remove()
      groupRef.current = null
      shapes.clear()
    }
  }, [map])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const shapes = shapesRef.current
    const breaks = hexBreaks(cells)
    const seen = new Set<string>()
    for (const cell of cells) {
      const key = hexKey(cell)
      seen.add(key)
      const style = { color: '#7f1d1d', weight: 0.6, fillColor: hexColor(Number(cell.weight), breaks), fillOpacity: 0.62 }
      const old = shapes.get(key)
      if (old) {
        old.cell = cell
        old.shape.setStyle(style)
        continue
      }
      const shape = L.polygon(
        cell.hex.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]),
        { ...style, className: 'hex-cell-new' },
      )
      const entry = { shape, cell }
      shape.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        onSelectRef.current(entry.cell)
      })
      shapes.set(key, entry)
      group.addLayer(shape)
    }
    for (const [key, { shape }] of shapes) {
      if (!seen.has(key)) {
        group.removeLayer(shape)
        shapes.delete(key)
      }
    }
  }, [cells])

  return selected && (
    <Polygon
      positions={selected.hex.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number])}
      interactive={false}
      pathOptions={{ color: '#1a6fd1', weight: 3, fill: false }}
    />
  )
}

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

/** Right-click (desktop) or long-press (phone) anywhere on the map drops the search pin there. */
export function DropPinOnHold({ onDrop }: { onDrop: (lat: number, lng: number) => void }) {
  useMapEvents({ contextmenu: (e) => onDrop(e.latlng.lat, e.latlng.lng) })
  return null
}
