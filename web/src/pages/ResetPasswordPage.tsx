import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageSpinner, Spinner } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useTitle } from '../hooks/useTitle'
import { useToast } from '../hooks/useToast'
import { friendlyAuthError, newPasswordProblem } from '../lib/auth'
import { supabase } from '../lib/supabase'

/**
 * Choose a new password. The "Forgot password?" email link logs the user in for this one purpose, and
 * AuthProvider sends them here. Without that login (an old or already used link) there is nothing to change.
 */
export function ResetPasswordPage() {
  useTitle('New password')
  const { user, loading } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <PageSpinner />

  if (!user) {
    return (
      <div className="mx-auto max-w-md p-4">
        <div className="card space-y-3 p-6 text-center">
          <h1 className="text-xl font-bold">This link has expired</h1>
          <p className="text-sm text-muted">Reset links work once and only for a short time. Ask for a new one.</p>
          <Link to="/login" className="btn-primary inline-flex">Go to Log in → Forgot password?</Link>
        </div>
      </div>
    )
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const problem = newPasswordProblem(password, again)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(friendlyAuthError(error.message))
    toast.success('Password changed. You are logged in.')
    navigate('/', { replace: true })
  }

  return (
    <div className="mx-auto max-w-md p-4">
      <form onSubmit={save} className="card space-y-3 p-6">
        <div className="grid size-12 place-items-center rounded-xl bg-brand-soft text-brand"><KeyRound className="size-6" /></div>
        <h1 className="text-xl font-bold">Choose a new password</h1>
        <p className="text-sm text-muted">For {user.email}</p>
        <input className="input py-3" type="password" placeholder="New password (min 8 characters)" aria-label="New password"
          value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        <input className="input py-3" type="password" placeholder="New password again" aria-label="New password again"
          value={again} onChange={(e) => setAgain(e.target.value)} required autoComplete="new-password" />
        {error && <p role="alert" className="rounded-lg bg-danger-soft p-2 text-sm text-danger">{error}</p>}
        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy && <Spinner className="size-4 text-brand-ink" />} Save new password
        </button>
      </form>
    </div>
  )
}
