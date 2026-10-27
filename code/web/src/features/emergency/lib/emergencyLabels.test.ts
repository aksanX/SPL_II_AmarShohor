import { describe, expect, it } from 'vitest'
import { EMERGENCY_LABEL } from '@/features/emergency/lib/emergencyLabels'

describe('EMERGENCY_LABEL', () => {
  it('gives every emergency kind a readable name, used on every screen', () => {
    expect(EMERGENCY_LABEL.live_wire).toBe('Live electric wire')
    expect(EMERGENCY_LABEL.flood_rescue).toBe('People trapped by flooding')
    expect(Object.values(EMERGENCY_LABEL).every((name) => name.length > 0 && !name.includes('_'))).toBe(true)
  })
})
