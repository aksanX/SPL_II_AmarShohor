// Place search and street addresses, with fetch replaced so no real map service is called.
// Its own file, so the search caches and the Nominatim queue start empty.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reverseGeocode, searchPlaces } from './geo'

interface PhotonProps { name?: string; street?: string; district?: string; city?: string; type?: string; extent?: number[] }
const feature = (lng: number, lat: number, properties: PhotonProps) => ({ geometry: { coordinates: [lng, lat] }, properties })

const UTTARA = feature(90.3995, 23.8759, { name: 'Uttara', city: 'Dhaka', type: 'district', extent: [90.36, 23.9, 90.42, 23.85] })
const CHEFS_TABLE = feature(90.4152, 23.7925, { name: "Chef's Table", street: 'Gulshan Avenue', district: 'Gulshan', city: 'Dhaka', type: 'house' })

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })

/** Fake fetch: answers from `routes` by the request's ?q= (and ?layer=street), and records every URL. */
function mockFetch(routes: (url: URL) => unknown) {
  const fn = vi.fn(async (input: string) => routes(new URL(input)))
  vi.stubGlobal('fetch', fn)
  return fn
}
const photon = (features: unknown[]) => json({ features })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchPlaces', () => {
  it('does not search for fewer than 2 characters', async () => {
    const fetch = mockFetch(() => photon([]))
    expect(await searchPlaces(' u ')).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('turns Photon results into places, with the area box in [south, west, north, east] order', async () => {
    mockFetch(() => photon([UTTARA]))
    const [p] = await searchPlaces('uttara')
    expect(p).toMatchObject({ name: 'Uttara', detail: 'Dhaka', lat: 23.8759, lng: 90.3995, isArea: true })
    expect(p.bbox).toEqual([23.85, 90.36, 23.9, 90.42])
  })

  it('searches only inside Bangladesh, near the middle of the map', async () => {
    const fetch = mockFetch(() => photon([]))
    await searchPlaces('banani', { minLat: 23.7, maxLat: 23.9, minLng: 90.3, maxLng: 90.5 })
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.searchParams.get('bbox')).toBe('88.0,20.5,92.7,26.7')
    expect(Number(url.searchParams.get('lat'))).toBeCloseTo(23.8)
    expect(Number(url.searchParams.get('lon'))).toBeCloseTo(90.4)
  })

  it('puts results that contain more of the typed words first', async () => {
    mockFetch(() => photon([
      feature(90.40, 23.79, { name: 'Banani Club', district: 'Banani' }),
      feature(90.41, 23.79, { name: 'Banani Lake Park', district: 'Banani' }),
    ]))
    const results = await searchPlaces('banani lake')
    expect(results.map((p) => p.name)).toEqual(['Banani Lake Park', 'Banani Club'])
  })

  it('offers the area first when a place is not on the map there, and flags the other results', async () => {
    mockFetch((url) => photon(url.searchParams.get('q') === 'uttara' ? [UTTARA] : [CHEFS_TABLE]))
    const [area, other] = await searchPlaces('chefs table uttara')
    expect(area.name).toBe('Uttara')
    expect(area.note).toBe('“chefs table uttara” isn\'t on the map here. Go to Uttara and tap the exact spot.')
    expect(other.name).toBe("Chef's Table")
    expect(other.note).toBe('Doesn\'t match “uttara”')
  })

  it('also searches roads only for addresses, and keeps the typed house number on spots but not areas', async () => {
    const fetch = mockFetch((url) => photon(url.searchParams.get('layer') === 'street'
      ? [feature(90.37, 23.745, { name: 'Road 5', district: 'Dhanmondi', type: 'street' })]
      : [feature(90.375, 23.746, { name: 'Dhanmondi', city: 'Dhaka', type: 'district' })]))
    const results = await searchPlaces('House 12, Road 5, Dhanmondi')
    expect(fetch.mock.calls.some(([u]) => new URL(u).searchParams.get('layer') === 'street')).toBe(true)
    expect(results[0]).toMatchObject({ name: 'Road 5', house: 'House 12' })
    expect(results[1].name).toBe('Dhanmondi')
    expect(results[1].house).toBeUndefined()
  })

  it('remembers results, whatever the capital letters', async () => {
    const fetch = mockFetch(() => photon([UTTARA]))
    await searchPlaces('Mirpur 10')
    const calls = fetch.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    await searchPlaces('mirpur 10')
    await searchPlaces('MIRPUR 10 ')
    expect(fetch).toHaveBeenCalledTimes(calls)
  })

  it('searches again for the same text from another part of the city', async () => {
    const uttara = { minLat: 23.85, maxLat: 23.9, minLng: 90.37, maxLng: 90.42 }
    const mirpur = { minLat: 23.78, maxLat: 23.83, minLng: 90.34, maxLng: 90.39 }
    const fetch = mockFetch((url) => photon([feature(Number(url.searchParams.get('lon')), Number(url.searchParams.get('lat')), { name: 'Road 12' })]))
    const [inUttara] = await searchPlaces('road 12', uttara)
    const [inMirpur] = await searchPlaces('road 12', mirpur)
    expect(inUttara.lat).toBeCloseTo(23.875)
    expect(inMirpur.lat).toBeCloseTo(23.805)
    const calls = fetch.mock.calls.length
    // a small pan stays in the same part of the map: no new search
    await searchPlaces('road 12', { ...mirpur, minLat: mirpur.minLat + 0.005, maxLat: mirpur.maxLat + 0.005 })
    expect(fetch).toHaveBeenCalledTimes(calls)
  })

  it('gives a clear message while typing if Photon is down, and does not remember the failure', async () => {
    mockFetch(() => json({}, 503))
    await expect(searchPlaces('gulshan 2')).rejects.toThrow('Place search is unavailable right now. Press Enter to try again.')
    const fetch = mockFetch(() => photon([UTTARA]))
    await searchPlaces('gulshan 2')
    expect(fetch).toHaveBeenCalled()
  })

  it('asks Nominatim when Enter is pressed and Photon finds nothing', async () => {
    const fetch = mockFetch((url) => url.hostname === 'nominatim.openstreetmap.org'
      ? json([{ lat: '23.7808', lon: '90.4067', name: 'Road 11', display_name: 'Road 11, Banani, Dhaka', boundingbox: ['23.78', '23.7816', '90.40', '90.413'] }])
      : photon([]))
    const [p] = await searchPlaces('road 11 banani', undefined, undefined, true)
    expect(fetch.mock.calls.some(([u]) => u.includes('nominatim.openstreetmap.org/search'))).toBe(true)
    expect(p).toMatchObject({ name: 'Road 11', detail: 'Banani, Dhaka', lat: 23.7808, lng: 90.4067, isArea: true })
    expect(p.bbox).toEqual([23.78, 90.4, 23.7816, 90.413])
  })
})

describe('reverseGeocode', () => {
  it('builds a short street address and leaves out repeats', async () => {
    mockFetch(() => json({ address: { road: 'Road 12', suburb: 'Sector 7', city_district: 'Uttara', city: 'Dhaka' } }))
    expect(await reverseGeocode(23.8701, 90.3987)).toBe('Road 12, Sector 7, Uttara')
  })

  it('remembers a point to about 10 m, so dragging a pin back does not ask again', async () => {
    const fetch = mockFetch(() => json({ address: { road: 'Should not be asked' } }))
    expect(await reverseGeocode(23.87012, 90.39874)).toBe('Road 12, Sector 7, Uttara')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns nothing on a network error, and tries again next time', async () => {
    mockFetch(() => { throw new Error('offline') })
    expect(await reverseGeocode(23.75, 90.39)).toBe('')
    mockFetch(() => json({ address: { road: 'Mirpur Road', city: 'Dhaka' } }))
    expect(await reverseGeocode(23.75, 90.39)).toBe('Mirpur Road, Dhaka')
  })
})
