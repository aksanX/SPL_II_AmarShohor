import { Siren } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Issue } from '@/models'
import { EMERGENCY_VERSION } from '@/features/categories/lib/emergencyVersion'

/** Any open issue can get worse: send people to raise an alert linked to it. */
export function RaiseEmergency({ issue }: { issue: Issue }) {
  const version = issue.category ? EMERGENCY_VERSION[issue.category] : undefined
  const to = `/emergency?issue=${issue.id}${version ? `&kind=${version.kind}` : ''}`
  return (
    <section className="card space-y-2 border-danger/40 p-4">
      <h2 className="flex items-center gap-2 font-bold text-danger"><Siren className="size-5" /> Has it become dangerous?</h2>
      <p className="text-sm text-muted">
        {version?.question ?? 'Is someone hurt or in danger right now?'} Call 999 first, then warn people nearby.
      </p>
      <Link to={to} className="btn-danger w-full">Raise an emergency alert</Link>
    </section>
  )
}
