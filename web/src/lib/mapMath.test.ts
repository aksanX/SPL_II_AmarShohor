import { describe, expect, it } from 'vitest'
import {
  HEAT_LEVELS, HEX_COLORS, MAX_PINS, RADII, TIME_RANGES, formatBreak, parseDays, pinsCapped, areaLevel, countInView, heatMax, hexBreaks, hexCenter, hexColor, hexIssues,
  hexKey, hexNameDetail, hexRadiusM, hexSizeForZoom, insidePolygon, parsePinLayers, pinLayersParam, pinSignature, polygonFromRing,
  radiusForBBox, ringFromGeoJSON,
} from './mapMath'
import type { HeatPoint, HexCell, MapIssue } from './types'

// A regular hexagon around (lat 23.8, lng 90.4), as GeoJSON [lng, lat] corners with the first repeated at the end.
const HEX_RING: GeoJSON.Position[] = [
  [90.41, 23.8], [90.405, 23.809], [90.395, 23.809], [90.39, 23.8], [90.395, 23.791], [90.405, 23.791], [90.41, 23.8],
]

function cell(weight: number, issueCount = 1, ring = HEX_RING): HexCell {
  return { hex: { type: 'Polygon', coordinates: [ring] }, weight, issue_count: issueCount, top_category: 'roads' }
}

function issue(over: Partial<MapIssue> = {}): MapIssue {
  return {
    id: 'i1', title: 'Broken drain', category: 'drain', category_color: '#0a7d55', category_icon: 'circle',
    severity: 'medium', status: 'validated', lat: 23.8, lng: 90.4, upvote_count: 0, confirmation_count: 0,
    validation_score: 0, validation_threshold: 3, created_at: '2026-10-01T00:00:00Z', thumb_path: null, thumb_type: null,
    ...over,
  }
}

const point = (weight: number, issue_count?: number): HeatPoint => ({ lat: 23.8, lng: 90.4, weight, issue_count })

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

describe('countInView', () => {
  it('is 0 before anything loads', () => {
    expect(countInView(undefined)).toBe(0)
  })

  it('counts one issue per pin', () => {
    expect(countInView({ kind: 'pins', data: [issue({ id: 'a' }), issue({ id: 'b' })] })).toBe(2)
  })

  it('adds up the issues inside each hexagon', () => {
    expect(countInView({ kind: 'hex', data: [cell(3, 4), cell(1, 1)] })).toBe(5)
  })

  it('adds up the issues merged into each heat point, not the points', () => {
    expect(countInView({ kind: 'heat', data: [point(9, 7), point(2, 3)] })).toBe(10)
  })

  it('counts a heat point as one issue on a database without migration 0027', () => {
    expect(countInView({ kind: 'heat', data: [point(9), point(2)] })).toBe(2)
  })
})

describe('hexagon colours', () => {
  it('splits the scale at 10%, 25%, 50% and 75% of the hottest hexagon', () => {
    expect(hexBreaks([cell(2), cell(20), cell(8)])).toEqual([2, 5, 10, 15])
  })

  it('has all-zero breaks when there are no hexagons', () => {
    expect(hexBreaks([])).toEqual([0, 0, 0, 0])
  })

  it('picks the colour band a weight falls into', () => {
    const breaks = [2, 5, 10, 15]
    expect(hexColor(1, breaks)).toBe(HEX_COLORS[0])
    expect(hexColor(2, breaks)).toBe(HEX_COLORS[0])
    expect(hexColor(4, breaks)).toBe(HEX_COLORS[1])
    expect(hexColor(12, breaks)).toBe(HEX_COLORS[3])
    expect(hexColor(20, breaks)).toBe(HEX_COLORS[4])
  })

  it('colours a hexagon exactly on a limit with the lower colour (no rounding)', () => {
    // hottest 13.33 → the first limit is 1.333; rounded to 1.3 it used to push 1.333 into the second colour
    const breaks = hexBreaks([cell(13.33), cell(1.333)])
    expect(hexColor(1.333, breaks)).toBe(HEX_COLORS[0])
  })

  it('keeps small limits apart instead of rounding them together', () => {
    expect(hexBreaks([cell(0.4)]).map(formatBreak)).toEqual(['0.04', '0.10', '0.20', '0.30'])
    expect(hexBreaks([cell(20)]).map(formatBreak)).toEqual(['2.0', '5.0', '10.0', '15.0'])
  })

  it('gives the hottest hexagon the darkest colour', () => {
    const cells = [cell(1), cell(5), cell(40)]
    expect(hexColor(40, hexBreaks(cells))).toBe(HEX_COLORS[HEX_COLORS.length - 1])
  })
})

