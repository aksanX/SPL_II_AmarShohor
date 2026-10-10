// Leaflet plugins (heat, markercluster) expect a global `L`.
// Import this module before importing any plugin.
import L from 'leaflet'

;(window as unknown as { L: typeof L }).L = L

// Made once per colour and kind and then reused: a busy map has up to 2,000 pins but only a few dozen icons.
const icons = new Map<string, L.DivIcon>()

export function pinIcon(color: string, variant: 'normal' | 'unverified' | 'resolved' = 'normal') {
  const key = `${color}|${variant}`
  const cached = icons.get(key)
  if (cached) return cached
  const icon = L.divIcon({
    className: '',
    html: `<div class="issue-pin ${variant}" style="background:${color}"><span></span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -26],
  })
  icons.set(key, icon)
  return icon
}

// OSM's current tile address; the old {s}.tile.openstreetmap.org subdomains are no longer recommended.
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export default L
