import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L, { pinIcon } from '@/features/map/lib/leaflet'
// The plugin expects the global L from lib/leaflet, so it is imported after it.
import 'leaflet.markercluster'
import { STATUS_META } from '@/features/issues/lib/issueLabels'
import { clusterLabel, pinSignature } from '@/features/map/lib/pins'
import { mediaUrl } from '@/core/supabase'
import type { MapIssue } from '@/models'

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function pinMarker(i: MapIssue, onOpen: (id: string) => void) {
  const variant = i.status === 'community_review' ? 'unverified' : i.status === 'closed' ? 'resolved' : 'normal'
  // title: shown on hover and read out by screen readers, which otherwise only hear "marker".
  const m = L.marker([i.lat, i.lng], { icon: pinIcon(i.category_color, variant), title: i.title, riseOnHover: true })
  const thumb = i.thumb_path && i.thumb_type === 'image'
    ? `<img src="${escapeHtml(mediaUrl(i.thumb_path))}" alt="Photo: ${escapeHtml(i.title)}" style="width:100%;height:110px;object-fit:cover;border-radius:8px;margin-bottom:6px" />`
    : ''
  m.bindPopup(
    `<div style="width:200px">${thumb}<strong>${escapeHtml(i.title)}</strong><br/>
     <span style="font-size:12px;color:#65676b">${STATUS_META[i.status].label} · <span aria-hidden="true">▲</span> ${i.upvote_count}<span class="sr-only"> upvotes</span> · <span aria-hidden="true">✓</span> ${i.confirmation_count}<span class="sr-only"> confirmations</span></span><br/>
     <a href="/issue/${escapeHtml(i.id)}" data-open="${escapeHtml(i.id)}" style="font-weight:600">Open issue →</a></div>`,
  )
  m.on('popupopen', (e) => {
    const link = (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLAnchorElement>('[data-open]')
    // A plain click stays in the app; Ctrl/⌘/Shift-click and middle-click open the real link in a new tab.
    if (link) link.onclick = (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return
      ev.preventDefault()
      onOpen(i.id)
    }
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
          html: `<div class="marker-cluster-custom" style="width:${size}px;height:${size}px">${clusterLabel(n)}</div>`,
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
