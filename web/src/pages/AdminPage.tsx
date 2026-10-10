import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UnusedUploads } from '../components/UnusedUploads'
import clsx from 'clsx'
import {
  Building2, Check, ClipboardList, History, Inbox, Plus, Settings2, Tags, Trash2, Users, X,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { EmergencyReviews } from '../components/EmergencyReviews'
import { LiveEmergencies } from '../components/LiveEmergencies'
import { useInvalidateIssue } from '../components/IssueDialogs'
import { AreaDrawer } from '../components/map/AreaDrawer'
import { polygonFromRing, ringFromGeoJSON, type LatLng } from '../lib/mapMath'
import { MediaGallery } from '../components/MediaGallery'
import { Avatar, CategoryChip, Empty, PageSpinner, Spinner, StatusBadge } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useAppSettings, useCategoryGroups } from '../hooks/useData'
import { useTitle } from '../hooks/useTitle'
import { useToast } from '../hooks/useToast'
import {
  adminDecideAppeal, adminDecideCategory, adminDecideEscalation, adminDecideRoleRequest, adminDecideWrongReport,
  adminDismissReview, adminGrantCityAdmin, adminRevokeRole, adminSaveAuthority, adminSaveCategory, adminSetRoute,
  adminUpdateSettings, getAdminLog, getAllCategories, getAuthorities, getAuthorityRecords,
  getAreaOverview, getReviewQueue, getRoleRequests, getRoles,
} from '../lib/api'
import { cleanUsername } from '../lib/auth'
import { CategoryIcon, ICON_NAMES } from '../lib/categories'
import { ROUTE_LABEL, SEVERITIES, SEVERITY_META, areaLabel, displayName, timeAgo } from '../lib/format'
import type { AppSettings, AreaOverviewRow, Authority, Category, EmergencyContact, ReviewItem, ReviewKind, Severity, UserRole } from '../lib/types'

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

