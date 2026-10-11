import type { BBox, Boundary, Place } from '@/models'
import { distanceM } from '@/shared/geo/distance'
import {
  cacheSet, cleanAddressQuery, dedupe, joinUnique, looksLikeAddress, mainRing, matchedWords, norm, searchArea,
} from '@/shared/geo/placeText'

// Bangladesh, so results never jump to another country. [west, south, east, north]
const BD_BBOX = '88.0,20.5,92.7,26.7'
/** Photon result types that are areas (the user still taps the exact spot), not one place. */
const AREA_TYPES = new Set(['district', 'city', 'county', 'state', 'country', 'locality'])
/** Nominatim areas (boundaries, cities, towns), not the buildings, offices and roads that share their name. */
const AREA_CATEGORIES = new Set(['boundary', 'place'])

interface ReverseResult { address: Record<string, string>; display: string }

/**
 * Finding places on OpenStreetMap: street addresses for a point, area names, place search while typing (Photon)
 * and full searches and area outlines (Nominatim).
 *
 * Nominatim's usage policy allows at most 1 request per second, asks for caching and forbids search-as-you-type
 * (https://operations.osmfoundation.org/policies/nominatim/). So the service keeps one request queue and its
 * caches as private state: every part of the app shares them through the one `placeSearchService`.
 */
export class PlaceSearchService {
  private nominatimQueue: Promise<unknown> = Promise.resolve()
  private nominatimLast = 0
  private readonly reverseCache = new Map<string, ReverseResult>()
  private readonly boundaryCache = new Map<string, Boundary[]>()
  private readonly placeCache = new Map<string, Place[]>()

  /** Street-level address for a point: "Road 12, Sector 7, Uttara". */
  reverseGeocode = async (lat: number, lng: number): Promise<string> => {
    const r = await this.reverseLookup(lat, lng)
    if (!r) return ''
    const a = r.address
    return joinUnique([a.road, a.neighbourhood || a.suburb || a.quarter, a.city_district || a.city || a.town]) || r.display.slice(0, 200)
  }

  /**
   * Name of the area around a point, for something bigger than a spot (a hexagon): no road.
   * `neighbourhood` gives "Sector 7, Uttara"; `district` gives only "Uttara" (or the city), for areas
   * kilometres wide where one neighbourhood's name would be misleading.
   */
  areaName = async (lat: number, lng: number, detail: 'neighbourhood' | 'district'): Promise<string> => {
    const r = await this.reverseLookup(lat, lng)
    if (!r) return ''
    const a = r.address
    const district = a.city_district || a.town || a.city || a.county || a.state_district
    return joinUnique(detail === 'neighbourhood' ? [a.neighbourhood || a.suburb || a.quarter, district] : [district])
  }

  /**
   * Areas in Bangladesh matching the text, with their outline where OpenStreetMap has one.
   * OSM names city corporation areas "<name> City" ("Chittagong City"); "<name> City Corporation" is the office
   * building, so with no area found that way the search is tried again without "Corporation".
   * Outlines are simplified to ~50 m so a city doesn't come with thousands of corners. Searched only when the
   * admin presses Find (Nominatim allows no search-as-you-type), and cached.
   */
  searchBoundaries = async (query: string): Promise<Boundary[]> => {
    const key = norm(query)
    const cached = this.boundaryCache.get(key)
    if (cached) return cached
    let found = await this.nominatimAreas(query)
    const shorter = query.replace(/\bcorporation\b/i, '').replace(/\s+/g, ' ').trim()
    if (!found.some((b) => b.ring) && shorter !== query.trim()) {
      const more = await this.nominatimAreas(shorter)
      found = [...more, ...found].sort((a, b) => Number(!a.ring) - Number(!b.ring))
    }
    cacheSet(this.boundaryCache, key, found)
    return found
  }

