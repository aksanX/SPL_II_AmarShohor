import type { EmergencyKind } from '@/models'

// Categories whose worst case is a known emergency kind, with the question that tells them apart.
// Any other issue can still become an emergency ("other").
export const EMERGENCY_VERSION: Record<string, { kind: EmergencyKind; question: string }> = {
  downed_power_line: { kind: 'live_wire', question: 'Is the wire sparking, live, or touching water or people?' },
  exposed_wiring: { kind: 'live_wire', question: 'Is the wire sparking, live, or touching water or people?' },
  unsafe_structure: { kind: 'building_collapse', question: 'Is it collapsing right now, or is anyone trapped?' },
  chemical_spill: { kind: 'toxic_release', question: 'Is it giving off fumes or smoke, or on fire?' },
  fire_hazard: { kind: 'fire', question: 'Is something already burning?' },
}
