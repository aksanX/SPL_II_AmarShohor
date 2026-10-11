import { describe, expect, it } from 'vitest'
import { hexSizeForZoom, clampBBox, parsePin, RADII, radiusForBBox } from '@/features/map/lib/viewport'

describe('hexSizeForZoom', () => {
  it('uses big hexagons zoomed out and small ones zoomed in', () => {
    expect(hexSizeForZoom(3)).toBe(20000)
    expect(hexSizeForZoom(6)).toBe(20000)
    expect(hexSizeForZoom(12)).toBe(700)
    expect(hexSizeForZoom(16)).toBe(80)
    expect(hexSizeForZoom(19)).toBe(80)
  })

  it('never gets bigger as you zoom in', () => {
    for (let z = 3; z < 19; z++) expect(hexSizeForZoom(z + 1)).toBeLessThanOrEqual(hexSizeForZoom(z))
  })
})

describe('clampBBox', () => {
  it('leaves a normal view alone', () => {
    const dhaka = { minLng: 90.3, minLat: 23.7, maxLng: 90.5, maxLat: 23.9 }
    expect(clampBBox(dhaka)).toEqual(dhaka)
  })

  it('keeps a far zoomed-out view inside real coordinates, which PostGIS requires', () => {
    expect(clampBBox({ minLng: -260.5, minLat: -95, maxLng: 410, maxLat: 91 })).toEqual({ minLng: -180, minLat: -90, maxLng: 180, maxLat: 90 })
  })
})

describe('parsePin (dropped pin in the link)', () => {
  it('reads a real position', () => {
    expect(parsePin('23.8701', '90.3987')).toEqual({ lat: 23.8701, lng: 90.3987 })
    expect(parsePin('-33.86', '151.2')).toEqual({ lat: -33.86, lng: 151.2 })
  })

  it('has no pin when the link has none', () => {
    expect(parsePin(null, null)).toBeNull()
    expect(parsePin('23.8', null)).toBeNull()
  })

  it('does not put a pin in the sea at 0, 0 for an empty ?lat=', () => {
    expect(parsePin('', '')).toBeNull()
    expect(parsePin(' ', '90.4')).toBeNull()
  })

  it('ignores text and positions that cannot exist', () => {
    expect(parsePin('abc', '90.4')).toBeNull()
    expect(parsePin('95', '90.4')).toBeNull()
    expect(parsePin('23.8', '200')).toBeNull()
  })
})

describe('radiusForBBox', () => {
  it('uses the smallest radius when there is no area', () => {
    expect(radiusForBBox(null)).toBe(500)
    expect(radiusForBBox(undefined)).toBe(500)
  })

  it('rounds half the diagonal up to the next radius choice', () => {
    // about 1.4 km corner to corner → 700 m half → 1 km
    expect(radiusForBBox([23.8, 90.4, 23.809, 90.41])).toBe(1000)
    // about 3.8 km corner to corner → 1.9 km half → 2 km
    expect(radiusForBBox([23.8, 90.4, 23.824, 90.426])).toBe(2000)
  })

  it('goes up a size when half the diagonal is even a little over a choice', () => {
    // about 4.06 km corner to corner → 2.03 km half → 5 km
    expect(radiusForBBox([23.8, 90.4, 23.826, 90.428])).toBe(5000)
  })

  it('stops at the biggest radius for a whole city', () => {
    expect(radiusForBBox([23.6, 90.2, 24.0, 90.6])).toBe(RADII[RADII.length - 1])
  })
})
