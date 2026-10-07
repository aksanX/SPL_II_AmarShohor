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

// ---------- Nominatim (OpenStreetMap's geocoder) ----------
// Its usage policy: at most 1 request per second, cache results, and no search-as-you-type.
// https://operations.osmfoundation.org/policies/nominatim/
let nominatimQueue: Promise<unknown> = Promise.resolve()
let nominatimLast = 0

/** Runs Nominatim requests one at a time, at least 1.1 s apart, however many callers there are. */
function nominatimFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const run = async () => {
    const wait = nominatimLast + 1100 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    signal?.throwIfAborted()
    nominatimLast = Date.now()
    return fetch(url, { headers: { 'Accept-Language': 'en' }, signal })
  }
  const next = nominatimQueue.then(run, run)
  nominatimQueue = next.catch(() => undefined)
  return next
}

interface ReverseResult { address: Record<string, string>; display: string }
const reverseCache = new Map<string, ReverseResult>()

/** OpenStreetMap's address parts for a point. Cached per ~10 m, so dragging a pin back and forth doesn't re-ask. */
async function reverseLookup(lat: number, lng: number): Promise<ReverseResult | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
  const cached = reverseCache.get(key)
  if (cached) return cached
  try {
    const res = await nominatimFetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`,
    )
    if (!res.ok) return null
    const j = (await res.json()) as { address?: Record<string, string>; display_name?: string }
    const result = { address: j.address ?? {}, display: j.display_name ?? '' }
    reverseCache.set(key, result)
    return result
  } catch {
    return null // not cached: a network blip shouldn't stick
  }
}

const joinUnique = (parts: (string | undefined)[]) =>
  parts.filter((v): v is string => Boolean(v)).filter((v, i, arr) => arr.indexOf(v) === i).join(', ').slice(0, 200)

/** Street-level address for a point: "Road 12, Sector 7, Uttara". */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const r = await reverseLookup(lat, lng)
  if (!r) return ''
  const a = r.address
  return joinUnique([a.road, a.neighbourhood || a.suburb || a.quarter, a.city_district || a.city || a.town]) || r.display.slice(0, 200)
}

/**
 * Name of the area around a point, for something bigger than a spot (a hexagon): no road.
 * `neighbourhood` gives "Sector 7, Uttara"; `district` gives only "Uttara" (or the city), for areas
 * kilometres wide where one neighbourhood's name would be misleading.
 */
export async function areaName(lat: number, lng: number, detail: 'neighbourhood' | 'district'): Promise<string> {
  const r = await reverseLookup(lat, lng)
  if (!r) return ''
  const a = r.address
  const district = a.city_district || a.town || a.city || a.county || a.state_district
  return joinUnique(detail === 'neighbourhood' ? [a.neighbourhood || a.suburb || a.quarter, district] : [district])
}

export interface Place {
  name: string
  detail: string
  lat: number
  lng: number
  /** [south, west, north, east] when the place is an area (e.g. a neighbourhood), so the map can fit it. */
  bbox: [number, number, number, number] | null
  /** A neighbourhood, sector or city rather than one spot: the user still has to tap the exact place. */
  isArea: boolean
  /** Warning shown under the result, e.g. when it doesn't match part of what was typed. */
  note?: string
  /** House number the user typed ("House 12"). OSM rarely has them, so it's kept for the address text only. */
  house?: string
}

const placeCache = new Map<string, Place[]>()

// Bangladesh, so results never jump to another country. [west, south, east, north]
const BD_BBOX = '88.0,20.5,92.7,26.7'
const AREA_TYPES = new Set(['district', 'city', 'county', 'state', 'country', 'locality'])

type ViewBox = { minLng: number; minLat: number; maxLng: number; maxLat: number }

/**
 * Which part of the map a search was made from: its middle, rounded to ~5 km squares.
 * Results are biased towards the map, so the same text searched from Uttara and from Mirpur gives different
 * places and must be remembered separately. Small pans stay in the same square and reuse the results.
 */
export function searchArea(near?: ViewBox | null) {
  if (!near) return ''
  const r = (n: number) => Math.round(n / 0.05)
  return `${r((near.minLat + near.maxLat) / 2)},${r((near.minLng + near.maxLng) / 2)}`
}

/**
 * Lowercase, no punctuation: "Chef's Table, Rd#11" → "chefs table rd 11".
 * Keeps combining marks (\p{M}) too: Bangla vowel signs are marks, so "মিরপুর" must not become "ম রপ র".
 */
export const norm = (s: string) =>
  s.toLowerCase().replace(/['’`]/g, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()

