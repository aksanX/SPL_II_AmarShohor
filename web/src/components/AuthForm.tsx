import clsx from 'clsx'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Spinner } from './ui'

export type AuthMode = 'login' | 'register'

/** Log in / create account card, shared by the landing page and /login. */
export function AuthForm({ mode, onModeChange, redirectTo = '/', className }: {
  mode: AuthMode
  onModeChange: (m: AuthMode) => void
  redirectTo?: string
  className?: string
}) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        navigate(redirectTo, { replace: true })
      } else {
        if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('Username: 3–24 lowercase letters, numbers or _')
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username, full_name: fullName }, emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        if (!data.session) setInfo('Check your email to confirm your account, then log in.')
        else navigate(redirectTo, { replace: true })
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
    <form onSubmit={submit} className={clsx('card space-y-3 p-5 shadow-lg', className)}>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-1" role="tablist">
        {(['login', 'register'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m}
            onClick={() => { onModeChange(m); setError(null); setInfo(null) }}
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
  )
}