describe('hexKey', () => {
  it('gives the same key to the same hexagon from two results', () => {
    expect(hexKey(cell(1))).toBe(hexKey(cell(9, 5)))
  })

  it('ignores tiny rounding differences in the corners', () => {
    const nudged = HEX_RING.map(([lng, lat]) => [lng + 1e-9, lat - 1e-9])
    expect(hexKey(cell(1, 1, nudged))).toBe(hexKey(cell(1)))
  })

  it('tells neighbouring hexagons apart', () => {
    const neighbour = HEX_RING.map(([lng, lat]) => [lng + 0.02, lat])
    expect(hexKey(cell(1, 1, neighbour))).not.toBe(hexKey(cell(1)))
  })
})

describe('insidePolygon', () => {
  it('finds a point in the middle of the hexagon', () => {
    expect(insidePolygon(23.8, 90.4, HEX_RING)).toBe(true)
  })

  it('rejects points outside, including ones just past a corner', () => {
    expect(insidePolygon(23.8, 90.42, HEX_RING)).toBe(false)
    expect(insidePolygon(23.81, 90.4, HEX_RING)).toBe(false)
    expect(insidePolygon(23.808, 90.409, HEX_RING)).toBe(false)
  })
})

describe('hexCenter', () => {
  it('is the middle of the hexagon, ignoring the repeated closing corner', () => {
    const c = hexCenter(cell(1))
    expect(c.lat).toBeCloseTo(23.8, 6)
    expect(c.lng).toBeCloseTo(90.4, 6)
  })
})

describe('hexRadiusM and hexNameDetail', () => {
  // HEX_RING is about 1 km from the middle to each corner.
  it('measures the hexagon from its middle to a corner', () => {
    expect(hexRadiusM(cell(1))).toBeGreaterThan(950)
    expect(hexRadiusM(cell(1))).toBeLessThan(1100)
  })

  it('names a small hexagon after its neighbourhood', () => {
    expect(hexNameDetail(cell(1))).toBe('neighbourhood')
  })

  it('names a big hexagon only after its district, since it covers several neighbourhoods', () => {
    const big = HEX_RING.map(([lng, lat]) => [90.4 + (lng - 90.4) * 3, 23.8 + (lat - 23.8) * 3])
    expect(hexNameDetail(cell(1, 1, big))).toBe('district')
  })
})

describe('hexIssues', () => {
  it('keeps only the issues inside the hexagon', () => {
    const list = hexIssues([issue({ id: 'in' }), issue({ id: 'out', lng: 90.5 })], HEX_RING)
    expect(list.map((i) => i.id)).toEqual(['in'])
  })

  it('lists the worst first, then the most confirmed, then the most upvoted', () => {
    const list = hexIssues([
      issue({ id: 'low', severity: 'low', confirmation_count: 9 }),
      issue({ id: 'high-few', severity: 'high', confirmation_count: 1, upvote_count: 50 }),
      issue({ id: 'high-many', severity: 'high', confirmation_count: 3 }),
      issue({ id: 'high-many-upvoted', severity: 'high', confirmation_count: 3, upvote_count: 2 }),
      issue({ id: 'critical', severity: 'critical' }),
    ], HEX_RING)
    expect(list.map((i) => i.id)).toEqual(['critical', 'high-many-upvoted', 'high-many', 'high-few', 'low'])
  })
})