/**
 * Bangladeshi addresses are written many ways ("H#12, Rd-5", "House 12 Road No. 5"). OSM has roads, sectors and
 * areas but almost never house numbers, which only spoil the search. So: expand abbreviations, take the house
 * number out (kept for the address text), and drop filler words.
 */
export function cleanAddressQuery(raw: string): { query: string; house?: string } {
  let q = ` ${raw.toLowerCase()} `
    .replace(/\b(rd|rod)\b\.?/g, ' road ')
    .replace(/\bsec\b\.?/g, ' sector ')
    .replace(/\bave\b\.?/g, ' avenue ')
    .replace(/\b(no|number)\b\.?/g, ' ')
    .replace(/#/g, ' ')
  let house: string | undefined
  q = q.replace(/\b(?:house|h|holding|bari|basha|plot|flat|apt)\s*[-:]?\s*([0-9][0-9a-z/-]*)\b/, (_m, n: string) => {
    house = `House ${n.toUpperCase()}`
    return ' '
  })
  q = q.replace(/\s+/g, ' ').trim()
  return { query: q || raw.trim(), house }
}

export const looksLikeAddress = (q: string) => /\b(road|lane|street|avenue|sector|block|section|goli)\b|\d/.test(q)

/**
 * Photon (OpenStreetMap data, built for search-as-you-type): matches partial words, so "dhanmo" already
 * finds Dhanmondi. Results are biased towards the middle of the map and use English names where OSM has them.
 * `layer: 'street'` returns only roads, which finds "Road 12, Sector 7, Uttara" instead of shops on it.
 */
async function searchPhoton(
  query: string, near: ViewBox | undefined, signal?: AbortSignal, opts: { layer?: string; limit?: number } = {},
): Promise<Place[]> {
  const params = new URLSearchParams({ q: query, limit: String(opts.limit ?? 8), bbox: BD_BBOX, lang: 'en' })
  if (opts.layer) params.set('layer', opts.layer)
  if (near) {
    params.set('lat', String((near.minLat + near.maxLat) / 2))
    params.set('lon', String((near.minLng + near.maxLng) / 2))
  }
  const res = await fetch(`https://photon.komoot.io/api/?${params}`, { signal })
  if (!res.ok) throw new Error(`Photon ${res.status}`)
  const j = (await res.json()) as {
    features: {
      geometry: { coordinates: [number, number] }
      properties: Record<string, string | undefined> & { extent?: [number, number, number, number] }
    }[]
  }
  return j.features.map(({ geometry, properties: p }): Place => {
    const name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.district || p.city || 'Unnamed place'
    const detail = [p.street, p.locality, p.district, p.city]
      .filter((v): v is string => Boolean(v) && v !== name)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 3)
      .join(', ')
    const e = p.extent // [west, north, east, south]
    return {
      name,
      detail,
      lat: geometry.coordinates[1],
      lng: geometry.coordinates[0],
      bbox: e && e.length === 4 ? [e[3], e[0], e[1], e[2]] : null,
      isArea: AREA_TYPES.has(p.type ?? ''),
    }
  })
}

/** Nominatim: whole words only, but better at full addresses. Only for an explicit search (Enter), never per keystroke. */
async function searchNominatim(query: string, near: ViewBox | undefined, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ format: 'jsonv2', q: query, countrycodes: 'bd', limit: '6' })
  if (near) params.set('viewbox', `${near.minLng},${near.maxLat},${near.maxLng},${near.minLat}`)
  const res = await nominatimFetch(`https://nominatim.openstreetmap.org/search?${params}`, signal)
  if (!res.ok) throw new Error('Place search is unavailable right now. Try again in a moment.')
  const rows = (await res.json()) as {
    lat: string; lon: string; name?: string; display_name: string; boundingbox?: string[]
  }[]
  return rows.map((r): Place => {
    const [first, ...rest] = r.display_name.split(', ')
    const bb = r.boundingbox?.map(Number) // [south, north, west, east]
    const bbox: Place['bbox'] = bb && bb.length === 4 && bb.every(Number.isFinite) ? [bb[0], bb[2], bb[1], bb[3]] : null
    return {
      name: r.name || first,
      detail: (r.name && r.name !== first ? [first, ...rest] : rest).slice(0, 3).join(', '),
      lat: Number(r.lat),
      lng: Number(r.lon),
      bbox,
      isArea: Boolean(bbox && distanceM({ lat: bbox[0], lng: bbox[1] }, { lat: bbox[2], lng: bbox[3] }) > 800),
    }
  })
}

