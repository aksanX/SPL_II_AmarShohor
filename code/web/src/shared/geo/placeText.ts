// Pure helpers for place search: reading what people type, matching results to it, and small caches.
// No network and no React, so they are unit tested on their own.
import type { BBox, Place } from '@/models'
import { distanceM } from '@/shared/geo/distance'

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
 * Which part of the map a search was made from: its middle, rounded to ~5 km squares.
 * Results are biased towards the map, so the same text searched from Uttara and from Mirpur gives different
 * places and must be remembered separately. Small pans stay in the same square and reuse the results.
 */
export function searchArea(near?: BBox | null) {
  if (!near) return ''
  const r = (n: number) => Math.round(n / 0.05)
  return `${r((near.minLat + near.maxLat) / 2)},${r((near.minLng + near.maxLng) / 2)}`
}

/** "23.8103, 90.4125" typed into the search box → a point, so people can paste coordinates. */
export function parseLatLng(q: string): { lat: number; lng: number } | null {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

/** Most answers each lookup cache keeps; the oldest goes first, so a long session doesn't keep growing. */
export const CACHE_LIMIT = 300

/** Map.set that drops the oldest entry once the cache is full (a Map keeps insertion order). */
export function cacheSet<K, V>(cache: Map<K, V>, key: K, value: V) {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as K)
}

/** Joins the parts that are set, each once, with commas (at most 200 characters). */
export const joinUnique = (parts: (string | undefined)[]) =>
  parts.filter((v): v is string => Boolean(v)).filter((v, i, arr) => arr.indexOf(v) === i).join(', ').slice(0, 200)

/**
 * The biggest part's outer ring of a (Multi)Polygon, as [lat, lng] without the closing point.
 * A city that also owns small islands keeps only its main part.
 */
export function mainRing(g: GeoJSON.Geometry | undefined): [number, number][] | null {
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
