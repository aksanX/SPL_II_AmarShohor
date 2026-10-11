import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UnusedUploads } from '@/features/admin/components/UnusedUploads'
import clsx from 'clsx'
import { Building2, History, Inbox, Plus, Settings2, Tags, Users } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Avatar, Empty, PageSpinner, Spinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useCategoryGroups } from '@/features/categories/hooks/useCategories'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { useTitle } from '@/shared/hooks/useTitle'
import { moderationService } from '@/features/admin/services/moderation.service'
import { roleService } from '@/features/admin/services/role.service'
import { categoryService } from '@/features/categories/services/category.service'
import { authorityService } from '@/features/city-corp/services/authority.service'
import { appSettingsService } from '@/shared/settings/appSettings.service'
import { CategoryIcon, ICON_NAMES } from '@/features/categories/components/CategoryIcon'
import { displayName, timeAgo } from '@/shared/lib/format'
import { ROUTE_LABEL, SEVERITIES, SEVERITY_META } from '@/features/issues/lib/issueLabels'
import type { AppSettings, Authority, Category, Severity } from '@/models'
import { useRunner } from '@/features/admin/hooks/useRunner'
import { ReviewQueue } from '@/features/admin/tabs/review-queue/ReviewQueue'
import { People } from '@/features/admin/tabs/People'
import { AuthorityEditor } from '@/features/admin/tabs/AuthorityEditor'

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

function CityCorporations() {
  const authorities = useQuery({ queryKey: ['authorities'], queryFn: authorityService.getAuthorities })
  const records = useQuery({ queryKey: ['authority_records'], queryFn: authorityService.getAuthorityRecords }).data ?? []
  const cityAdmins = (useQuery({ queryKey: ['roles', 'all'], queryFn: roleService.getRoles }).data ?? []).filter((r) => r.role === 'city_admin')
  const [editing, setEditing] = useState<Authority | 'new' | null>(null)
  if (authorities.isLoading) return <PageSpinner />
  const list = authorities.data ?? []

  if (editing) {
    return <AuthorityEditor authority={editing === 'new' ? null : editing} all={list} onDone={() => setEditing(null)} />
  }
  return (
    <div className="space-y-3">
      {list.length === 0 && (
        <Empty icon={<Building2 className="size-8" />} title="No City Corporations yet">
          Add one and draw its service area. Escalated issues are sent to the City Corporation whose area contains them.
        </Empty>
      )}
      {list.map((a) => {
        const rec = records.find((r) => r.id === a.id)
        return (
          <article key={a.id} className="card flex flex-wrap items-center gap-3 p-4">
            <Building2 className="size-6 text-warn" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{a.name} <span className="text-muted">({a.short_name})</span>{a.kind === 'agency' && <span className="chip ml-2 bg-info-soft text-info">agency</span>}{!a.is_active && <span className="chip ml-2 bg-card-hover text-muted">inactive</span>}</p>
              <p className="text-xs text-muted">
                Hotline {a.hotline || 'not set'} · targets {a.due_days_critical}/{a.due_days_high}/{a.due_days_medium}/{a.due_days_low} days
                {rec && ` · ${rec.open} open, ${rec.overdue} overdue, ${rec.resolved} resolved`}
              </p>
              {a.kind === 'city_corporation' && (() => {
                const here = cityAdmins.filter((r) => r.authority_id === a.id)
                return (
                  <p className="text-xs">
                    {here.length
                      ? <>Area admin{here.length > 1 && 's'}: {here.map((r, i) => (
                        <span key={r.user_id}>{i > 0 && ', '}<Link to={`/u/${r.username}`} className="font-semibold hover:underline">@{r.username}</Link></span>
                      ))}</>
                      : <span className="text-warn">No admin appointed yet. Appoint one in Officials &amp; admins.</span>}
                  </p>
                )
              })()}
            </div>
            <button className="btn-soft" onClick={() => setEditing(a)}>Edit</button>
          </article>
        )
      })}
      <button className="btn-primary" onClick={() => setEditing('new')}><Plus className="size-4" /> Add City Corporation</button>
    </div>
  )
}

// ---------- categories ----------

type CategoryDraft = Omit<Category, 'slug'> & { slug: string | null }

const EMPTY_CATEGORY: CategoryDraft = {
  slug: null, name: '', name_bn: '', icon: 'circle-help', color: '#64748b', resolver: 'community',
  default_severity: 'medium', sort_order: 0, is_active: true, volunteer_allowed: true, duplicate_group: null,
  group_slug: null,
}

