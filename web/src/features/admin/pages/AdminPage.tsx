import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UnusedUploads } from '@/features/admin/components/UnusedUploads'
import clsx from 'clsx'
import { Building2, History, Inbox, Settings2, Tags, Users } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Avatar, PageSpinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { useTitle } from '@/shared/hooks/useTitle'
import { moderationService } from '@/features/admin/services/moderation.service'
import { roleService } from '@/features/admin/services/role.service'
import { appSettingsService } from '@/shared/settings/appSettings.service'
import { displayName, timeAgo } from '@/shared/lib/format'
import type { AppSettings } from '@/models'
import { useRunner } from '@/features/admin/hooks/useRunner'
import { ReviewQueue } from '@/features/admin/tabs/review-queue/ReviewQueue'
import { People } from '@/features/admin/tabs/People'
import { CityCorporations } from '@/features/admin/tabs/CityCorporations'
import { Categories } from '@/features/admin/tabs/Categories'

type Tab = 'queue' | 'people' | 'citycorps' | 'categories' | 'settings' | 'log'

/** Super admins get every tab; city admins only what concerns their own City Corporation. */
function tabsFor(isAdmin: boolean): { id: Tab; label: string; icon: ReactNode }[] {
  return [
    { id: 'queue', label: 'Review queue', icon: <Inbox className="size-5" /> },
    { id: 'people', label: isAdmin ? 'Officials & admins' : 'Officials', icon: <Users className="size-5" /> },
    ...(isAdmin ? [
      { id: 'citycorps' as const, label: 'City Corporations', icon: <Building2 className="size-5" /> },
      { id: 'categories' as const, label: 'Categories', icon: <Tags className="size-5" /> },
      { id: 'settings' as const, label: 'Settings', icon: <Settings2 className="size-5" /> },
    ] : []),
    { id: 'log', label: 'Activity log', icon: <History className="size-5" /> },
  ]
}

