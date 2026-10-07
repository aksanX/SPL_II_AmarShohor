import { describe, expect, it } from 'vitest'
import { DHAKA, distanceM, formatDistance, parseLatLng } from './geo'

describe('distanceM', () => {
  it('is 0 for the same point', () => {
    expect(distanceM(DHAKA, DHAKA)).toBe(0)
  })

  it('is about 111 km for one degree of latitude', () => {
    expect(distanceM({ lat: 23, lng: 90 }, { lat: 24, lng: 90 })).toBeCloseTo(111_195, -1)
  })

  it('measures a real Dhaka trip: Shahbag to Uttara is about 14 km', () => {
    const d = distanceM({ lat: 23.7388, lng: 90.3958 }, { lat: 23.8759, lng: 90.3795 })
    expect(d).toBeGreaterThan(14_000)
    expect(d).toBeLessThan(16_000)
  })

  it('is the same both ways', () => {
    const a = { lat: 23.7, lng: 90.35 }
    const b = { lat: 23.9, lng: 90.45 }
    expect(distanceM(a, b)).toBeCloseTo(distanceM(b, a), 6)
  })
})

describe('formatDistance', () => {
  it('shows whole metres under 1 km', () => {
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(499.6)).toBe('500 m')
    expect(formatDistance(999)).toBe('999 m')
  })

  it('shows one decimal from 1 to 10 km', () => {
    expect(formatDistance(1000)).toBe('1.0 km')
    expect(formatDistance(2450)).toBe('2.5 km')
  })

  it('shows whole kilometres from 10 km', () => {
    expect(formatDistance(10_000)).toBe('10 km')
    expect(formatDistance(14_600)).toBe('15 km')
  })
})

describe('parseLatLng', () => {
  it('reads pasted coordinates with a comma or a space', () => {
    expect(parseLatLng('23.8103, 90.4125')).toEqual({ lat: 23.8103, lng: 90.4125 })
    expect(parseLatLng('23.8103 90.4125')).toEqual({ lat: 23.8103, lng: 90.4125 })
    expect(parseLatLng('  23.8103,90.4125  ')).toEqual({ lat: 23.8103, lng: 90.4125 })
  })

  it('reads negative and whole-number coordinates', () => {
    expect(parseLatLng('-33.86, 151.2')).toEqual({ lat: -33.86, lng: 151.2 })
    expect(parseLatLng('24, 90')).toEqual({ lat: 24, lng: 90 })
  })

  it('rejects coordinates that cannot exist', () => {
    expect(parseLatLng('91, 90')).toBeNull()
    expect(parseLatLng('23, 181')).toBeNull()
  })

  it('treats place names and addresses as text, not coordinates', () => {
    expect(parseLatLng('Uttara')).toBeNull()
    expect(parseLatLng('Road 12 Sector 7')).toBeNull()
    expect(parseLatLng('23.8')).toBeNull()
    expect(parseLatLng('')).toBeNull()
  })
})
