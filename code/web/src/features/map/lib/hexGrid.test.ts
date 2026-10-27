import { describe, expect, it } from 'vitest'
import type { HexCell, MapIssue } from '@/models'
import { HEX_COLORS, hexBreaks, hexMaxWeight, formatBreak, hexColor, hexKey, insidePolygon, hexCenter, hexRadiusM, hexNameDetail, hexIssues } from '@/features/map/lib/hexGrid'

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

  it('finds the hottest hexagon for the top of the legend, 0 with none', () => {
    expect(hexMaxWeight([cell(1), cell(40), cell(5)])).toBe(40)
    expect(hexMaxWeight([])).toBe(0)
  })

  it('reads weights sent as text and skips missing ones', () => {
    expect(hexMaxWeight([cell('7.5' as unknown as number), cell(NaN)])).toBe(7.5)
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
