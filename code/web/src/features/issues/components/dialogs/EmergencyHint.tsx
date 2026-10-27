import { Siren } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EMERGENCY_VERSION } from '@/features/categories/lib/emergencyVersion'

/** When the right category has a live emergency version, point there. */
export function EmergencyHint({ issueId, category }: { issueId: string; category: string }) {
  const version = EMERGENCY_VERSION[category]
  if (!version) return null
  return (
    <Link to={`/emergency?issue=${issueId}&kind=${version.kind}`}
      className="flex items-center gap-3 rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger hover:brightness-95">
      <Siren className="size-5 shrink-0" />
      <span><strong className="block">{version.question}</strong> Then it's an emergency: call 999 and raise an alert.</span>
    </Link>
  )
}