function Categories() {
  const qc = useQueryClient()
  const categories = useQuery({ queryKey: ['categories', 'all'], queryFn: categoryService.getAllCategories })
  const [editing, setEditing] = useState<CategoryDraft | null>(null)

  if (editing) {
    return <CategoryEditor initial={editing} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['categories'] }) }} />
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2 className="px-1 font-bold">Categories</h2>
        <p className="px-1 text-xs text-muted">Reporters choose from these. New issues go to whoever usually fixes the category; you can move any issue later.</p>
        <div className="card divide-y divide-line">
          {categories.data?.map((c) => (
            <div key={c.slug} className="flex items-center gap-3 p-3 text-sm">
              <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: `${c.color}1f`, color: c.color }}>
                <CategoryIcon icon={c.icon} className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{c.name}</span> <span className="text-muted">{c.name_bn}</span>
                <span className="block text-xs text-muted">Usually {ROUTE_LABEL[c.resolver].toLowerCase()} · {SEVERITY_META[c.default_severity].label}{!c.volunteer_allowed && ' · never volunteers'}{c.duplicate_group && ` · duplicates: ${c.duplicate_group}`}{!c.is_active && ' · inactive'}</span>
              </span>
              <button className="btn-soft py-1.5 text-xs" onClick={() => setEditing(c)}>Edit</button>
            </div>
          ))}
          {!categories.data?.length && <p className="p-4 text-sm text-muted">No categories yet. Add some so people can report.</p>}
        </div>
        <button className="btn-primary" onClick={() => setEditing({ ...EMPTY_CATEGORY, sort_order: (categories.data?.length ?? 0) + 1 })}>
          <Plus className="size-4" /> Add category
        </button>
      </section>
    </div>
  )
}

function CategoryEditor({ initial, onDone }: { initial: CategoryDraft; onDone: () => void }) {
  const { busy, run } = useRunner()
  const [c, setC] = useState<CategoryDraft>(initial)
  const set = (patch: Partial<CategoryDraft>) => setC({ ...c, ...patch })
  const groups = useCategoryGroups().data ?? []

  function save() {
    run(() => categoryService.adminSaveCategory(c), 'Saved.', onDone)
  }

  return (
    <div className="card space-y-3 p-4">
      <h2 className="text-lg font-bold">{c.slug ? `Edit ${initial.name}` : 'New category'}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="c-name">Name</label>
          <input id="c-name" className="input" value={c.name} onChange={(e) => set({ name: e.target.value })} /></div>
        <div><label className="label" htmlFor="c-bn">Name in Bangla</label>
          <input id="c-bn" className="input" value={c.name_bn} onChange={(e) => set({ name_bn: e.target.value })} /></div>
        <div><label className="label" htmlFor="c-route">Usually fixed by</label>
          <select id="c-route" className="input" value={c.resolver} onChange={(e) => set({ resolver: e.target.value as Category['resolver'] })}>
            <option value="community" disabled={!c.volunteer_allowed}>Volunteers</option><option value="authority">City Corporation</option>
          </select></div>
        <div><label className="label" htmlFor="c-sev">Default severity</label>
          <select id="c-sev" className="input" value={c.default_severity} onChange={(e) => set({ default_severity: e.target.value as Severity })}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_META[s].label}</option>)}
          </select></div>
        <div><label className="label" htmlFor="c-color">Colour</label>
          <input id="c-color" type="color" className="h-10 w-full rounded-lg border border-line" value={c.color} onChange={(e) => set({ color: e.target.value })} /></div>
        <div><label className="label" htmlFor="c-order">Order in lists</label>
          <input id="c-order" type="number" className="input" value={c.sort_order} onChange={(e) => set({ sort_order: Number(e.target.value) })} /></div>
      </div>
      <div>
        <span className="label">Icon</span>
        <div className="flex flex-wrap gap-1">
          {ICON_NAMES.map((n) => (
            <button key={n} type="button" aria-label={n} onClick={() => set({ icon: n })}
              className={clsx('grid size-10 place-items-center rounded-lg border', c.icon === n ? 'border-brand bg-brand-soft' : 'border-line')}
              style={{ color: c.color }}>
              <CategoryIcon icon={n} className="size-5" />
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={!c.volunteer_allowed}
          onChange={(e) => set({ volunteer_allowed: !e.target.checked, ...(e.target.checked ? { resolver: 'authority' as const } : {}) })} />
        <span>Too dangerous for volunteers <span className="block text-xs text-muted">Live wires, open manholes… Never shown to volunteers; always sent to an authority, even by an admin.</span></span>
      </label>
      <div><label className="label" htmlFor="c-subgroup">Group</label>
        <select id="c-subgroup" className="input" value={c.group_slug ?? ''}
          onChange={(e) => set({ group_slug: e.target.value || null })}>
          <option value="">No group (only shown under View all)</option>
          {groups.filter((g) => !g.parent_slug).map((g) => (
            <optgroup key={g.slug} label={`${g.code}. ${g.name}`}>
              {groups.filter((s) => s.parent_slug === g.slug).map((s) => (
                <option key={s.slug} value={s.slug}>{s.code} {s.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">Where citizens find it under Reported issues and when reporting.</p>
      </div>
      <div><label className="label" htmlFor="c-group">Duplicate group (optional)</label>
        <input id="c-group" className="input" value={c.duplicate_group ?? ''} placeholder="e.g. waste"
          onChange={(e) => set({ duplicate_group: e.target.value || null })} />
        <p className="mt-1 text-xs text-muted">Categories with the same group count as the same problem when checking for duplicates nearby (e.g. garbage and illegal dumping).</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={c.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
        Active (inactive categories stay on old issues but can't be chosen)
      </label>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy || c.name.trim().length < 2} onClick={save}>
          {busy && <Spinner className="size-4 text-brand-ink" />} Save
        </button>
        <button className="btn-ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}

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
