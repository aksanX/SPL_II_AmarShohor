import { describe, expect, it } from 'vitest'
import { areaLabel } from '@/features/city-corp/lib/areaLabel'

describe('areaLabel', () => {
  it('drops "City Corporation" from an area name', () => {
    expect(areaLabel('Dhaka North City Corporation')).toBe('Dhaka North')
    expect(areaLabel('Chattogram city corporation')).toBe('Chattogram')
  })

  it('keeps names without it, and never returns an empty name', () => {
    expect(areaLabel('Gazipur')).toBe('Gazipur')
    expect(areaLabel('City Corporation')).toBe('City Corporation')
  })
})