export function AdminPage() {
  const { user, profile, isAdmin, cityAdminOf, loading } = useAuth()
  useTitle(cityAdminOf && !isAdmin ? `${cityAdminOf.area} admin` : 'Admin')
  const [tab, setTab] = useState<Tab>('queue')
  if (loading) return <PageSpinner />
  if (!user || (!isAdmin && !cityAdminOf)) return <Navigate to="/" replace />
  const tabs = tabsFor(isAdmin)

  return (
    <div className="mx-auto flex max-w-7xl gap-6 px-2 py-4 sm:px-4">
      {/* Wide screens: the sections down the left, like the citizen feed's sidebar. */}
      <aside className="sticky top-16 hidden max-h-[calc(100vh-5rem)] w-64 shrink-0 overflow-y-auto pb-6 lg:block">
        {profile && (
          <Link to={`/u/${profile.username}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-card-hover">
            <Avatar url={profile.avatar_url} name={displayName(profile.full_name, profile.username)} size={32} />
            <span className="min-w-0">
              <span className="block truncate font-semibold">{displayName(profile.full_name, profile.username)}</span>
              <span className="block text-xs text-muted">{isAdmin ? 'Super admin' : `${cityAdminOf?.area} admin`}</span>
            </span>
          </Link>
        )}
        <nav className="mt-1" role="tablist" aria-orientation="vertical" aria-label="Admin sections">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={clsx('flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm font-medium',
                tab === t.id ? 'bg-brand-soft text-brand' : 'hover:bg-card-hover [&>svg]:text-muted')}>
              {t.icon} {t.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="w-full min-w-0 flex-1 space-y-4">
        {/* Phones and small screens: no room for a sidebar, so the sections scroll sideways at the top. */}
        <div className="card flex gap-1 overflow-x-auto p-1 lg:hidden" role="tablist" aria-label="Admin sections">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={clsx('flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold [&>svg]:size-4',
                tab === t.id ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-card-hover')}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        {tab === 'queue' && <ReviewQueue />}
        {tab === 'people' && <People />}
        {tab === 'citycorps' && <CityCorporations />}
        {tab === 'categories' && <Categories />}
        {tab === 'settings' && <><SettingsTab /><div className="mt-4"><UnusedUploads /></div></>}
        {tab === 'log' && <ActivityLog />}
      </main>
    </div>
  )
}

// ---------- review queue ----------

// ---------- officials & admins ----------

// ---------- City Corporations ----------

// ---------- categories ----------

// ---------- settings ----------

const SETTING_GROUPS: { title: string; fields: { key: keyof AppSettings; label: string; step?: number }[] }[] = [
  {
    title: 'Volunteers', fields: [
      { key: 'lock_hours', label: 'Solo task lock (hours)' },
      { key: 'team_lock_hours', label: 'Team task lock (hours)' },
      { key: 'team_max_size', label: 'Most people in a team (leader included)' },
      { key: 'max_active_tasks', label: 'Max tasks one person can lead' },
      { key: 'escalation_retake_days', label: 'Days before a volunteer can retake an issue they escalated' },
    ],
  },
  {
    title: 'Reputation', fields: [
      { key: 'rep_task_completed', label: 'Confirmed fix' },
      { key: 'rep_task_expired', label: 'Lock expired / removed' },
      { key: 'rep_task_reopened', label: 'Fake or bad fix' },
      { key: 'rep_per_star', label: 'Per star above/below 3' },
      { key: 'rep_escalation_abuse', label: 'Repeated rejected City Corporation requests' },
      { key: 'escalation_abuse_rejections', label: '…after this many rejections' },
      { key: 'rep_wrong_issue_lie', label: 'False "report is wrong" claim' },
      { key: 'rep_false_emergency', label: 'False emergency alert' },
    ],
  },
  {
    title: 'Stuck issues', fields: [
      { key: 'stuck_release_count', label: 'Releases before an issue counts as stuck' },
      { key: 'stuck_days', label: 'Days with no volunteer before it counts as stuck' },
    ],
  },
  {
    title: 'Emergencies', fields: [
      { key: 'emergency_radius_m', label: 'Alert radius (m)' },
      { key: 'emergency_new_account_radius_m', label: 'Alert radius for new accounts (m)' },
      { key: 'emergency_hours', label: 'Alert ends after (hours)' },
      { key: 'emergency_max_per_day', label: 'Max alerts per person per day' },
      { key: 'emergency_hide_denials', label: '"Not true" answers that hide an alert' },
      { key: 'emergency_verify_confirms', label: 'On-site confirmations that verify an alert' },
      { key: 'emergency_verify_radius_m', label: 'On-site distance for verifying (m)' },
      { key: 'live_capture_seconds', label: 'Seconds to take and send a live photo' },
      { key: 'rep_false_confirm', label: 'Reputation change for confirming a rejected emergency' },
    ],
  },
  {
    title: 'Daily limits', fields: [
      { key: 'max_reports_per_day', label: 'Reports one person can post a day' },
      { key: 'max_flags_per_day', label: 'Reports and comments one person can flag a day' },
    ],
  },
  {
    title: 'Area admins', fields: [
      { key: 'city_admin_hours', label: 'Hours an area admin has before a case goes to the super admins' },
      { key: 'city_admin_reminder_hours', label: 'Remind the area admin this many hours before that' },
    ],
  },
  {
    title: 'Wrong categories', fields: [
      { key: 'recategorize_confirms', label: 'On-site confirmers naming the same category to change it' },
      { key: 'recategorize_votes', label: 'People in total naming the same category to change it' },
    ],
  },
  {
    title: 'Validation', fields: [
      { key: 'threshold_critical', label: 'Score needed: critical' },
      { key: 'threshold_high', label: 'Score needed: high' },
      { key: 'threshold_medium', label: 'Score needed: medium' },
      { key: 'threshold_low', label: 'Score needed: low' },
      { key: 'resolution_quorum', label: 'Neighbours needed to confirm a fix' },
    ],
  },
]

function SettingsTab() {
  const qc = useQueryClient()
  const settings = useAppSettings().data
  const { busy, run } = useRunner()
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    if (settings) setValues(Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, String(v)])))
  }, [settings])
  if (!settings) return <PageSpinner />

  const changed = Object.fromEntries(
    Object.entries(values)
      .filter(([k, v]) => String((settings as unknown as Record<string, unknown>)[k]) !== v && v.trim() !== '' && !Number.isNaN(Number(v)))
      .map(([k, v]) => [k, Number(v)]),
  )

  return (
    <div className="space-y-4">
      {SETTING_GROUPS.map((g) => (
        <section key={g.title} className="card space-y-2 p-4">
          <h2 className="font-bold">{g.title}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {g.fields.map((f) => (
              <label key={f.key} className="text-sm">
                <span className="text-muted">{f.label}</span>
                <input type="number" step={f.step ?? 1} className="input" value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
              </label>
            ))}
          </div>
        </section>
      ))}
      <button className="btn-primary w-full" disabled={busy || Object.keys(changed).length === 0}
        onClick={() => run(() => appSettingsService.adminUpdateSettings(changed), 'Settings saved.', () => qc.invalidateQueries({ queryKey: ['app_settings'] }))}>
        Save {Object.keys(changed).length || ''} change{Object.keys(changed).length === 1 ? '' : 's'}
      </button>
    </div>
  )
}

// ---------- log ----------

function ActivityLog() {
  const { isAdmin, cityAdminOf } = useAuth()
  // Super admins: whose actions to show. '' = everyone, 'super' = super admins, else an area admin's area.
  // Filtered in the database, so one admin's latest actions show however busy everyone else was.
  const [who, setWho] = useState('')
  const log = useQuery({ queryKey: ['admin_log', who], queryFn: () => moderationService.getAdminLog(200, who || null) })
  const areas = [...new Set((useQuery({ queryKey: ['roles', 'all'], queryFn: roleService.getRoles }).data ?? [])
    .filter((r) => r.role === 'city_admin' && r.authority_area).map((r) => r.authority_area as string))].sort()
  if (log.isLoading && !log.data) return <PageSpinner />
  const shown = log.data ?? []
  return (
    <div className="card divide-y divide-line">
      {!isAdmin && cityAdminOf && (
        <p className="p-3 text-xs text-muted">Your own actions, and every admin action about {cityAdminOf.area}'s issues, alerts and officials.</p>
      )}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 p-3">
          <label className="text-sm text-muted" htmlFor="log-who">Show actions by</label>
          <select id="log-who" className="input w-auto py-1.5" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {areas.map((a) => <option key={a} value={a}>{a} admin</option>)}
            <option value="super">Super admins</option>
          </select>
        </div>
      )}
      {shown.map((l) => (
        <div key={l.id} className="p-3 text-sm">
          <p>
            <strong>{l.admin_username ?? 'someone'}</strong>
            {l.admin_city && <span className="chip ml-1 bg-brand-soft px-1.5 text-[10px] text-brand">{l.admin_city} admin</span>}
            {' '}· {l.action.replaceAll('_', ' ')}
            {l.issue_title && <> on <Link to={`/issue/${l.issue_id}`} className="font-semibold hover:underline">"{l.issue_title}"</Link></>}
            {l.target_username && <> for <Link to={`/u/${l.target_username}`} className="hover:underline">@{l.target_username}</Link></>}
            {/* Deleted accounts: the profile is gone, so the log keeps the name. */}
            {!l.target_username && typeof l.data.username === 'string' && <> for @{l.data.username}</>}
            <span className="text-xs text-muted"> · {timeAgo(l.created_at)}</span>
          </p>
          {l.reason && <p className="text-muted">{l.reason}</p>}
        </div>
      ))}
      {!shown.length && <p className="p-4 text-sm text-muted">No admin actions yet.</p>}
    </div>
  )
}
