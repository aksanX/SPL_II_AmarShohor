import { Building2, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTitle } from '@/shared/hooks/useTitle'
import { PageSpinner } from '@/shared/ui'
import { AuthForm } from '@/features/auth/components/AuthForm'
import { useAuth } from '@/features/auth/hooks/useAuth'

/** City Corporation staff create their account here, with their official email (0061). */
export function OfficialSignupPage() {
  useTitle('City Corporation sign-up')
  const { user, loading } = useAuth()
  if (loading) return <PageSpinner />
  return (
    <div className="mx-auto max-w-md space-y-4 px-2 py-4 sm:px-4">
      <div className="card space-y-2 p-4">
        <h1 className="flex items-center gap-2 text-xl font-bold"><Building2 className="size-6 text-warn" /> City Corporation sign-up</h1>
        <p className="text-sm text-muted">
          For City Corporation staff only. Use your <strong>official email</strong>: we send it a confirmation link,
          then an admin reviews your account. Approved officials get a dashboard of escalated issues in their area.
        </p>
        <p className="flex items-start gap-2 text-xs text-muted">
          <ShieldCheck className="size-4 shrink-0 text-brand" />
          This is a separate account. Residents report and vote from their own account.
        </p>
      </div>
      {user
        ? <p className="card p-4 text-sm">You're logged in. Log out first to create an official account.</p>
        : <AuthForm mode="register" onModeChange={() => {}} official />}
      <p className="text-center text-sm text-muted">Already signed up? <Link to="/login" className="font-semibold text-brand">Log in</Link></p>
    </div>
  )
}
