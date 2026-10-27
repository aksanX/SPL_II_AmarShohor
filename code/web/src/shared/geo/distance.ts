// Distances between two points on the map, and how to show them.

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Rounds first, then picks the unit, so 999.6 m reads "1.0 km" (not "1000 m") and 9,999 m "10 km" (not "10.0 km"). */
export function formatDistance(m: number) {
  if (Math.round(m) < 1000) return `${Math.round(m)} m`
  const km = m / 1000
  return km < 9.95 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}
