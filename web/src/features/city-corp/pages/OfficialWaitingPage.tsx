import clsx from 'clsx'
import { Building2, Clock } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useTitle } from '@/shared/hooks/useTitle'

/**
 * The whole app for an account made on the City Corporation sign-up page until an admin approves it.
 * Official accounts never get the citizen app: approved → dashboard, rejected → this page says so.
 */
export function OfficialWaitingPage() {
  useTitle('Waiting for approval')
  const { officialSignup, refreshProfile, signOut } = useAuth()
  const [checking, setChecking] = useState(false)
  if (!officialSignup) return <Navigate to="/" replace />
  const rejected = officialSignup.status === 'rejected'
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-8">
      <Link to="/" className="flex items-center justify-center gap-2">
        <img src="/favicon.svg" alt="" className="size-9" />
        <span className="text-xl font-extrabold tracking-tight text-brand">AmarShohor</span>
      </Link>
      <div className="card space-y-3 p-5">
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <Building2 className={clsx('size-6', rejected ? 'text-danger' : 'text-warn')} />
          {rejected ? 'Your official account was not approved' : 'Waiting for admin approval'}
        </h1>
        {rejected ? (
          <>
            {officialSignup.decision_note && <p className="rounded-lg bg-danger-soft p-2 text-sm text-danger">{officialSignup.decision_note}</p>}
            <p className="text-sm text-muted">
              If this is a mistake, contact your {officialSignup.authority_short_name} office or the AmarShohor team.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">
            Your <strong>{officialSignup.authority_short_name}</strong> official account ({officialSignup.designation}) is with an admin.
            Once it's approved, logging in opens your City Corporation dashboard.
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {!rejected && (
            <button className="btn-primary" disabled={checking}
              onClick={async () => { setChecking(true); await refreshProfile(); setChecking(false) }}>
              <Clock className="size-4" /> {checking ? 'Checking…' : 'Check again'}
            </button>
          )}
          <button className="btn-soft" onClick={signOut}>Log out</button>
        </div>
      </div>
    </div>
  )
}
