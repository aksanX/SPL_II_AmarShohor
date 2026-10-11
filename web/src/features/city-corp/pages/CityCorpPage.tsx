import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, Clock, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AuthForm } from '@/features/auth/components/AuthForm'
import { EmergencyReviews } from '@/features/emergency/components/EmergencyReviews'
import { LiveEmergencies } from '@/features/emergency/components/LiveEmergencies'
import { LoadError, PageSpinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useTitle } from '@/shared/hooks/useTitle'
import { authorityService } from '@/features/city-corp/services/authority.service'
import { PublicRecord } from '@/features/city-corp/components/PublicRecord'
import { AuthorityTaskRow } from '@/features/city-corp/components/AuthorityTaskRow'

type Tab = 'new' | 'active' | 'overdue' | 'done'
const TABS: { id: Tab; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'active', label: 'In progress' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'done', label: 'Resolved' },
]

const EMPTY: Record<Tab, string> = {
  new: 'No new issues. Issues appear here once residents validate a problem in your area.',
  active: 'Nothing in progress. Accept a task from "New" to start.',
  overdue: 'Nothing overdue.',
  done: 'No resolved issues yet.',
}

/** Citizens and admins: each City Corporation's public record. Officials work from their dashboard. */
export function CityCorpPage() {
  useTitle('City Corporations')
  const { role, loading } = useAuth()
  if (loading) return <PageSpinner />
  if (role === 'official') return <Navigate to="/city-corp/dashboard" replace />
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-2 py-4 sm:px-4">
      <PublicRecord />
    </div>
  )
}

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

/** Verified officials only: the work queue of their City Corporation. */
export function CityCorpDashboardPage() {
  useTitle('City Corporation dashboard')
  const { officialOf, loading } = useAuth()
  if (loading) return <PageSpinner />
  if (!officialOf) return <Navigate to="/city-corp" replace />
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-2 py-4 sm:px-4">
      <LiveEmergencies title={`Live emergencies in ${officialOf.shortName}`} />
      <EmergencyReviews />
      <OfficialDashboard shortName={officialOf.shortName} />
    </div>
  )
}

function OfficialDashboard({ shortName }: { shortName: string }) {
  const [tab, setTab] = useState<Tab>('new')
  const tasks = useQuery({ queryKey: ['authority_tasks', tab], queryFn: () => authorityService.getAuthorityTasks(tab) })

  return (
    <section className="space-y-3">
      <div className="card flex items-center gap-3 p-4">
        <div className="grid size-12 place-items-center rounded-xl bg-warn-soft text-warn"><Building2 className="size-7" /></div>
        <div>
          <h1 className="text-xl font-bold">{shortName} dashboard</h1>
          <p className="text-sm text-muted">Validated issues in your area are sent here automatically. Open one to work on it.</p>
        </div>
      </div>
      <div className="card flex gap-1 p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={clsx('flex-1 rounded-lg px-3 py-2 text-sm font-semibold',
              tab === t.id ? (t.id === 'overdue' ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand') : 'text-muted hover:bg-card-hover')}>
            {t.label}
          </button>
        ))}
      </div>
      {tasks.isLoading && <PageSpinner />}
      {tasks.isError && <LoadError what="tasks" error={tasks.error} onRetry={() => tasks.refetch()} />}
      {tasks.isSuccess && !tasks.data.length && <p className="card p-4 text-sm text-muted">{EMPTY[tab]}</p>}
      {(tasks.data ?? []).map((t) => <AuthorityTaskRow key={t.id} task={t} />)}
    </section>
  )
}