/** Which typed words a result contains. The last word may be half-typed, so it also matches as a prefix. */
export function matchedWords(words: string[], p: Place) {
  const tokens = norm(`${p.name} ${p.detail}`).split(' ')
  return words.filter((w, i) =>
    tokens.some((t) => t === w || (i === words.length - 1 && t.startsWith(w)) || (w.length >= 4 && t.startsWith(w))))
}

/** Same name within ~150 m = the same place listed twice (e.g. a building and its entrance). */
export function dedupe(places: Place[]) {
  const out: Place[] = []
  for (const p of places) {
    if (!out.some((o) => norm(o.name) === norm(p.name) && distanceM(o, p) < 150)) out.push(p)
  }
  return out
}

/**
 * Photon search that copes with how people type places in Bangladesh:
 * - addresses also search roads only ("road 12 sector 7 uttara" → that road, not a shop on it);
 * - results that contain more of the typed words come first;
 * - if nothing matches every word ("chefs table uttara": the map only knows Chef's Tables in Gulshan and
 *   Dhanmondi), the area that the missing words name (Uttara) is offered first, and the other results are
 *   flagged so nobody drops a pin in the wrong neighbourhood by accident.
 */
async function smartPhotonSearch(raw: string, near: ViewBox | undefined, signal?: AbortSignal): Promise<Place[]> {
  const { query, house } = cleanAddressQuery(raw)
  const [general, streets] = await Promise.all([
    searchPhoton(query, near, signal),
    looksLikeAddress(query) ? searchPhoton(query, near, signal, { layer: 'street', limit: 4 }).catch(() => []) : [],
  ])
  const words = norm(query).split(' ').filter((w) => w.length >= 2 || /\d/.test(w))
  const scored = dedupe([...streets, ...general]).map((p, i) => ({ p, i, hits: matchedWords(words, p) }))
  scored.sort((a, b) => b.hits.length - a.hits.length || a.i - b.i)

  let places = scored.map((s) => s.p)
  const complete = scored.some((s) => s.hits.length === words.length)
  if (!complete && words.length >= 2 && scored.length) {
    // Words no result contains, e.g. "uttara". Numbers alone ("10") don't name an area.
    const missing = words.filter((w) => !scored.some((s) => s.hits.includes(w)))
    if (missing.some((w) => !/^\d+$/.test(w))) {
      const areas = (await searchPhoton(missing.join(' '), near, signal, { limit: 3 }).catch(() => []))
        .filter((a) => a.isArea)
        .slice(0, 1)
        .map((a) => ({ ...a, note: `“${raw.trim()}” isn't on the map here. Go to ${a.name} and tap the exact spot.` }))
      places = [
        ...areas,
        ...scored.map((s) => s.hits.length < words.length
          ? { ...s.p, note: `Doesn't match “${words.filter((w) => !s.hits.includes(w)).join(' ')}”` }
          : s.p),
      ]
    }
  }
  return dedupe(places).slice(0, 8).map((p) => (house && !p.isArea ? { ...p, house } : p))
}

/**
 * Place search limited to Bangladesh. While typing it uses Photon only. With `full` (the user pressed Enter)
 * it also asks Nominatim when Photon finds nothing or is down. Only successful results are cached, per typed
 * text and part of the map (see searchArea).
 */
export async function searchPlaces(
  q: string, near?: ViewBox, signal?: AbortSignal, full = false,
): Promise<Place[]> {
  const query = q.trim()
  if (query.length < 2) return []
  const key = `${full ? 'full:' : ''}${searchArea(near)}|${query.toLowerCase()}`
  const cached = placeCache.get(key)
  if (cached) return cached
  let places: Place[] = []
  let photonError: unknown = null
  try {
    places = await smartPhotonSearch(query, near, signal)
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    photonError = e
  }
  if (full && places.length === 0 && query.length >= 3) {
    places = await searchNominatim(cleanAddressQuery(query).query, near, signal)
  } else if (photonError) {
    throw new Error('Place search is unavailable right now. Press Enter to try again.')
  }
  placeCache.set(key, places)
  return places
}

/** "23.8103, 90.4125" typed into the search box → a point, so people can paste coordinates. */
export function parseLatLng(q: string): { lat: number; lng: number } | null {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}
