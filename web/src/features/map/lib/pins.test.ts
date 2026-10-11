import { describe, expect, it } from 'vitest'
import type { HeatPoint, HexCell, MapIssue } from '@/models'
import { countInView, MAX_PINS, pinsCapped, clusterLabel, pinSignature } from '@/features/map/lib/pins'

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

describe('clusterLabel', () => {
  it('shows small counts as they are', () => {
    expect(clusterLabel(7)).toBe('7')
    expect(clusterLabel(999)).toBe('999')
  })

  it('shortens thousands so the number fits the bubble', () => {
    expect(clusterLabel(1000)).toBe('1k')
    expect(clusterLabel(1834)).toBe('1.8k')
    expect(clusterLabel(12500)).toBe('13k')
  })
})
