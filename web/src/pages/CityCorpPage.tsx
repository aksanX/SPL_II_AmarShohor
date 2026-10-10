import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { AlarmClock, Building2, Clock, Phone, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AuthForm } from '../components/AuthForm'
import { EmergencyReviews } from '../components/EmergencyReviews'
import { LiveEmergencies } from '../components/LiveEmergencies'
import { CategoryChip, Empty, LoadError, NoPhoto, PageSpinner, SeverityBadge, StatusBadge } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useTitle } from '../hooks/useTitle'
import { getAuthorityRecords, getAuthorityTasks } from '../lib/api'
import { dueText, timeAgo } from '../lib/format'
import { mediaUrl } from '../lib/supabase'
import type { Issue } from '../lib/types'

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
  const tasks = useQuery({ queryKey: ['authority_tasks', tab], queryFn: () => getAuthorityTasks(tab) })

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

function AuthorityTaskRow({ task }: { task: Issue }) {
  const thumb = task.media.find((m) => m.media_type === 'image')
  return (
    <Link to={`/issue/${task.id}`} className="card flex gap-3 p-3 hover:bg-card-hover">
      {thumb ? <img src={mediaUrl(thumb.path)} alt="" className="size-20 shrink-0 rounded-lg object-cover" />
        : <NoPhoto />}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="line-clamp-2 font-semibold leading-snug">{task.title}</p>
        <div className="flex flex-wrap gap-1">
          <CategoryChip issue={task} />
          <SeverityBadge severity={task.severity} />
          <StatusBadge status={task.status} />
        </div>
        <p className="text-xs text-muted">{task.address || `${task.lat.toFixed(4)}, ${task.lng.toFixed(4)}`}</p>
        {task.status !== 'closed' ? (
          <p className={clsx('flex items-center gap-1 text-xs font-semibold', task.is_overdue ? 'text-danger' : 'text-warn')}>
            {task.is_overdue ? <AlarmClock className="size-3.5" /> : <Clock className="size-3.5" />} {dueText(task.due_at)}
            {task.volunteer_username && <span className="font-normal text-muted"> · {task.volunteer_full_name || task.volunteer_username} on it</span>}
          </p>
        ) : (
          <p className="text-xs text-muted">Resolved {task.closed_at ? timeAgo(task.closed_at) : ''}</p>
        )}
      </div>
    </Link>
  )
}

function PublicRecord() {
  const records = useQuery({ queryKey: ['authority_records'], queryFn: getAuthorityRecords })
  if (records.isLoading) return <PageSpinner />
  if (records.isError) return <LoadError what="the City Corporation record" error={records.error} onRetry={() => records.refetch()} />
  const list = records.data ?? []
  return (
    <section className="space-y-3">
      <div className="px-1">
        <h2 className="text-lg font-bold">City Corporation record</h2>
        <p className="text-sm text-muted">Facts only: what was sent to each City Corporation and what got fixed, confirmed by residents.</p>
      </div>
      {!list.length && <Empty icon={<Building2 className="size-8" />} title="No City Corporations set up yet" />}
      {list.map((r) => (
        <article key={r.id} className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="size-5 text-warn" />
            <h3 className="font-bold">{r.name}</h3>
            {!r.is_active && (
              <span className="chip bg-card-hover text-muted" title="Gets no new issues; its record stays visible">Switched off</span>
            )}
            {r.hotline && (
              <span className="ml-auto flex items-center gap-1 text-sm">
                <Phone className="size-4 text-muted" /> <span className="select-all font-semibold">{r.hotline}</span>
              </span>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
            <Stat label="Sent to them" value={r.escalated} />
            <Stat label="Resolved" value={r.resolved} />
            <Stat label="Open" value={r.open} />
            <Stat label="Overdue" value={r.overdue} danger={r.overdue > 0} />
            <Stat label="Avg. days to fix" value={r.avg_days_to_resolve ?? '–'} />
          </dl>
        </article>
      ))}
    </section>
  )
}

function Stat({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className={clsx('rounded-lg p-2', danger ? 'bg-danger-soft text-danger' : 'bg-bg')}>
      <dd className="text-xl font-bold tabular-nums">{value}</dd>
      <dt className="text-xs text-muted">{label}</dt>
    </div>
  )
}
