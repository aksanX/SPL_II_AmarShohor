// The device position, with navigator.geolocation replaced: GPS first, Wi-Fi location as the fallback.
import { LocationService } from './location.service'
import { afterEach, describe, expect, it, vi } from 'vitest'

const PERMISSION_DENIED = 1
const TIMEOUT = 3
const fix = (lat: number, lng: number, accuracy: number) => ({ coords: { latitude: lat, longitude: lng, accuracy } })
const failure = (code: number) => ({ code, PERMISSION_DENIED, TIMEOUT })

/** Each call to getCurrentPosition answers with the next result: a fix, or an error code. */
function fakeGeolocation(...answers: (ReturnType<typeof fix> | number)[]) {
  const getCurrentPosition = vi.fn((ok: (p: unknown) => void, fail: (e: unknown) => void, _options?: PositionOptions) => {
    const next = answers.shift()
    if (typeof next === 'number') fail(failure(next))
    else ok(next)
  })
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } })
  return getCurrentPosition
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LocationService', () => {
  it('returns the GPS fix and remembers it', async () => {
    fakeGeolocation(fix(23.87, 90.39, 8))
    const location = new LocationService()
    expect(location.getLastKnownPosition()).toBeNull()
    await expect(location.getCurrentPosition()).resolves.toEqual({ lat: 23.87, lng: 90.39, accuracy: 8 })
    expect(location.getLastKnownPosition()).toEqual({ lat: 23.87, lng: 90.39, accuracy: 8 })
  })

  it('falls back to Wi-Fi location when high-accuracy GPS fails', async () => {
    const geo = fakeGeolocation(TIMEOUT, fix(23.8, 90.4, 60))
    await expect(new LocationService().getCurrentPosition()).resolves.toMatchObject({ accuracy: 60 })
    expect(geo.mock.calls.map((c) => (c[2]!).enableHighAccuracy)).toEqual([true, false])
  })

  it('explains how to allow location when permission is denied, without trying again', async () => {
    const geo = fakeGeolocation(PERMISSION_DENIED)
    await expect(new LocationService().getCurrentPosition()).rejects.toThrow(/permission denied/)
    expect(geo).toHaveBeenCalledTimes(1)
  })

  it('says it took too long when both tries time out', async () => {
    fakeGeolocation(TIMEOUT, TIMEOUT)
    await expect(new LocationService().getCurrentPosition()).rejects.toThrow(/took too long/)
  })

  it('says so when the browser has no location at all', async () => {
    vi.stubGlobal('navigator', {})
    await expect(new LocationService().getCurrentPosition()).rejects.toThrow('Your browser does not support location.')
  })
})
