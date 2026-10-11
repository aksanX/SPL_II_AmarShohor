// Readable names for the kinds of emergency.
import type { EmergencyKind } from '@/models'

export const EMERGENCY_LABEL: Record<EmergencyKind, string> = {
  fire: 'Fire', gas_leak: 'Gas leak', building_collapse: 'Building collapse', live_wire: 'Live electric wire',
  flood_rescue: 'People trapped by flooding', toxic_release: 'Chemical spill or toxic smoke', other: 'Emergency',
}
