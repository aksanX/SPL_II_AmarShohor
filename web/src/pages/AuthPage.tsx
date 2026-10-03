import clsx from 'clsx'
import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Spinner } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

export function AuthPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  if (user) return <Navigate to={from} replace />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        navigate(from, { replace: true })
      } else {
        if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Username: 3–24 lowercase letters, numbers or _')
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username, full_name: fullName }, emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        if (!data.session) setInfo('Check your email to confirm your account, then log in.')
        else navigate(from, { replace: true })
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword() {
    if (!email) return setError('Enter your email first.')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    if (error) setError(error.message)
    else setInfo('Password reset link sent. Check your email.')
  }

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

      <form onSubmit={submit} className="card space-y-3 p-5 shadow-lg">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-1">
          {(['login', 'register'] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setError(null); setInfo(null) }}
              className={clsx('rounded-md py-2 text-sm font-semibold', mode === m ? 'bg-card shadow-sm' : 'text-muted')}>
              {m === 'login' ? 'Log in' : 'Create account'}
            </button>
          ))}
        </div>

        {mode === 'register' && (
          <>
            <input className="input py-3" placeholder="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={80} />
            <input className="input py-3" placeholder="Username (e.g. rahim_mirpur)" value={username} required maxLength={24}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
          </>
        )}
        <input className="input py-3" type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        <input className="input py-3" type="password" placeholder="Password (min 8 characters)" value={password} minLength={8}
          onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />

        {error && <p className="rounded-lg bg-danger-soft p-2 text-sm text-danger">{error}</p>}
        {info && <p className="rounded-lg bg-brand-soft p-2 text-sm text-brand">{info}</p>}

        <button className="btn-primary w-full py-3 text-base" disabled={busy}>
          {busy && <Spinner className="size-4 text-brand-ink" />} {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        {mode === 'login' && (
          <button type="button" className="block w-full text-center text-sm text-brand hover:underline" onClick={resetPassword}>
            Forgot password?
          </button>
        )}
        <p className="text-center text-xs text-muted">Passwords are securely hashed by Supabase Auth. We never see them.</p>
      </form>
    </div>
  )
}
