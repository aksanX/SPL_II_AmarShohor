import { describe, expect, it } from 'vitest'
import { guessArea } from '@/features/map/components/area-drawer/thanas'

const AREAS = ['Chattogram', 'Dhaka North', 'Dhaka South', 'Khulna', 'Rajshahi']

describe('guessArea', () => {
  it('guesses the area of the City Corporation being edited', () => {
    expect(guessArea('Dhaka South City Corporation', AREAS)).toBe('Dhaka South')
    expect(guessArea('DNCC', AREAS)).toBe('Dhaka North')
    expect(guessArea('Gazipur City Corporation', AREAS)).toBeUndefined()
  })
})
