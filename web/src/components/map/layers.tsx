import { useEffect } from 'react'
import { GeoJSON, useMap } from 'react-leaflet'
import L from '../../lib/leaflet'
import 'leaflet.heat'
import 'leaflet.markercluster'
import { STATUS_META } from '../../lib/format'
import { mediaUrl } from '../../lib/supabase'
import type { HeatPoint, HexCell, MapIssue } from '../../lib/types'
import { pinIcon } from '../../lib/leaflet'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Clustered pins: nearby markers merge into a numbered bubble when zoomed out. */
export function ClusterLayer({ issues, onOpen }: { issues: MapIssue[]; onOpen: (id: string) => void }) {
  const map = useMap()
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
    for (const i of issues) {
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
      group.addLayer(m)
    }
    map.addLayer(group)
    return () => {
      map.removeLayer(group)
    }
  }, [issues, map, onOpen])
  return null
}

/** Smooth kernel heat layer. Intensity is capped at the 95th percentile so one hotspot can't wash out the rest. */
export function HeatLayer({ points }: { points: HeatPoint[] }) {
  const map = useMap()
  useEffect(() => {
    const weights = points.map((p) => Number(p.weight)).sort((a, b) => a - b)
    const p95 = weights.length ? weights[Math.floor(weights.length * 0.95)] : 1
    const layer = L.heatLayer(
      points.map((p) => [p.lat, p.lng, Number(p.weight)] as [number, number, number]),
      {
        radius: 22,
        blur: 18,
        maxZoom: 16,
        max: Math.max(p95 * 2, 1),
        minOpacity: 0.25,
        gradient: { 0.2: '#2c7bb6', 0.4: '#abd9e9', 0.6: '#ffffbf', 0.8: '#fdae61', 1: '#d7191c' },
      },
    )
    map.addLayer(layer)
    return () => {
      map.removeLayer(layer)
    }
  }, [points, map])
  return null
}

// Sequential palette (light → dark red) for hexagon intensity.
export const HEX_COLORS = ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15']

export function hexBreaks(cells: HexCell[]) {
  const max = Math.max(...cells.map((c) => Number(c.weight)), 0)
  return [0.1, 0.25, 0.5, 0.75].map((f) => +(max * f).toFixed(1))
}

export function hexColor(weight: number, breaks: number[]) {
  const idx = breaks.findIndex((b) => weight <= b)
  return HEX_COLORS[idx === -1 ? HEX_COLORS.length - 1 : idx]
}

/** Hexagon grid: every validated open issue counted once in the hexagon that contains it. */
export function HexLayer({ cells, categoryName }: { cells: HexCell[]; categoryName: (slug: string) => string }) {
  const breaks = hexBreaks(cells)
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature',
      geometry: c.hex,
      properties: { weight: Number(c.weight), count: c.issue_count, top: c.top_category },
    })),
  }
  // Re-mount when data changes (GeoJSON layer is immutable in react-leaflet).
  const key = cells.map((c) => `${c.weight}:${c.issue_count}`).join('|').length + ':' + cells.length + ':' + breaks.join(',')
  return (
    <GeoJSON
      key={key}
      data={data}
      style={(f) => ({
        color: '#7f1d1d',
        weight: 0.6,
        fillColor: hexColor(f?.properties.weight ?? 0, breaks),
        fillOpacity: 0.62,
      })}
      onEachFeature={(f, layer) => {
        const p = f.properties as { weight: number; count: number; top: string }
        layer.bindPopup(
          `<strong>${p.count} active issue${p.count > 1 ? 's' : ''}</strong><br/>
           Heat score: ${p.weight.toFixed(1)}<br/>Mostly: ${escapeHtml(categoryName(p.top))}`,
        )
      }}
    />
  )
}
