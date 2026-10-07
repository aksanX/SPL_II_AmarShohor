import { describe, expect, it } from 'vitest'
import {
  DHAKA, cleanAddressQuery, dedupe, distanceM, formatDistance, looksLikeAddress, matchedWords, norm, parseLatLng, searchArea,
  type Place,
} from './geo'

const place = (name: string, detail = '', lat = 23.8, lng = 90.4): Place =>
  ({ name, detail, lat, lng, bbox: null, isArea: false })

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

describe('searchArea', () => {
  const box = (lat: number, lng: number) => ({ minLat: lat - 0.02, maxLat: lat + 0.02, minLng: lng - 0.02, maxLng: lng + 0.02 })

  it('is empty when the search has no map position', () => {
    expect(searchArea(undefined)).toBe('')
    expect(searchArea(null)).toBe('')
  })

  it('stays the same for a small pan', () => {
    expect(searchArea(box(23.8, 90.4))).toBe(searchArea(box(23.81, 90.41)))
  })

  it('changes between parts of the city', () => {
    expect(searchArea(box(23.875, 90.395))).not.toBe(searchArea(box(23.805, 90.365)))
  })
})

describe('norm', () => {
  it('lowercases and drops apostrophes and punctuation', () => {
    expect(norm("Chef's Table, Rd#11")).toBe('chefs table rd 11')
  })

  it('keeps Bangla letters and digits', () => {
    expect(norm('মিরপুর-১০')).toBe('মিরপুর ১০')
  })
})

describe('cleanAddressQuery', () => {
  it('takes the house number out and keeps it for the address text', () => {
    expect(cleanAddressQuery('House 12 Road No. 5')).toEqual({ query: 'road 5', house: 'House 12' })
  })

  it('understands the short ways people write addresses', () => {
    const { query, house } = cleanAddressQuery('H#12, Rd-5, Sec 7, Uttara')
    expect(house).toBe('House 12')
    expect(query).toContain('road')
    expect(query).toContain('sector 7')
    expect(query).toContain('uttara')
    expect(query).not.toContain('12')
  })

  it('keeps letters and slashes in house numbers', () => {
    expect(cleanAddressQuery('Plot 12/a Gulshan').house).toBe('House 12/A')
  })

  it('does not mistake words starting with "h" for a house number', () => {
    expect(cleanAddressQuery('Hatirjheel')).toEqual({ query: 'hatirjheel', house: undefined })
  })

  it('searches the typed text when only a house number was typed', () => {
    expect(cleanAddressQuery('House 5')).toEqual({ query: 'House 5', house: 'House 5' })
  })
})

describe('looksLikeAddress', () => {
  it('spots roads, sectors and numbers', () => {
    expect(looksLikeAddress('road 12 sector 7 uttara')).toBe(true)
    expect(looksLikeAddress('mirpur 10')).toBe(true)
    expect(looksLikeAddress('dhanmondi lake')).toBe(false)
  })
})

describe('matchedWords', () => {
  it('lists which typed words a result contains', () => {
    const p = place("Chef's Table", 'Gulshan Avenue, Gulshan')
    expect(matchedWords(['chefs', 'table', 'uttara'], p)).toEqual(['chefs', 'table'])
  })

  it('matches the last word as a prefix, because it may be half-typed', () => {
    expect(matchedWords(['dhanmo'], place('Dhanmondi'))).toEqual(['dhanmo'])
  })

  it('does not prefix-match short words in the middle', () => {
    expect(matchedWords(['ut', 'road'], place('Uttara Road'))).toEqual(['road'])
  })

  it('matches words typed in Bangla', () => {
    expect(matchedWords(norm('মিরপুর ১০').split(' '), place('মিরপুর ১০', 'ঢাকা'))).toEqual(['মিরপুর', '১০'])
  })

  it('prefix-matches longer words anywhere', () => {
    expect(matchedWords(['gulsh', 'avenue'], place('Gulshan Avenue'))).toEqual(['gulsh', 'avenue'])
  })
})

describe('dedupe', () => {
  it('drops the same place listed twice close together', () => {
    const list = dedupe([place('Bashundhara City'), place('Bashundhara  city', '', 23.8005, 90.4)])
    expect(list).toHaveLength(1)
  })

  it('keeps two places with the same name in different areas', () => {
    expect(dedupe([place('Road 12', '', 23.8), place('Road 12', '', 23.87)])).toHaveLength(2)
  })

  it('keeps different places at the same spot', () => {
    expect(dedupe([place('Pharmacy'), place('Tea stall')])).toHaveLength(2)
  })
})
