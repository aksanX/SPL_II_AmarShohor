import { describe, expect, it } from 'vitest'
import type { HeatPoint } from '@/models'
import { HEAT_GRADIENT, HEAT_LEGEND_CSS, heatMax, HEAT_LEVELS, areaLevel } from '@/features/map/lib/heat'

const point = (weight: number, issue_count?: number): HeatPoint => ({ lat: 23.8, lng: 90.4, weight, issue_count })

describe('heatMax', () => {
  it('is at least 1, even with no points or very weak ones', () => {
    expect(heatMax([])).toBe(2)
    expect(heatMax([point(0.1), point(0.2)])).toBe(1)
  })

  it('is twice the 95th percentile weight, so one huge hotspot is ignored', () => {
    const points = [...Array.from({ length: 99 }, () => point(3)), point(500)]
    expect(heatMax(points)).toBe(6)
  })

  it('leaves out points with a missing weight', () => {
    const points = [...Array.from({ length: 19 }, () => point(3)), point(NaN)]
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

  it('calls a missing heat value Low instead of finding no level', () => {
    expect(areaLevel(2, NaN).label).toBe('Low')
  })
})

describe('heat legend', () => {
  it('runs from the coolest to the hottest colour of the heat layer', () => {
    expect(HEAT_LEGEND_CSS).toBe(`linear-gradient(90deg,${HEAT_GRADIENT[0.2]},${HEAT_GRADIENT[0.4]},${HEAT_GRADIENT[0.6]},${HEAT_GRADIENT[0.8]},${HEAT_GRADIENT[1]})`)
  })
})
