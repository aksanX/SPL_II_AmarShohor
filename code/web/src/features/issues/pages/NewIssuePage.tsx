import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { ReportForm } from '@/features/issues/components/ReportForm'

/** Super admins supervise the app and don't report issues (0050): say so here instead of showing a form they can't send. */
export function NewIssuePage() {
  const { isAdmin } = useAuth()
  if (isAdmin) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <div className="card space-y-3 p-6 text-center">
          <h1 className="text-lg font-bold">Super admins don't report issues</h1>
          <p className="text-sm text-muted">Residents report problems; as super admin you supervise the area admins and decide what they can't.</p>
          <Link to="/admin" className="btn-primary inline-flex">Go to the Admin page</Link>
        </div>
      </div>
    )
  }
  return <ReportForm />
}