  /**
   * Place search limited to Bangladesh. While typing it uses Photon only. With `full` (the user pressed Enter)
   * it also asks Nominatim when Photon finds nothing or is down. Only successful results are cached, per typed
   * text and part of the map (see searchArea).
   */
  searchPlaces = async (q: string, near?: BBox, signal?: AbortSignal, full = false): Promise<Place[]> => {
    const query = q.trim()
    if (query.length < 2) return []
    const key = `${full ? 'full:' : ''}${searchArea(near)}|${query.toLowerCase()}`
    const cached = this.placeCache.get(key)
    if (cached) return cached
    let places: Place[] = []
    let photonError: unknown = null
    try {
      places = await this.smartPhotonSearch(query, near, signal)
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      photonError = e
    }
    if (full && places.length === 0 && query.length >= 3) {
      places = await this.searchNominatim(cleanAddressQuery(query).query, near, signal)
    } else if (photonError) {
      throw new Error('Place search is unavailable right now. Press Enter to try again.')
    }
    cacheSet(this.placeCache, key, places)
    return places
  }

  // ---------- Nominatim ----------

  /** Runs Nominatim requests one at a time, at least 1.1 s apart, however many callers there are. */
  private nominatimFetch(url: string, signal?: AbortSignal): Promise<Response> {
    const run = async () => {
      const wait = this.nominatimLast + 1100 - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      signal?.throwIfAborted()
      this.nominatimLast = Date.now()
      return fetch(url, { headers: { 'Accept-Language': 'en' }, signal })
    }
    const next = this.nominatimQueue.then(run, run)
    this.nominatimQueue = next.catch(() => undefined)
    return next
  }

  /** OpenStreetMap's address parts for a point. Cached per ~10 m, so dragging a pin back and forth doesn't re-ask. */
  private async reverseLookup(lat: number, lng: number): Promise<ReverseResult | null> {
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
    const cached = this.reverseCache.get(key)
    if (cached) return cached
    try {
      const res = await this.nominatimFetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`,
      )
      if (!res.ok) return null
      const j = (await res.json()) as { address?: Record<string, string>; display_name?: string }
      const result = { address: j.address ?? {}, display: j.display_name ?? '' }
      cacheSet(this.reverseCache, key, result)
      return result
    } catch {
      return null // not cached: a network blip shouldn't stick
    }
  }

  private async nominatimAreas(query: string): Promise<Boundary[]> {
    const params = new URLSearchParams({
      q: query, format: 'jsonv2', polygon_geojson: '1', polygon_threshold: '0.0005', countrycodes: 'bd', limit: '10',
    })
    const res = await this.nominatimFetch(`https://nominatim.openstreetmap.org/search?${params}`)
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

  /** Nominatim: whole words only, but better at full addresses. Only for an explicit search (Enter), never per keystroke. */
  private async searchNominatim(query: string, near: BBox | undefined, signal?: AbortSignal): Promise<Place[]> {
    const params = new URLSearchParams({ format: 'jsonv2', q: query, countrycodes: 'bd', limit: '6' })
    if (near) params.set('viewbox', `${near.minLng},${near.maxLat},${near.maxLng},${near.minLat}`)
    const res = await this.nominatimFetch(`https://nominatim.openstreetmap.org/search?${params}`, signal)
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

  // ---------- Photon ----------

  /**
   * Photon (OpenStreetMap data, built for search-as-you-type): matches partial words, so "dhanmo" already
   * finds Dhanmondi. Results are biased towards the middle of the map and use English names where OSM has them.
   * `layer: 'street'` returns only roads, which finds "Road 12, Sector 7, Uttara" instead of shops on it.
   */
  private async searchPhoton(
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

  /**
   * Photon search that copes with how people type places in Bangladesh:
   * - addresses also search roads only ("road 12 sector 7 uttara" → that road, not a shop on it);
   * - results that contain more of the typed words come first;
   * - if nothing matches every word ("chefs table uttara": the map only knows Chef's Tables in Gulshan and
   *   Dhanmondi), the area that the missing words name (Uttara) is offered first, and the other results are
   *   flagged so nobody drops a pin in the wrong neighbourhood by accident.
   */
  private async smartPhotonSearch(raw: string, near: BBox | undefined, signal?: AbortSignal): Promise<Place[]> {
    const { query, house } = cleanAddressQuery(raw)
    const [general, streets] = await Promise.all([
      this.searchPhoton(query, near, signal),
      looksLikeAddress(query) ? this.searchPhoton(query, near, signal, { layer: 'street', limit: 4 }).catch(() => []) : [],
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
        const areas = (await this.searchPhoton(missing.join(' '), near, signal, { limit: 3 }).catch(() => []))
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
}

export const placeSearchService = new PlaceSearchService()
