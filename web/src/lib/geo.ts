export interface Position {
  lat: number
  lng: number
  accuracy: number
}

export const DHAKA = { lat: 23.8103, lng: 90.4125 }

// Last GPS fix this session, reused (e.g. to weight votes by proximity) without re-prompting.
let lastKnown: Position | null = null
export const getLastKnownPosition = () => lastKnown

function requestPosition(options: PositionOptions): Promise<Position> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      reject,
      options,
    )
  })
}

export async function getCurrentPosition(): Promise<Position> {
  if (!navigator.geolocation) throw new Error('Your browser does not support location.')
  try {
    // Phones: real GPS. Laptops often can't deliver "high accuracy", so fall back below.
    lastKnown = await requestPosition({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
    return lastKnown
  } catch (first) {
    const e = first as GeolocationPositionError
    if (e.code === e.PERMISSION_DENIED) {
      throw new Error('Location permission denied. Click the icon left of the address bar and allow Location.')
    }
  }
  try {
    // Wi-Fi based location (how laptops locate themselves); accept a fix up to 1 minute old.
    lastKnown = await requestPosition({ enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 })
    return lastKnown
  } catch (second) {
    const e = second as GeolocationPositionError
    throw new Error(
      e.code === e.TIMEOUT
        ? 'Getting your location took too long. Try again, or place the pin on the map manually.'
        : 'Your device could not find your location. On a Mac, turn on Wi-Fi and allow your browser in System Settings → Privacy & Security → Location Services. Or place the pin manually.',
    )
  }
}

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function formatDistance(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
}

/** Street-level address from OpenStreetMap (free, rate-limited: call sparingly). */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`,
      { headers: { 'Accept-Language': 'en' } },
    )
    if (!res.ok) return ''
    const j = (await res.json()) as { address?: Record<string, string>; display_name?: string }
    const a = j.address ?? {}
    const parts = [a.road, a.neighbourhood || a.suburb || a.quarter, a.city_district || a.city || a.town]
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
    return (parts.join(', ') || j.display_name || '').slice(0, 200)
  } catch {
    return ''
  }
}
