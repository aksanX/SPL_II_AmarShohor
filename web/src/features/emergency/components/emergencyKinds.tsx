// The kinds of emergency people can raise, with their icons.
import { Biohazard, Building, CircleAlert, Flame, Waves, Wind, Zap } from 'lucide-react'
import type { ReactNode } from 'react'
import type { EmergencyKind } from '@/models'
import { EMERGENCY_LABEL } from '@/features/emergency/lib/emergencyLabels'

// Names come from EMERGENCY_LABEL, shared with the alert banner and the admin lists; only "Other" reads
// differently in the picker.
export const EMERGENCY_KINDS: { kind: EmergencyKind; label: string; icon: ReactNode }[] = [
  { kind: 'fire', label: EMERGENCY_LABEL.fire, icon: <Flame className="size-5" /> },
  { kind: 'gas_leak', label: EMERGENCY_LABEL.gas_leak, icon: <Wind className="size-5" /> },
  { kind: 'building_collapse', label: EMERGENCY_LABEL.building_collapse, icon: <Building className="size-5" /> },
  { kind: 'live_wire', label: EMERGENCY_LABEL.live_wire, icon: <Zap className="size-5" /> },
  { kind: 'flood_rescue', label: EMERGENCY_LABEL.flood_rescue, icon: <Waves className="size-5" /> },
  { kind: 'toxic_release', label: EMERGENCY_LABEL.toxic_release, icon: <Biohazard className="size-5" /> },
  { kind: 'other', label: 'Other emergency', icon: <CircleAlert className="size-5" /> },
]

export const emergencyLabel = (k: EmergencyKind) => EMERGENCY_KINDS.find((x) => x.kind === k)?.label ?? 'Emergency'
