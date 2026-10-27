import { describe, expect, it } from 'vitest'
import { ringFromGeoJSON, polygonFromRing, simplifyPath, ringCrossesItself } from '@/features/map/lib/outline'

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

describe('simplifyPath', () => {
  it('drops points that lie on a straight line', () => {
    expect(simplifyPath([[0, 0], [1, 0.1], [2, 0], [3, -0.1], [4, 0]], 1)).toEqual([0, 4])
  })

  it('keeps the corners of a shape', () => {
    const square: [number, number][] = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5]]
    expect(simplifyPath(square, 1)).toEqual([0, 2, 4, 6, 7])
  })

  it('keeps very short lines as they are', () => {
    expect(simplifyPath([[0, 0], [1, 1]], 5)).toEqual([0, 1])
  })
})

describe('ringCrossesItself', () => {
  it('accepts a plain outline', () => {
    expect(ringCrossesItself([[0, 0], [0, 1], [1, 1], [1, 0]])).toBe(false)
  })

  it('spots a figure of eight', () => {
    expect(ringCrossesItself([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(true)
  })
})
