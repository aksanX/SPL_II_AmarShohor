import { describe, expect, it } from 'vitest'
import { matchAreas } from '@/features/map/components/area-drawer/areaNames'

const AREAS = ['Barishal', 'Chattogram', 'Dhaka North', 'Dhaka South', 'Khulna', 'Rajshahi', 'Sylhet']

describe('matchAreas', () => {
  it('finds an area by its full name, its short name or another spelling', () => {
    expect(matchAreas('Dhaka North City Corporation', AREAS)).toEqual(['Dhaka North'])
    expect(matchAreas('dscc', AREAS)).toEqual(['Dhaka South'])
    expect(matchAreas('Chittagong City Corporation', AREAS)).toEqual(['Chattogram'])
    expect(matchAreas('Barisal', AREAS)).toEqual(['Barishal'])
  })

  it('offers every area a name starts', () => {
    expect(matchAreas('Dhaka', AREAS)).toEqual(['Dhaka North', 'Dhaka South'])
    expect(matchAreas('chitta', AREAS)).toEqual(['Chattogram'])
  })

  it('finds nothing for other places or too little text', () => {
    expect(matchAreas('Gazipur', AREAS)).toEqual([])
    expect(matchAreas('d', AREAS)).toEqual([])
    expect(matchAreas('City Corporation', AREAS)).toEqual([])
  })
})