describe('pinsCapped', () => {
  it('warns only when Pins got as many pins as the database sends', () => {
    const pins = (n: number) => ({ kind: 'pins' as const, data: Array.from({ length: n }, (_, i) => issue({ id: String(i) })) })
    expect(pinsCapped(pins(MAX_PINS))).toBe(true)
    expect(pinsCapped(pins(MAX_PINS - 1))).toBe(false)
    expect(pinsCapped({ kind: 'hex', data: Array(MAX_PINS).fill(cell(1)) })).toBe(false)
    expect(pinsCapped(undefined)).toBe(false)
  })
})

describe('pinSignature', () => {
  it('stays the same when nothing the pin shows has changed', () => {
    expect(pinSignature(issue())).toBe(pinSignature(issue({ validation_score: 2, created_at: '2026-10-05T00:00:00Z' })))
  })

  it('changes when the status, votes, title or photo change, so the pin is redrawn', () => {
    const base = pinSignature(issue())
    expect(pinSignature(issue({ status: 'in_progress' }))).not.toBe(base)
    expect(pinSignature(issue({ upvote_count: 1 }))).not.toBe(base)
    expect(pinSignature(issue({ confirmation_count: 1 }))).not.toBe(base)
    expect(pinSignature(issue({ title: 'Blocked drain' }))).not.toBe(base)
    expect(pinSignature(issue({ thumb_path: 'u/1.jpg', thumb_type: 'image' }))).not.toBe(base)
  })
})

describe('heatMax', () => {
  it('is at least 1, even with no points or very weak ones', () => {
    expect(heatMax([])).toBe(2)
    expect(heatMax([point(0.1), point(0.2)])).toBe(1)
  })

  it('is twice the 95th percentile weight, so one huge hotspot is ignored', () => {
    const points = [...Array.from({ length: 99 }, () => point(3)), point(500)]
    expect(heatMax(points)).toBe(6)
  })
})

describe('areaLevel', () => {
  it('says "No active issues" when nothing is active, whatever the heat says', () => {
    expect(areaLevel(0, 0).label).toBe('No active issues')
    expect(areaLevel(0, 3).label).toBe('No active issues')
  })

  it('never says "none" for one small issue whose heat rounds to 0', () => {
    expect(areaLevel(1, 0).label).toBe('Low')
  })

  it('goes up with heat per km²', () => {
    expect(areaLevel(2, 1).label).toBe('Low')
    expect(areaLevel(2, 1.5).label).toBe('Low')
    expect(areaLevel(2, 3).label).toBe('Moderate')
    expect(areaLevel(5, 10).label).toBe('High')
    expect(areaLevel(9, 40).label).toBe('Severe')
  })

  it('has a level for every value', () => {
    expect(HEAT_LEVELS[HEAT_LEVELS.length - 1].max).toBe(Infinity)
  })
})

describe('City Corporation area drawing', () => {
  const corners: [number, number][] = [[23.8, 90.4], [23.9, 90.4], [23.9, 90.5]]

  it('turns map corners into a closed GeoJSON polygon in [lng, lat] order', () => {
    expect(polygonFromRing(corners)).toEqual({
      type: 'Polygon',
      coordinates: [[[90.4, 23.8], [90.4, 23.9], [90.5, 23.9], [90.4, 23.8]]],
    })
  })

  it('reads a saved polygon back into the same corners', () => {
    expect(ringFromGeoJSON(polygonFromRing(corners))).toEqual(corners)
  })

  it('reads the first polygon of a multipolygon', () => {
    const multi: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [polygonFromRing(corners).coordinates] }
    expect(ringFromGeoJSON(multi)).toEqual(corners)
  })

  it('gives no corners when there is no saved area', () => {
    expect(ringFromGeoJSON(null)).toEqual([])
    expect(ringFromGeoJSON(undefined)).toEqual([])
  })
})
