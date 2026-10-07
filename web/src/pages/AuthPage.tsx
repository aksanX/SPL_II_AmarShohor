import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { AuthForm, type AuthMode } from '../components/AuthForm'
import { useAuth } from '../hooks/useAuth'
import { useTitle } from '../hooks/useTitle'

export function AuthPage() {
  const { user } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [mode, setMode] = useState<AuthMode>('login')
  useTitle(mode === 'login' ? 'Log in' : 'Sign up')

  if (user) return <Navigate to={from} replace />

  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-10 md:grid-cols-2 md:py-20">
      <div className="text-center md:text-left">
        <h1 className="text-4xl font-extrabold text-brand md:text-5xl">AmarShohor</h1>
        <p className="mt-1 text-lg font-semibold">আমার শহর · My City</p>
        <p className="mt-4 text-lg text-muted">
          Report problems in your neighbourhood, verify them together, and get them fixed by volunteers — out in the open,
          with no paperwork and no gatekeepers.
        </p>
      </div>
      <AuthForm mode={mode} onModeChange={setMode} redirectTo={from} />
    </div>
  )
}
