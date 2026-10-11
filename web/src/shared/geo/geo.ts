import type { BBox, Boundary, Place } from '@/models'
import { distanceM } from '@/shared/geo/distance'
import { cacheSet, cleanAddressQuery, dedupe, looksLikeAddress, matchedWords, norm, searchArea } from '@/shared/geo/placeText'

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
    cacheSet(reverseCache, key, result)
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

const boundaryCache = new Map<string, Boundary[]>()

/**
 * The biggest part's outer ring of a (Multi)Polygon, as [lat, lng] without the closing point.
 * A city that also owns small islands keeps only its main part.
 */
function mainRing(g: GeoJSON.Geometry | undefined): [number, number][] | null {
  const polygons = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : []
  let best: GeoJSON.Position[] | null = null
  let bestArea = 0
  for (const [outer] of polygons) {
    let area = 0  // shoelace; only compared, so degrees are fine
    for (let i = 0; i < outer.length - 1; i++) area += outer[i][0] * outer[i + 1][1] - outer[i + 1][0] * outer[i][1]
    if (Math.abs(area) > bestArea) {
      bestArea = Math.abs(area)
      best = outer
    }
  }
  return best ? best.slice(0, -1).map(([lng, lat]) => [lat, lng] as [number, number]) : null
}

/** Areas (boundaries, cities, towns), not the buildings, offices and roads that share their name. */
const AREA_CATEGORIES = new Set(['boundary', 'place'])

async function nominatimAreas(query: string): Promise<Boundary[]> {
  const params = new URLSearchParams({
    q: query, format: 'jsonv2', polygon_geojson: '1', polygon_threshold: '0.0005', countrycodes: 'bd', limit: '10',
  })
  const res = await nominatimFetch(`https://nominatim.openstreetmap.org/search?${params}`)
  if (!res.ok) throw new Error(`Nominatim ${res.status}`)
  const rows = (await res.json()) as {
    name?: string; display_name: string; category?: string; lat: string; lon: string; geojson?: GeoJSON.Geometry
  }[]
  return rows
    .filter((r) => AREA_CATEGORIES.has(r.category ?? ''))
    .map((r): Boundary => {
      const ring = mainRing(r.geojson)
      return {
        name: r.name || r.display_name.split(',')[0], detail: r.display_name,
        ring: ring && ring.length >= 3 ? ring : null, center: [Number(r.lat), Number(r.lon)],
      }
    })
    .sort((a, b) => Number(!a.ring) - Number(!b.ring))  // outlines first
}

/**
 * Areas in Bangladesh matching the text, with their outline where OpenStreetMap has one.
 * OSM names city corporation areas "<name> City" ("Chittagong City"); "<name> City Corporation" is the office
 * building, so with no area found that way the search is tried again without "Corporation".
 * Outlines are simplified to ~50 m so a city doesn't come with thousands of corners. Searched only when the
 * admin presses Find (Nominatim allows no search-as-you-type), and cached.
 */
export async function searchBoundaries(query: string): Promise<Boundary[]> {
  const key = norm(query)
  const cached = boundaryCache.get(key)
  if (cached) return cached
  let found = await nominatimAreas(query)
  const shorter = query.replace(/\bcorporation\b/i, '').replace(/\s+/g, ' ').trim()
  if (!found.some((b) => b.ring) && shorter !== query.trim()) {
    const more = await nominatimAreas(shorter)
    found = [...more, ...found].sort((a, b) => Number(!a.ring) - Number(!b.ring))
  }
  cacheSet(boundaryCache, key, found)
  return found
}

const placeCache = new Map<string, Place[]>()

// Bangladesh, so results never jump to another country. [west, south, east, north]
const BD_BBOX = '88.0,20.5,92.7,26.7'
const AREA_TYPES = new Set(['district', 'city', 'county', 'state', 'country', 'locality'])

/**
 * Photon (OpenStreetMap data, built for search-as-you-type): matches partial words, so "dhanmo" already
 * finds Dhanmondi. Results are biased towards the middle of the map and use English names where OSM has them.
 * `layer: 'street'` returns only roads, which finds "Road 12, Sector 7, Uttara" instead of shops on it.
 */
async function searchPhoton(
  query: string, near: BBox | undefined, signal?: AbortSignal, opts: { layer?: string; limit?: number } = {},
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
async function searchNominatim(query: string, near: BBox | undefined, signal?: AbortSignal): Promise<Place[]> {
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

/**
 * Photon search that copes with how people type places in Bangladesh:
 * - addresses also search roads only ("road 12 sector 7 uttara" → that road, not a shop on it);
 * - results that contain more of the typed words come first;
 * - if nothing matches every word ("chefs table uttara": the map only knows Chef's Tables in Gulshan and
 *   Dhanmondi), the area that the missing words name (Uttara) is offered first, and the other results are
 *   flagged so nobody drops a pin in the wrong neighbourhood by accident.
 */
async function smartPhotonSearch(raw: string, near: BBox | undefined, signal?: AbortSignal): Promise<Place[]> {
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
  q: string, near?: BBox, signal?: AbortSignal, full = false,
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
  cacheSet(placeCache, key, places)
  return places
}

