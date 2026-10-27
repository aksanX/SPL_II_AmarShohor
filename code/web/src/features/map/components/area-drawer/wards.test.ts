import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import raw from '../../../../../public/data/city-wards.json?raw'
import type { Ward } from '@/features/map/components/area-drawer/wards'

/** A fresh copy of the module each time, so one test's cached file doesn't leak into the next. */
const wardsModule = () => import('@/features/map/components/area-drawer/wards')

const square: Ward['geometry'] = { type: 'Polygon', coordinates: [[[90, 23], [91, 23], [91, 24], [90, 23]]] }
const file = (wards: Ward[]) => new Response(JSON.stringify({ wards }))

beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadWards', () => {
  it('fetches the ward file once and keeps it', async () => {
    const fetch = vi.fn().mockResolvedValue(file([{ name: 'Ward 1', area: 'Dhaka North', geometry: square }]))
    vi.stubGlobal('fetch', fetch)
    const { loadWards } = await wardsModule()
    expect(await loadWards()).toEqual([{ name: 'Ward 1', area: 'Dhaka North', geometry: square }])
    await loadWards()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toMatch(/data\/city-wards\.json$/)
  })

  it('tries again next time after a failed fetch', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(file([]))
    vi.stubGlobal('fetch', fetch)
    const { loadWards } = await wardsModule()
    await expect(loadWards()).rejects.toThrow('wards 503')
    expect(await loadWards()).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('wardPositions', () => {
  it('turns GeoJSON [lng, lat] into Leaflet [lat, lng], for one polygon or several', async () => {
    const { wardPositions } = await wardsModule()
    expect(wardPositions(square)).toEqual([[[[23, 90], [23, 91], [24, 91], [23, 90]]]])
    expect(wardPositions({ type: 'MultiPolygon', coordinates: [square.coordinates, square.coordinates] })).toHaveLength(2)
  })
})

describe('the ward file (public/data/city-wards.json)', () => {
  const { wards } = JSON.parse(raw) as { wards: Ward[] }
  const areas = [...new Set(wards.map((w) => w.area))].sort()

  it('covers the City Corporations it says it does', () => {
    expect(areas).toEqual(['Barishal', 'Chattogram', 'Dhaka North', 'Dhaka South', 'Khulna', 'Rajshahi', 'Sylhet'])
  })

  it('has few enough pieces per City Corporation for merge_areas (at most 100)', () => {
    for (const a of areas) expect(wards.filter((w) => w.area === a).length, a).toBeLessThanOrEqual(100)
  })

  it('has only closed outlines, inside Bangladesh', () => {
    for (const w of wards) {
      const polygons = w.geometry.type === 'Polygon' ? [w.geometry.coordinates] : w.geometry.coordinates
      for (const ring of polygons.flat()) {
        expect(ring.length, w.name).toBeGreaterThanOrEqual(4)
        expect(ring[0], w.name).toEqual(ring[ring.length - 1])
        for (const [lng, lat] of ring) {
          expect(lng).toBeGreaterThan(88)
          expect(lng).toBeLessThan(92.7)
          expect(lat).toBeGreaterThan(20.5)
          expect(lat).toBeLessThan(26.7)
        }
      }
    }
  })
})

describe('shareInWards and wardCount', () => {
  const tri = (x: number): Ward['geometry'] => ({ type: 'Polygon', coordinates: [[[x, 23], [x + 1, 23], [x + 1, 24], [x, 23]]] })
  const box = (x0: number, x1: number): Ward['geometry'] => ({ type: 'Polygon', coordinates: [[[x0, 23], [x1, 23], [x1, 24], [x0, 24], [x0, 23]]] })
  const ward = (name: string, geometry: Ward['geometry']): Ward => ({ name, area: 'Dhaka North', geometry })

  it('is 1 for a shape inside the wards, 0 for one outside, and the share for one partly in', async () => {
    const { shareInWards } = await wardsModule()
    expect(shareInWards(tri(90), [ward('Ward 1', tri(90))])).toBe(1)
    expect(shareInWards(tri(95), [ward('Ward 1', tri(90))])).toBe(0)
    expect(shareInWards(box(90, 92), [ward('Ward 1', box(90, 91))])).toBe(0.5)
  })

  it('counts a ward split in parts once', async () => {
    const { wardCount } = await wardsModule()
    expect(wardCount([ward('Ward 1', tri(90)), ward('Ward 2 (part)', tri(91)), ward('Ward 2 (part)', tri(92))])).toBe(2)
  })
})
