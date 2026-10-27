import { describe, expect, it } from 'vitest'
import { parsePinLayers, pinLayersParam, TIME_RANGES, parseDays } from '@/features/map/lib/urlFilters'

describe('pin filters in the URL', () => {
  it('defaults to validated issues when the link has no ?pins', () => {
    expect(parsePinLayers(null)).toEqual(['active'])
  })

  it('keeps an empty ?pins= empty, so "nothing ticked" survives a reload', () => {
    expect(parsePinLayers('')).toEqual([])
  })

  it('ignores unknown values from old or edited links', () => {
    expect(parsePinLayers('resolved,banana,active')).toEqual(['active', 'resolved'])
  })

  it('leaves the default out of the link', () => {
    expect(pinLayersParam(['active'])).toBeNull()
  })

  it('writes ticked types in a fixed order, without repeats', () => {
    expect(pinLayersParam(['resolved', 'active', 'resolved'])).toBe('active,resolved')
    expect(pinLayersParam([])).toBe('')
  })

  it('reads back what it writes', () => {
    for (const layers of [[], ['unverified'], ['active', 'unverified', 'resolved']] as const) {
      const param = pinLayersParam(layers)
      expect(parsePinLayers(param)).toEqual(layers)
    }
  })
})

describe('parseDays (time filter in the URL)', () => {
  it('means all time when the link has no ?days', () => {
    expect(parseDays(null)).toBeNull()
  })

  it('reads the offered choices', () => {
    expect(parseDays('7')).toBe(7)
    expect(parseDays('30')).toBe(30)
  })

  it('ignores values the filter does not offer, from old or edited links', () => {
    expect(parseDays('9999')).toBeNull()
    expect(parseDays('7days')).toBeNull()
    expect(parseDays('')).toBeNull()
    expect(parseDays('null')).toBeNull()
  })

  it('offers all time first, then shorter times', () => {
    expect(TIME_RANGES.map((t) => t.days)).toEqual([null, 30, 7])
  })
})