/** Hours a city admin has before a case goes up to the super admins (setting city_admin_hours). */
function useCityAdminHours() {
  return useAppSettings().data?.city_admin_hours ?? 24
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

function useRunner() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<unknown>, ok: string, after?: () => void) {
    setBusy(true)
    try {
      await action()
      toast.success(ok)
      after?.()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

// ---------- review queue ----------

const KIND_META: Record<ReviewKind, { label: string; help: string }> = {
  escalation_request: { label: 'Needs City Corporation?', help: 'A volunteer says this is too big for volunteers.' },
  wrong_issue: { label: 'Report is wrong?', help: 'A volunteer or official says it is already fixed, fake or misplaced. If they are wrong, send it back to be fixed.' },
  stuck: { label: 'Stuck', help: 'Released too often or nobody took it for too long.' },
  no_authority: { label: 'No City Corporation', help: 'No City Corporation covers this location. Add or redraw one, or send it to volunteers.' },
  send_back: { label: 'Official: volunteers can do it', help: 'A City Corporation official says local volunteers can handle it.' },
  appeal: {
    label: 'Appeal: hidden report',
    help: 'The reporter says their hidden report is real. Restoring it brings it back and sets the flags against it aside; those flaggers count for less next time.',
  },
  category_mismatch: {
    label: 'Wrong category?',
    help: 'People who saw it say it is a different kind of problem, but they disagree or it is already being worked on. Compare the photo with their suggestions.',
  },
}

function ReviewQueue() {
  const { isAdmin, cityAdminOf } = useAuth()
  const q = useQuery({ queryKey: ['review_queue'], queryFn: getReviewQueue })
  if (q.isLoading) return <PageSpinner />
  if (q.error) return <Empty title="Couldn't load the queue">{(q.error as Error).message}</Empty>
  const items = q.data ?? []

  return (
    <div className="space-y-3">
      <LiveEmergencies title={isAdmin ? 'Live emergencies' : `Live emergencies in ${cityAdminOf?.area}`} />
      <EmergencyReviews />
      {isAdmin ? <SuperAdminQueue items={items} /> : items.length
        ? items.map((r) => <ReviewCard key={r.id} item={r} />)
        : (
          <Empty icon={<ClipboardList className="size-8" />} title="Nothing to decide">
            New cases in {cityAdminOf?.area} appear here when a volunteer, official or resident asks for a decision.
          </Empty>
        )}
    </div>
  )
}

/**
 * The super admin doesn't work through every case: each area's admin does. They see what only they can take
 * ("Needs you"), and an overview of how each area admin is keeping up. Opening an area shows its cases.
 */
function SuperAdminQueue({ items }: { items: ReviewItem[] }) {
  const overview = useQuery({ queryKey: ['area_overview'], queryFn: getAreaOverview })
  const [openArea, setOpenArea] = useState<string | null>(null)
  const needsMe = items.filter((r) => r.needs_super_admin)

  return (
    <>
      {needsMe.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 font-bold">Needs you ({needsMe.length})</h2>
          <p className="px-1 text-xs text-muted">Places with no City Corporation or no area admin, and cases an area admin left too long.</p>
          {needsMe.map((r) => <ReviewCard key={r.id} item={r} />)}
        </section>
      )}
      <section className="space-y-2">
        <h2 className="px-1 font-bold">Area admins</h2>
        <p className="px-1 text-xs text-muted">
          Each area's admin decides its cases. Check here that they keep up; open an area to see its cases and step in if needed.
          Their decisions are in the Activity log.
        </p>
        {overview.isLoading && <PageSpinner />}
        {overview.error && <Empty title="Couldn't load the overview">{(overview.error as Error).message}</Empty>}
        <div className="card divide-y divide-line">
          {(overview.data ?? []).map((row) => {
            const key = row.area_id ?? 'outside'
            const cases = items.filter((r) => r.city_id === row.area_id)
            return (
              <div key={key}>
                <AreaRow row={row} open={openArea === key} onToggle={() => setOpenArea(openArea === key ? null : key)} />
                {openArea === key && (
                  <div className="space-y-2 bg-bg p-2">
                    {cases.length
                      ? cases.map((r) => <ReviewCard key={r.id} item={r} />)
                      : <p className="p-2 text-sm text-muted">No open cases in {row.area}.</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}

/** On track / falling behind / no admin, from the overview numbers. */
function areaStatus(row: AreaOverviewRow, now: number): { label: string; tone: string } {
  if (!row.area_id) {
    return row.open_cases ? { label: 'Yours to decide', tone: 'bg-danger-soft text-danger' } : { label: 'Nothing waiting', tone: 'bg-card-hover text-muted' }
  }
  if (!row.admins.length) return { label: 'No admin', tone: 'bg-danger-soft text-danger' }
  if (row.overdue_cases > 0) return { label: 'Falling behind', tone: 'bg-warn-soft text-warn' }
  const quietDays = row.last_action_at ? (now - Date.parse(row.last_action_at)) / 86_400_000 : Infinity
  if (row.open_cases > 0 && quietDays > 3) return { label: 'Inactive', tone: 'bg-warn-soft text-warn' }
  return { label: 'On track', tone: 'bg-brand-soft text-brand' }
}

function AreaRow({ row, open, onToggle }: { row: AreaOverviewRow; open: boolean; onToggle: () => void }) {
  const hours = useCityAdminHours()
  const [now] = useState(() => Date.now())
  const status = areaStatus(row, now)
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-3 text-left text-sm hover:bg-card-hover">
      <span className="min-w-40 flex-1">
        <span className="font-semibold">{row.area}</span>
        <span className="block text-xs text-muted">
          {!row.area_id ? 'Cases nobody else covers'
            : row.admins.length ? row.admins.map((a) => `@${a.username}`).join(', ') : 'No admin appointed yet'}
        </span>
      </span>
      <span className="flex flex-wrap gap-1 text-xs">
        <span className="chip bg-card-hover text-muted">{row.open_cases} open</span>
        {row.overdue_cases > 0 && <span className="chip bg-warn-soft text-warn">{row.overdue_cases} over {hours} h</span>}
        {row.pending_emergencies > 0 && <span className="chip bg-danger-soft text-danger">{row.pending_emergencies} emergenc{row.pending_emergencies === 1 ? 'y' : 'ies'} to check</span>}
        {row.area_id && row.admins.length > 0 && (
          <>
            <span className="chip bg-card-hover text-muted">
              {row.decided_30d} decided in 30 days{row.avg_hours_to_decide !== null && `, ~${Math.round(row.avg_hours_to_decide)} h each`}
            </span>
            <span className="chip bg-card-hover text-muted">{row.last_action_at ? `Active ${timeAgo(row.last_action_at)}` : 'Not active yet'}</span>
          </>
        )}
      </span>
      <span className={clsx('chip shrink-0', status.tone)}>{status.label}</span>
    </button>
  )
}

/** Why a case is with the super admins, or how long the city admin has left. */
function RoutingChip({ item }: { item: ReviewItem }) {
  const { isAdmin } = useAuth()
  const hours = useCityAdminHours()
  const [now] = useState(() => Date.now())  // when the queue was opened; good enough for "hours left"
  if (isAdmin) {
    if (!item.super_reason) {
      return <span className="chip bg-card-hover text-muted">With the {item.city_area} admin</span>
    }
    const why = item.super_reason === 'no_city_corporation' ? 'No City Corporation covers this place'
      : item.super_reason === 'waited' ? `${item.city_area} admin didn't decide within ${hours} h`
        : item.super_reason === 'own_report' ? 'reported or requested by an area admin'
        : `${item.city_area} has no admin yet`
    return <span className="chip bg-danger-soft text-danger">For you: {why}</span>
  }
  if (item.passed_up_at) {
    return <span className="chip bg-danger-soft text-danger">Over {hours} h: the super admins can decide it too</span>
  }
  const left = Math.ceil((new Date(item.clock_from).getTime() + hours * 3_600_000 - now) / 3_600_000)
  return <span className="chip bg-card-hover text-muted">{Math.max(left, 1)} h left before it goes to the super admins</span>
}

function ReviewCard({ item }: { item: ReviewItem }) {
  const { isAdmin, profile } = useAuth()
  const categories = (useQuery({ queryKey: ['categories', 'all'], queryFn: getAllCategories }).data ?? []).filter((c) => c.is_active)
  const invalidate = useInvalidateIssue()
  const { busy, run } = useRunner()
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState('')
  const issue = item.issue
  // Nobody decides a case on their own report or request; reports and requests by area admins go to the
  // super admin only (0051).
  const mineToo = issue.is_mine || (Boolean(profile) && item.requester_username === profile?.username)
  const ownCase = mineToo || (!isAdmin && item.super_reason === 'own_report')
  const meta = KIND_META[item.kind]
  const done = () => invalidate(issue.id)
  const noReason = reason.trim().length < 5

  return (
    <article className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip bg-warn-soft text-warn">{meta.label}</span>
        {isAdmin && (
          <span className="chip bg-card-hover text-muted"><Building2 className="size-3.5" /> {item.city_area ?? 'No City Corporation'}</span>
        )}
        <RoutingChip item={item} />
        <span className="text-xs text-muted">{timeAgo(item.created_at)}</span>
        {item.requester_username && (
          <span className="text-xs text-muted">· by <Link className="font-semibold hover:underline" to={`/u/${item.requester_username}`}>
            {displayName(item.requester_full_name, item.requester_username)}</Link></span>
        )}
      </div>
      <div className="flex gap-3">
        {issue.media[0]?.media_type === 'image' && (
          <div className="w-28 shrink-0 overflow-hidden rounded-lg"><MediaGallery items={[issue.media[0]]} /></div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <Link to={`/issue/${issue.id}`} className="font-semibold hover:underline">{issue.title}</Link>
          <div className="flex flex-wrap gap-1">
            <CategoryChip issue={issue} />
            <StatusBadge status={issue.status} />
            <span className="chip bg-card-hover text-muted">Route: {ROUTE_LABEL[issue.route]}</span>
            {issue.size && <span className="chip bg-card-hover text-muted">{issue.size}</span>}
          </div>
          <p className="text-xs text-muted">{issue.address}</p>
        </div>
      </div>
      <p className="text-sm text-muted">{meta.help}</p>
      {ownCase && (
        <p className="rounded-lg bg-warn-soft p-3 text-sm text-warn">
          {issue.is_mine ? 'This is your own report' : mineToo ? 'You made this request yourself' : 'An area admin reported or asked for this'},
          {' '}so the super admin decides it.
        </p>
      )}
      {item.note && <blockquote className="rounded-lg bg-bg p-3 text-sm">“{item.note}”{item.data.wrong_type && ` (${item.data.wrong_type.replace('_', ' ')})`}</blockquote>}
      {item.evidence.length > 0 && <div className="max-w-sm overflow-hidden rounded-lg"><MediaGallery items={item.evidence} /></div>}

      {!ownCase && <>
      <textarea className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required, shown on the issue timeline)" aria-label="Reason" />

      {item.kind === 'escalation_request' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="btn-primary" disabled={busy || noReason}
            onClick={() => run(() => adminDecideEscalation(issue.id, true, reason), 'Sent to the City Corporation.', done)}>
            <Building2 className="size-4" /> Approve: send to City Corporation
          </button>
          <button className="btn-soft" disabled={busy || noReason}
            onClick={() => run(() => adminDecideEscalation(issue.id, false, reason), 'Kept with volunteers.', done)}>
            <Users className="size-4" /> Reject: volunteers can do it
          </button>
        </div>
      ) : item.kind === 'category_mismatch' ? (
        <div className="space-y-2">
          <ul className="space-y-1 rounded-lg bg-bg p-3 text-sm">
            <li className="flex justify-between gap-2">
              <span>As listed: <strong>{issue.category_name ?? 'no category'}</strong></span>
              <span className="text-muted">{item.data.confirmed_as_is ?? 0} confirmed on site</span>
            </li>
            {(item.data.suggestions ?? []).map((s) => (
              <li key={s.category} className="flex justify-between gap-2">
                <span>{categories.find((c) => c.slug === s.category)?.name ?? s.category}</span>
                <span className="text-muted">{s.votes} say so{s.on_site > 0 && `, ${s.on_site} on site`}</span>
              </li>
            ))}
          </ul>
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">Choose the right category…</option>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="btn-primary" disabled={busy || noReason || !category || category === issue.category}
              onClick={() => run(() => adminDecideCategory(issue.id, category, reason), 'Category changed.', done)}>
              Change category
            </button>
            <button className="btn-soft" disabled={busy || noReason}
              onClick={() => run(() => adminDecideCategory(issue.id, null, reason), 'Category kept.', done)}>
              Keep {issue.category_name ?? 'as is'}
            </button>
          </div>
        </div>
      ) : item.kind === 'appeal' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="btn-primary" disabled={busy || noReason}
            onClick={() => run(() => adminDecideAppeal(issue.id, true, reason), 'Restored.', done)}>
            It's real: restore it
          </button>
          <button className="btn-soft" disabled={busy || noReason}
            onClick={() => run(() => adminDecideAppeal(issue.id, false, reason), 'Kept hidden.', done)}>
            Keep it hidden
          </button>
        </div>
      ) : item.kind === 'wrong_issue' ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <button className="btn-primary" disabled={busy || noReason}
            onClick={() => run(() => adminDecideWrongReport(issue.id, 'close', reason), 'Closed as already fixed.', done)}>
            They're right: already fixed
          </button>
          <button className="btn-soft" disabled={busy || noReason}
            onClick={() => run(() => adminDecideWrongReport(issue.id, 'hide', reason), 'Hidden.', done)}>
            They're right: fake or wrong place
          </button>
          <button className="btn-danger" disabled={busy || noReason}
            onClick={() => run(() => adminDecideWrongReport(issue.id, 'lie', reason),
              issue.route === 'authority'
                ? 'Back with the City Corporation; the false claim cost reputation.'
                : 'Back to volunteers; the false claim cost reputation.', done)}>
            Report is real: send it back to be fixed
          </button>
        </div>
      ) : item.kind === 'send_back' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <button className="btn-soft" disabled={busy || noReason}
            onClick={() => run(() => adminSetRoute(issue.id, 'community', reason, null), 'Sent to volunteers.', done)}>
            <Users className="size-4" /> Agree: send to volunteers
          </button>
          <button className="btn-soft" disabled={busy || noReason}
            onClick={() => run(() => adminDismissReview(item.id, reason), 'Kept with the City Corporation.', done)}>
            <Building2 className="size-4" /> Disagree: keep with City Corporation
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.length > 0 && (
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">{issue.category ? `Keep category (${issue.category_name})` : 'Choose a category (optional)'}</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <button className="btn-soft" disabled={busy || noReason}
              onClick={() => run(() => adminSetRoute(issue.id, 'community', reason, category || null), 'Sent to volunteers.', done)}>
              <Users className="size-4" /> Send to volunteers
            </button>
            <button className="btn-soft" disabled={busy || noReason}
              onClick={() => run(() => adminSetRoute(issue.id, 'authority', reason, category || null), 'Sent to the City Corporation.', done)}>
              <Building2 className="size-4" /> Send to City Corporation
            </button>
            {item.kind !== 'no_authority' && (
              <button className="btn-ghost" disabled={busy || noReason || issue.route === 'pending'}
                title={issue.route === 'pending' ? 'Choose a route first' : 'Close this item without changing the issue'}
                onClick={() => run(() => adminDismissReview(item.id, reason), 'Dismissed.', done)}>
                <X className="size-4" /> Leave as is
              </button>
            )}
          </div>
          {item.kind === 'no_authority' && (
            <p className="text-xs text-muted">
              Draw or fix a City Corporation area in the City Corporations tab: issues waiting inside it are sent there
              automatically. Or send this one to volunteers.
            </p>
          )}
        </div>
      )}
      </>}
    </article>
  )
}

// ---------- officials & admins ----------

function People() {
  const { user, isAdmin, cityAdminOf } = useAuth()
  const qc = useQueryClient()
  const requests = useQuery({ queryKey: ['role_requests'], queryFn: () => getRoleRequests('pending') })
  const roles = useQuery({ queryKey: ['roles', 'all'], queryFn: getRoles })
  const cities = (useQuery({ queryKey: ['authorities'], queryFn: getAuthorities }).data ?? [])
    .filter((a) => a.kind === 'city_corporation' && a.is_active)
  const { busy, run } = useRunner()
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [newCityAdmin, setNewCityAdmin] = useState('')
  const [newCity, setNewCity] = useState('')
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['role_requests'] })
    qc.invalidateQueries({ queryKey: ['roles'] })
  }
  const reasonFor = (k: string) => reasons[k] ?? ''
  const setReason = (k: string, v: string) => setReasons((r) => ({ ...r, [k]: v }))
  const all = roles.data ?? []
  // A city admin sees and manages only their own City Corporation's people.
  const inMyCity = (r: UserRole) => isAdmin || r.authority_id === cityAdminOf?.id
  const officials = all.filter((r) => r.role === 'official' && inMyCity(r))
  const cityAdmins = all.filter((r) => r.role === 'city_admin' && inMyCity(r))
  const superAdmins = all.filter((r) => r.role === 'admin')
  const city = isAdmin ? null : cityAdminOf?.area

  const roleRow = (r: UserRole, canRemove: boolean) => {
    const key = `${r.user_id}:${r.role}`
    return (
      <div key={key} className="flex flex-wrap items-center gap-2 p-3 text-sm">
        <Link to={`/u/${r.username}`} className="min-w-0 flex-1 font-semibold hover:underline">{displayName(r.full_name, r.username)}</Link>
        <span className={clsx('chip', r.role === 'official' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand')}>
          {r.role === 'admin' ? 'Super admin' : r.role === 'city_admin' ? `${r.authority_area} admin` : `${r.authority_short_name} official`}
        </span>
        {canRemove && r.user_id !== user?.id && (
          <>
            <input className="input w-48 py-1.5 text-xs" maxLength={500} value={reasonFor(key)} onChange={(e) => setReason(key, e.target.value)}
              placeholder="Reason to remove" aria-label="Reason to remove" />
            <button className="btn-ghost px-2 py-1 text-xs text-danger" disabled={busy || reasonFor(key).trim().length < 5}
              onClick={() => run(() => adminRevokeRole(r.username, r.role, reasonFor(key)), 'Role removed.', refresh)}>
              <Trash2 className="size-3.5" /> Remove
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="px-1 font-bold">Requests to be {city ? `a ${city}` : 'an'} official ({requests.data?.length ?? 0})</h2>
        {requests.isLoading && <PageSpinner />}
        {!requests.isLoading && !requests.data?.length && <p className="card p-4 text-sm text-muted">No pending requests.</p>}
        {requests.data?.map((r) => (
          <article key={r.id} className="card space-y-2 p-4">
            <p className="text-sm">
              <Link to={`/u/${r.username}`} className="font-semibold hover:underline">{displayName(r.full_name, r.username)}</Link>{' '}
              wants to be a <strong>{r.authority_short_name}</strong> official · account {timeAgo(r.account_created_at).replace(' ago', '')} old
            </p>
            <dl className="grid gap-1 text-sm sm:grid-cols-[120px_1fr]">
              <dt className="text-muted">Designation</dt><dd>{r.designation}</dd>
              {r.office && <><dt className="text-muted">Office</dt><dd>{r.office}</dd></>}
              {r.message && <><dt className="text-muted">Message</dt><dd className="whitespace-pre-line">{r.message}</dd></>}
            </dl>
            {r.user_id === user?.id ? (
              <p className="rounded-lg bg-bg p-3 text-sm text-muted">This is your own request. Another admin has to decide it.</p>
            ) : (
              <>
                <p className="text-xs text-muted">Check their identity with the City Corporation (official email, staff ID or phone call) before approving.</p>
                <input className="input" maxLength={500} value={reasonFor(`r${r.id}`)} onChange={(e) => setReason(`r${r.id}`, e.target.value)}
                  placeholder="How you verified them / why you reject" aria-label="Reason" />
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-primary" disabled={busy || reasonFor(`r${r.id}`).trim().length < 5}
                    onClick={() => run(() => adminDecideRoleRequest(r.id, true, reasonFor(`r${r.id}`)), 'Approved.', refresh)}>
                    <Check className="size-4" /> Approve
                  </button>
                  <button className="btn-soft" disabled={busy || reasonFor(`r${r.id}`).trim().length < 5}
                    onClick={() => run(() => adminDecideRoleRequest(r.id, false, reasonFor(`r${r.id}`)), 'Rejected.', refresh)}>
                    <X className="size-4" /> Reject
                  </button>
                </div>
              </>
            )}
          </article>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="px-1 font-bold">{city ? `${city} officials` : 'Officials'} ({officials.length})</h2>
        <div className="card divide-y divide-line">
          {officials.map((r) => roleRow(r, true))}
          {!officials.length && <p className="p-4 text-sm text-muted">No verified officials yet. They ask from Settings and their requests appear above.</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 font-bold">Area admins</h2>
        {isAdmin ? (
          <>
            <p className="px-1 text-xs text-muted">
              Appoint one admin for each area. The Dhaka North admin sees only Dhaka North, the Dhaka South admin only
              Dhaka South. Admins are independent, not City Corporation staff, and can't also be officials. Until an area has
              its own admin, you look after its cases.
            </p>
            <div className="card divide-y divide-line">
              {cities.map((c) => {
                const here = cityAdmins.filter((r) => r.authority_id === c.id)
                return (
                  <div key={c.id} className="p-3">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      <Building2 className="size-4 text-warn" /> {areaLabel(c.name)}
                      {!here.length && <span className="chip bg-warn-soft text-warn">No admin appointed yet</span>}
                    </p>
                    {here.length > 0 && <div className="mt-1 divide-y divide-line rounded-lg bg-bg">{here.map((r) => roleRow(r, true))}</div>}
                  </div>
                )
              })}
              {!cities.length && <p className="p-4 text-sm text-muted">Add a City Corporation first (City Corporations tab).</p>}
            </div>
            <div className="card space-y-2 p-4">
              <h3 className="font-semibold">Appoint an area admin</h3>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.5fr_auto]">
                <input className="input" value={newCityAdmin} maxLength={24} onChange={(e) => setNewCityAdmin(cleanUsername(e.target.value))} placeholder="username" aria-label="Username" />
                <select className="input" value={newCity} onChange={(e) => setNewCity(e.target.value)} aria-label="Area">
                  <option value="">Area…</option>
                  {/* One admin per area: only areas without one can be chosen. */}
                  {cities.filter((c) => !cityAdmins.some((r) => r.authority_id === c.id))
                    .map((c) => <option key={c.id} value={c.id}>{areaLabel(c.name)}</option>)}
                </select>
                <input className="input" maxLength={500} value={reasonFor('city_admin')} onChange={(e) => setReason('city_admin', e.target.value)}
                  placeholder="Reason, e.g. trusted local volunteer" aria-label="Reason" />
                <button className="btn-primary" disabled={busy || newCityAdmin.trim().length < 3 || !newCity || reasonFor('city_admin').trim().length < 5}
                  onClick={() => run(() => adminGrantCityAdmin(newCityAdmin, newCity, reasonFor('city_admin')), 'Area admin appointed.', () => {
                    setNewCityAdmin('')
                    setNewCity('')
                    setReason('city_admin', '')
                    refresh()
                  })}>
                  <Plus className="size-4" /> Add
                </button>
              </div>
              <p className="text-xs text-muted">Each area has one admin, so only areas without one are listed. To replace an admin, remove them first. Already the admin of
                another area? This moves them.</p>
            </div>
          </>
        ) : (
          <>
            <div className="card divide-y divide-line">{cityAdmins.map((r) => roleRow(r, false))}</div>
            <p className="px-1 text-xs text-muted">Only super admins appoint or remove area admins. Ask one if your area needs more help.</p>
          </>
        )}
      </section>

      {isAdmin && (
        <section className="space-y-2">
          <h2 className="px-1 font-bold">Super admins</h2>
          <div className="card divide-y divide-line">{superAdmins.map((r) => roleRow(r, true))}</div>
        </section>
      )}
    </div>
  )
}

// ---------- City Corporations ----------

function CityCorporations() {
  const authorities = useQuery({ queryKey: ['authorities'], queryFn: getAuthorities })
  const records = useQuery({ queryKey: ['authority_records'], queryFn: getAuthorityRecords }).data ?? []
  const cityAdmins = (useQuery({ queryKey: ['roles', 'all'], queryFn: getRoles }).data ?? []).filter((r) => r.role === 'city_admin')
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

function AuthorityEditor({ authority, all, onDone }: { authority: Authority | null; all: Authority[]; onDone: () => void }) {
  const qc = useQueryClient()
  const { busy, run } = useRunner()
  const areaAdmins = (useQuery({ queryKey: ['roles', 'all'], queryFn: getRoles }).data ?? [])
    .filter((r) => r.role === 'city_admin' && r.authority_id === authority?.id)
  const [name, setName] = useState(authority?.name ?? '')
  const [shortName, setShortName] = useState(authority?.short_name ?? '')
  const [hotline, setHotline] = useState(authority?.hotline ?? '')
  const [complaintUrl, setComplaintUrl] = useState(authority?.complaint_url ?? '')
  const [contacts, setContacts] = useState<EmergencyContact[]>(authority?.emergency_contacts ?? [])
  const [due, setDue] = useState({
    critical: authority?.due_days_critical ?? 3, high: authority?.due_days_high ?? 7,
    medium: authority?.due_days_medium ?? 14, low: authority?.due_days_low ?? 30,
  })
  const [active, setActive] = useState(authority?.is_active ?? true)
  const [kind, setKind] = useState<Authority['kind']>(authority?.kind ?? 'city_corporation')
  const [points, setPoints] = useState<LatLng[]>(ringFromGeoJSON(authority?.area))
  const others = all.filter((a) => a.id !== authority?.id).map((a) => ({ name: a.short_name, ring: ringFromGeoJSON(a.area) }))

  function save() {
    run(() => adminSaveAuthority({
      id: authority?.id ?? null, name, shortName, area: polygonFromRing(points), hotline, complaintUrl,
      emergencyContacts: contacts.filter((c) => c.label.trim() && c.phone.trim()),
      dueCritical: due.critical, dueHigh: due.high, dueMedium: due.medium, dueLow: due.low, isActive: active, kind,
    }), 'Saved.', () => {
      qc.invalidateQueries({ queryKey: ['authorities'] })
      qc.invalidateQueries({ queryKey: ['authority_records'] })
      onDone()
    })
  }

  return (
    <div className="card space-y-4 p-4">
      <h2 className="text-lg font-bold">{authority ? `Edit ${authority.short_name}` : 'New City Corporation'}</h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <div><label className="label" htmlFor="a-name">Name</label>
          <input id="a-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dhaka North City Corporation" /></div>
        <div><label className="label" htmlFor="a-short">Short name</label>
          <input id="a-short" className="input" value={shortName} maxLength={16} onChange={(e) => setShortName(e.target.value)} placeholder="DNCC" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="a-kind">Type</label>
          <select id="a-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as Authority['kind'])}>
            <option value="city_corporation">City Corporation (receives escalated issues in its area)</option>
            <option value="agency">Other agency, e.g. DESCO, WASA (only receives issues an admin refers to it)</option>
          </select></div>
        <div><label className="label" htmlFor="a-hotline">Hotline</label>
          <input id="a-hotline" className="input" value={hotline} onChange={(e) => setHotline(e.target.value)} placeholder="16106" /></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="a-url">Official complaint page (optional)</label>
          <input id="a-url" className="input" value={complaintUrl} onChange={(e) => setComplaintUrl(e.target.value)} placeholder="https://…" /></div>
      </div>

      <div>
        <span className="label">Service area</span>
        <AreaDrawer points={points} onChange={setPoints} others={others} name={name} />
      </div>

      <div>
        <span className="label">Target time to deal with an escalated issue (days)</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['critical', 'high', 'medium', 'low'] as const).map((k) => (
            <label key={k} className="text-sm">
              <span className="text-muted">{SEVERITY_META[k].label}</span>
              <input type="number" min={1} className="input" value={due[k]}
                onChange={(e) => setDue({ ...due, [k]: Math.max(1, Number(e.target.value)) })} />
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="label">Local emergency numbers (shown next to 999 for emergencies in this area)</span>
        {contacts.map((c, i) => (
          <div key={i} className="flex gap-2">
            <input className="input" value={c.label} placeholder="e.g. Mirpur Fire Station" aria-label="Label"
              onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="input w-40" value={c.phone} placeholder="Phone" aria-label="Phone"
              onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
            <button className="btn-ghost" aria-label="Remove" onClick={() => setContacts(contacts.filter((_, j) => j !== i))}><X className="size-4" /></button>
          </div>
        ))}
        <button className="btn-ghost text-xs" onClick={() => setContacts([...contacts, { label: '', phone: '' }])}><Plus className="size-3.5" /> Add number</button>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (receives escalated issues)
      </label>
      {!active && authority?.is_active && areaAdmins.length > 0 && (
        <p className="rounded-lg bg-warn-soft p-3 text-sm text-warn">
          Switching this off leaves its area admin{areaAdmins.length > 1 && 's'} ({areaAdmins.map((r) => `@${r.username}`).join(', ')})
          with nothing to act on: its cases go to you until it is switched on again. They will be told.
        </p>
      )}
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy || name.trim().length < 2 || shortName.trim().length < 2 || points.length < 3} onClick={save}>
          {busy && <Spinner className="size-4 text-brand-ink" />} Save
        </button>
        <button className="btn-ghost" onClick={onDone}>Cancel</button>
      </div>
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
  const categories = useQuery({ queryKey: ['categories', 'all'], queryFn: getAllCategories })
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
    run(() => adminSaveCategory(c), 'Saved.', onDone)
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
      { key: 'team_lead_min_tasks', label: 'Completed tasks needed to lead a team' },
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
        onClick={() => run(() => adminUpdateSettings(changed), 'Settings saved.', () => qc.invalidateQueries({ queryKey: ['app_settings'] }))}>
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
  const log = useQuery({ queryKey: ['admin_log', who], queryFn: () => getAdminLog(200, who || null) })
  const areas = [...new Set((useQuery({ queryKey: ['roles', 'all'], queryFn: getRoles }).data ?? [])
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
            <span className="text-xs text-muted"> · {timeAgo(l.created_at)}</span>
          </p>
          <p className="text-muted">{l.reason}</p>
        </div>
      ))}
      {!shown.length && <p className="p-4 text-sm text-muted">No admin actions yet.</p>}
    </div>
  )
}
