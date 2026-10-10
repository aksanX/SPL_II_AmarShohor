import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getAuthorities, isUsernameTaken } from '../lib/api'
import { cleanUsername, friendlyAuthError, isExistingAccount, usernameProblem } from '../lib/auth'
import { captchaEnabled } from '../lib/captcha'
import { supabase } from '../lib/supabase'
import { Captcha } from './Captcha'
import { Spinner } from './ui'

export type AuthMode = 'login' | 'register'

/**
 * Log in / create account card, shared by the landing page and /login.
 * `official`: the City Corporation sign-up (0061). Only an email at the City
 * Corporation's official domain is accepted; an admin approves the account.
 */
export function AuthForm({ mode, onModeChange, redirectTo = '/', className, official = false }: {
  mode: AuthMode
  onModeChange: (m: AuthMode) => void
  redirectTo?: string
  className?: string
  official?: boolean
}) {
  const navigate = useNavigate()
  // Also on the normal sign-up: an official email there must go to the City Corporation page (0065).
  const cityCorps = (useQuery({ queryKey: ['authorities'], queryFn: getAuthorities, enabled: official || mode === 'register' }).data ?? [])
    .filter((a) => a.is_active && a.kind === 'city_corporation' && a.email_domain)
  const [authorityId, setAuthorityId] = useState('')
  const [designation, setDesignation] = useState('')
  const [office, setOffice] = useState('')
  const authority = cityCorps.find((a) => a.id === authorityId)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  // Logging in before confirming the email: offer to send the confirmation link again.
  const [unconfirmed, setUnconfirmed] = useState(false)
  // CAPTCHA (when switched on): a one-time token, renewed after every attempt.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaRound, setCaptchaRound] = useState(0)
  const needCaptcha = () => {
    if (captchaEnabled && !captchaToken) {
      setError('Please complete the "I\'m not a robot" check first.')
      return true
    }
    return false
  }
  // Sent only while the CAPTCHA is on, so requests are exactly as before when it is off.
  const withCaptcha = <T extends object>(o: T) => (captchaToken ? { ...o, captchaToken } : o)

  function show(err: unknown) {
    const message = (err as Error).message ?? String(err)
    setUnconfirmed(message.toLowerCase().includes('email not confirmed'))
    setError(friendlyAuthError(message))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (needCaptcha()) return
    setBusy(true)
    setError(null)
    setInfo(null)
    setUnconfirmed(false)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password, ...(captchaToken ? { options: { captchaToken } } : {}) })
        if (error) throw error
        navigate(redirectTo, { replace: true })
      } else {
        const problem = usernameProblem(username)
        if (problem) throw new Error(problem)
        if (official) {
          if (!authority) throw new Error('Choose your City Corporation.')
          if (designation.trim().length < 2) throw new Error('Enter your designation.')
          if (!emailAtDomain(email, authority.email_domain)) throw new Error(`Use your official @${authority.email_domain} email.`)
        } else {
          const staffOf = cityCorps.find((a) => emailAtDomain(email, a.email_domain))
          if (staffOf) throw new Error(`This is a ${staffOf.short_name} official email. Use "Sign up with your official email" below, so an admin can verify you.`)
        }
        // The database would quietly give a taken username a number at the end; say so instead.
        if (await isUsernameTaken(username)) throw new Error(`@${username} is taken. Try another username.`)
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: withCaptcha({
            data: {
              username, full_name: fullName.trim(),
              ...(official && authority ? { official_authority: authority.id, designation: designation.trim(), office: office.trim() } : {}),
            },
            emailRedirectTo: window.location.origin,
          }),
        })
        if (error) throw error
        if (isExistingAccount(data.user)) throw new Error('User already registered')
        if (!data.session) {
          setInfo(official
            ? `Check your ${authority?.email_domain} inbox and confirm your email. An admin then reviews your account; you'll be told when it's approved.`
            : 'Check your email to confirm your account, then log in.')
        }
        else navigate(redirectTo, { replace: true })
      }
    } catch (err) {
      show(err)
    } finally {
      setBusy(false)
      setCaptchaRound((r) => r + 1)
    }
  }

  async function resetPassword() {
    if (!email.trim()) return setError('Enter your email first, then tap "Forgot password?" again.')
    if (needCaptcha()) return
    setBusy(true)
    setError(null)
    // The link logs the user in for a password change; AuthProvider then opens /reset-password.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), withCaptcha({ redirectTo: window.location.origin }))
    setBusy(false)
    setCaptchaRound((r) => r + 1)
    if (error) show(error)
    else setInfo('Password reset link sent. Check your email.')
  }

  async function resendConfirmation() {
    if (needCaptcha()) return
    setBusy(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: withCaptcha({ emailRedirectTo: window.location.origin }) })
    setBusy(false)
    setCaptchaRound((r) => r + 1)
    if (error) return show(error)
    setUnconfirmed(false)
    setError(null)
    setInfo('Confirmation link sent again. Check your email (and spam).')
  }

  return (
    <form onSubmit={submit} className={clsx('card space-y-3 p-5 shadow-lg', className)}>
      {!official && <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-1" role="tablist">
        {(['login', 'register'] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m}
            onClick={() => { onModeChange(m); setError(null); setInfo(null); setUnconfirmed(false) }}
            className={clsx('rounded-md py-2 text-sm font-semibold', mode === m ? 'bg-card shadow-sm' : 'text-muted')}>
            {m === 'login' ? 'Log in' : 'Create account'}
          </button>
        ))}
      </div>}

      {official && (
        <>
          <select className="input py-3" value={authorityId} onChange={(e) => setAuthorityId(e.target.value)} required aria-label="City Corporation">
            <option value="">Choose your City Corporation</option>
            {cityCorps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {cityCorps.length === 0 && (
            <p className="text-xs text-muted">No City Corporation takes official sign-ups yet. An admin has to set its official email domain first.</p>
          )}
          <input className="input py-3" placeholder="Designation, e.g. Conservancy Inspector" aria-label="Designation" value={designation}
            onChange={(e) => setDesignation(e.target.value)} required maxLength={120} />
          <input className="input py-3" placeholder="Office / zone (optional), e.g. Zone 2, Mirpur" aria-label="Office" value={office}
            onChange={(e) => setOffice(e.target.value)} maxLength={200} />
        </>
      )}
      {mode === 'register' && (
        <>
          <input className="input py-3" placeholder="Full name" aria-label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)}
            required maxLength={80} autoComplete="name" />
          <input className="input py-3" placeholder="Username (e.g. rahim_mirpur)" aria-label="Username" value={username} required
            minLength={3} maxLength={24} autoComplete="username" onChange={(e) => setUsername(cleanUsername(e.target.value))} />
        </>
      )}
      <input className="input py-3" type="email" aria-label="Email address" value={email}
        placeholder={official ? (authority ? `Official email, e.g. name@${authority.email_domain}` : 'Official email') : 'Email address'}
        onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      <input className="input py-3" type="password" placeholder="Password (min 8 characters)" aria-label="Password" value={password} minLength={8}
        onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />

      <Captcha onToken={setCaptchaToken} round={captchaRound} />

      {error && <p role="alert" className="rounded-lg bg-danger-soft p-2 text-sm text-danger">{error}</p>}
      {unconfirmed && (
        <button type="button" className="block w-full text-center text-sm font-semibold text-brand hover:underline" disabled={busy}
          onClick={resendConfirmation}>
          Send the confirmation email again
        </button>
      )}
      {info && <p role="status" className="rounded-lg bg-brand-soft p-2 text-sm text-brand">{info}</p>}

      <button className="btn-primary w-full py-3 text-base" disabled={busy}>
        {busy && <Spinner className="size-4 text-brand-ink" />} {mode === 'login' ? 'Log in' : 'Create account'}
      </button>
      {mode === 'register' && (
        <p className="text-center text-xs text-muted">
          By creating an account you agree to the <Link className="text-brand hover:underline" to="/terms">Terms of Use</Link> and
          the <Link className="text-brand hover:underline" to="/privacy">Privacy Policy</Link>.
        </p>
      )}
      {mode === 'login' && (
        <button type="button" className="block w-full text-center text-sm text-brand hover:underline" disabled={busy} onClick={resetPassword}>
          Forgot password?
        </button>
      )}
      {!official && mode === 'register' && (
        <Link to="/city-corp/join" className="block text-center text-xs text-muted hover:underline">
          Work for a City Corporation? Sign up with your official email →
        </Link>
      )}
    </form>
  )
}

/** name@dncc.gov.bd and name@zone2.dncc.gov.bd both match dncc.gov.bd (same rule as the database). */
function emailAtDomain(email: string, domain: string) {
  const host = email.trim().toLowerCase().split('@')[1] ?? ''
  const d = domain.toLowerCase()
  return host === d || host.endsWith(`.${d}`)
}
