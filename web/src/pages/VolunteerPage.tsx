import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, Clock, HandHelping, House, LifeBuoy, LocateFixed, MapPin, ShieldCheck, Trophy, Users, Wrench } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { LocationPicker } from '../components/map/LocationPicker'
import { CategoryChip, Empty, LoadError, NoPhoto, PageSpinner, SeverityBadge, Spinner, StatusBadge } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useAppSettings, useCategories, useMySettings } from '../hooks/useData'
import { useTitle } from '../hooks/useTitle'
import { useToast } from '../hooks/useToast'
import { getHelpRequests, getMyTasks, getOpenTasks, getOpenTeams, setVolunteerMode, updateMySettings } from '../lib/api'
import { hoursLeft, timeAgo } from '../lib/format'
import { activeTasks, noTasksHint, taskLockLine, teamsInCategory } from '../lib/volunteer'
import { distanceM, formatDistance, getCurrentPosition } from '../lib/geo'
import { mediaUrl } from '../lib/supabase'
import type { Issue } from '../lib/types'

export function VolunteerPage() {
  useTitle('Volunteer')
  const { user, profile, refreshProfile, role, loading } = useAuth()
  const settings = useAppSettings().data
  const mySettings = useMySettings().data
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [home, setHome] = useState<{ lat: number; lng: number } | null>(null)
  const hasHome = mySettings?.home_lat != null

  // Volunteering is for citizens; admins and officials work from their own dashboard.
  if (loading) return <PageSpinner />
  if (role === 'admin' || role === 'city_admin') return <Navigate to="/admin" replace />
  if (role === 'official') return <Navigate to="/city-corp/dashboard" replace />

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <Empty icon={<HandHelping className="size-10" />} title="Fix your city with your neighbours">
          <Link to="/login" className="font-semibold text-brand">Log in</Link> to become a volunteer.
        </Empty>
      </div>
    )
  }
  if (!profile) return <PageSpinner />

  async function toggle(on: boolean) {
    setBusy(true)
    try {
      // Volunteers are reached by their home area ("Ask nearby volunteers", team recruiting), so save it first.
      if (on && !hasHome && home && mySettings) {
        await updateMySettings(home.lat, home.lng, mySettings.default_anonymous, mySettings.show_on_leaderboard)
        await qc.invalidateQueries({ queryKey: ['my_settings'] })
      }
      await setVolunteerMode(on)
      await refreshProfile()
      toast.success(on ? 'Welcome, volunteer! Pick a task near you.' : 'Volunteer mode turned off.')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  if (!profile.is_volunteer) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-2 py-4 sm:px-4">
        <div className="card space-y-4 p-6">
          <div className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand"><ShieldCheck className="size-8" /></div>
          <h1 className="text-2xl font-bold">Become a volunteer</h1>
          <p className="text-muted">Volunteers turn validated reports into real fixes. Here's the deal:</p>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2"><HandHelping className="size-5 shrink-0 text-brand" /> You choose tasks — nothing is assigned to you.</li>
            <li className="flex gap-2"><Clock className="size-5 shrink-0 text-brand" />
              A task is locked for you for {settings?.lock_hours ?? 72} h. Each progress update restarts the clock. Release it any time without penalty.</li>
            <li className="flex gap-2"><Wrench className="size-5 shrink-0 text-brand" />
              You fix community issues (garbage, dengue sites, small drains) alone or as a team. Big or dangerous problems go to the City Corporation instead.</li>
            <li className="flex gap-2"><Users className="size-5 shrink-0 text-brand" />
              Big jobs can be team tasks: one leader, others join. Members who check in at the site share the reward.</li>
            <li className="flex gap-2"><Building2 className="size-5 shrink-0 text-brand" />
              Found a task is too big? Release it as "needs the City Corporation" with a photo. An admin decides. No penalty for being honest.</li>
            <li className="flex gap-2"><MapPin className="size-5 shrink-0 text-brand" />
              To submit a fix you must be on-site (within {settings?.resolution_radius_m ?? 200} m) with an "after" photo.</li>
            <li className="flex gap-2"><Trophy className="size-5 shrink-0 text-brand" />
              Confirmed fixes and good ratings earn reputation and a place on the leaderboard.</li>
          </ul>
          {!hasHome && (
            <div className="space-y-2 rounded-lg border border-line p-3">
              <p className="flex items-center gap-2 text-sm font-semibold"><House className="size-4 text-brand" /> Your home area (required)</p>
              <p className="text-xs text-muted">
                Admins and team leaders ask volunteers near an issue for help. Your home area is how they reach you. Only you can see it.
              </p>
              <LocationPicker value={home} onPick={(lat, lng) => setHome({ lat, lng })} height={220} />
              <button className="btn-soft" onClick={async () => {
                try { const p = await getCurrentPosition(); setHome({ lat: p.lat, lng: p.lng }) } catch (e) { toast.error(e) }
              }}><LocateFixed className="size-4" /> I'm home now</button>
            </div>
          )}
          <button className="btn-primary w-full py-3" disabled={busy || (!hasHome && !home)} onClick={() => toggle(true)}>
            {busy && <Spinner className="size-4 text-brand-ink" />} Turn on volunteer mode
          </button>
          <p className="text-center text-xs text-muted">Accounts must be at least {settings?.volunteer_min_account_hours ?? 72} hours old.</p>
        </div>
      </div>
    )
  }

  return <VolunteerDashboard onTurnOff={() => toggle(false)} busy={busy} />
}

function VolunteerDashboard({ onTurnOff, busy }: { onTurnOff: () => void; busy: boolean }) {
  const { profile } = useAuth()
  const categories = useCategories().data ?? []
  const mySettings = useMySettings().data
  const settings = useAppSettings().data
  const toast = useToast()
  const [category, setCategory] = useState<string | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)
  // Where tasks are looked for: the home area by default, or where the volunteer is right now.
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const home = mySettings?.home_lat != null ? { lat: mySettings.home_lat, lng: mySettings.home_lng! } : null
  const origin = here ?? home
  // Starts at the same distance as "ask nearby volunteers" notifications (request_help_radius_m, 5 km).
  const [pickedKm, setRadiusKm] = useState<number | null>(null)
  const radiusKm = pickedKm ?? Math.round((settings?.request_help_radius_m ?? 5000) / 1000)
  const radiusM = radiusKm * 1000

  const mine = useQuery({ queryKey: ['tasks', 'mine'], queryFn: getMyTasks })
  const teams = useQuery({
    queryKey: ['tasks', 'teams', origin, radiusM],
    queryFn: () => getOpenTeams(origin!.lat, origin!.lng, radiusM),
    enabled: Boolean(origin),
  })
  const open = useQuery({
    queryKey: ['tasks', 'open', origin, radiusM, category],
    queryFn: () => getOpenTasks(origin!.lat, origin!.lng, radiusM, category),
    enabled: Boolean(origin),
  })
  // Tasks an admin asked nearby volunteers to help with: marked, and listed first.
  const helpIds = new Set((useQuery({ queryKey: ['tasks', 'help'], queryFn: getHelpRequests }).data ?? []).map((h) => h.issue_id))
  const openList = [...(open.data ?? [])].sort((a, b) => Number(helpIds.has(b.id)) - Number(helpIds.has(a.id)))

  async function locate() {
    setLocating(true)
    try {
      const p = await getCurrentPosition()
      setHere({ lat: p.lat, lng: p.lng })
    } catch (e) {
      toast.error(e)
    } finally {
      setLocating(false)
    }
  }

  const active = activeTasks(mine.data ?? [])
  const teamList = teamsInCategory(teams.data ?? [], category)
  const done = (mine.data ?? []).filter((t) => t.status === 'closed')

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-2 py-4 sm:px-4">
      {mySettings && mySettings.home_lat == null && (
        <Link to="/settings" className="card flex items-center gap-3 border-warn/40 bg-warn-soft p-3 text-sm text-warn">
          <House className="size-5 shrink-0" />
          <span><strong>Set your home area.</strong> You see tasks and teams within {radiusKm} km of it, and hear when volunteers near it are needed.</span>
        </Link>
      )}
      <div className="card flex flex-wrap items-center gap-4 p-4">
        <div className="grid size-12 place-items-center rounded-xl bg-brand-soft text-brand"><ShieldCheck className="size-7" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">Volunteer dashboard</h1>
          <p className="text-sm text-muted">
            {profile?.reputation} reputation · {profile?.tasks_completed} fixed
            {profile && profile.rating_count > 0 && ` · ${(profile.rating_sum / profile.rating_count).toFixed(1)}★`}
          </p>
        </div>
        {!confirmOff && (
          <button className="btn-ghost text-xs" disabled={busy || mine.isLoading} onClick={() => setConfirmOff(true)}>Turn off volunteer mode</button>
        )}
        {confirmOff && (
          // The database refuses while you still hold tasks, so say that here instead of after the click.
          active.length > 0 ? (
            <p role="status" className="w-full rounded-lg bg-warn-soft p-3 text-sm">
              Finish, release or leave your {active.length === 1 ? 'task' : `${active.length} tasks`} first, then you can turn volunteer mode off.{' '}
              <button className="font-semibold text-brand hover:underline" onClick={() => setConfirmOff(false)}>OK</button>
            </p>
          ) : (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-bg p-3 text-sm">
              <span className="mr-auto">Turn off volunteer mode? You stop getting task alerts; your reputation stays.</span>
              <button className="btn-danger px-3 py-1.5 text-xs" disabled={busy} onClick={() => { setConfirmOff(false); onTurnOff() }}>Turn off</button>
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setConfirmOff(false)}>Keep it on</button>
            </div>
          )
        )}
      </div>

      <section className="space-y-2">
        <h2 className="px-1 font-bold">My tasks ({active.length})</h2>
        {mine.isLoading && <PageSpinner />}
        {mine.isError && <LoadError what="tasks" error={mine.error} onRetry={() => mine.refetch()} />}
        {mine.isSuccess && active.length === 0 && (
          <p className="card p-4 text-sm text-muted">No active tasks. Pick one below.</p>
        )}
        {active.map((t) => <TaskRow key={t.id} task={t} origin={origin} mine />)}
      </section>

      {teamList.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 font-bold">Teams near {here ? 'you' : 'your home'} looking for people</h2>
          <p className="px-1 text-xs text-muted">A volunteer started these and needs help. Join, then plan the work day in the issue discussion.</p>
          {teamList.map((t) => <TaskRow key={t.id} task={t} origin={origin} />)}
        </section>
      )}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 px-1">
          <h2 className="mr-auto font-bold">Open tasks within {radiusKm} km of {here ? 'where you are' : 'your home'}</h2>
          <button className="btn-soft py-1.5 text-xs" onClick={locate} disabled={locating}>
            {locating ? <Spinner className="size-3.5" /> : <LocateFixed className="size-3.5" />} {here ? 'Update location' : 'Use my location'}
          </button>
          {here && home && <button className="btn-ghost py-1.5 text-xs" onClick={() => setHere(null)}><House className="size-3.5" /> Back to home</button>}
          <select className="input w-auto py-1.5 text-xs" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} aria-label="Radius">
            {[...new Set([2, 5, 10, 25, radiusKm])].sort((a, b) => a - b).map((r) => <option key={r} value={r}>{r} km</option>)}
          </select>
          <select className="input w-auto py-1.5 text-xs" value={category ?? ''} onChange={(e) => setCategory(e.target.value || null)}
            aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
        {!origin && mySettings && (
          <p className="card p-4 text-sm text-muted">
            <Link to="/settings" className="font-semibold text-brand">Set your home area</Link> or tap "Use my location" to see tasks near you.
          </p>
        )}
        {open.isLoading && <PageSpinner />}
        {open.isError && <LoadError what="tasks" error={open.error} onRetry={() => open.refetch()} />}
        {open.isSuccess && open.data.length === 0 && (
          <Empty icon={<HandHelping className="size-8" />} title="No open tasks here">
            {noTasksHint(radiusKm, Boolean(here))}
          </Empty>
        )}
        {openList.map((t) => <TaskRow key={t.id} task={t} origin={origin} helpNeeded={helpIds.has(t.id)} />)}
      </section>

      {done.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 font-bold">Completed ({done.length})</h2>
          {done.map((t) => <TaskRow key={t.id} task={t} origin={origin} mine />)}
        </section>
      )}
    </div>
  )
}

function TaskRow({ task, origin, mine, helpNeeded }: {
  task: Issue; origin: { lat: number; lng: number } | null; mine?: boolean; helpNeeded?: boolean
}) {
  const thumb = task.media.find((m) => m.media_type === 'image')
  const left = hoursLeft(task.lock_expires_at)
  return (
    <Link to={`/issue/${task.id}`} className="card flex gap-3 p-3 hover:bg-card-hover">
      {thumb ? (
        <img src={mediaUrl(thumb.path)} alt="" className="size-20 shrink-0 rounded-lg object-cover" />
      ) : (
        <NoPhoto />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="line-clamp-2 font-semibold leading-snug">{task.title}</p>
        <div className="flex flex-wrap gap-1">
          <CategoryChip issue={task} />
          <SeverityBadge severity={task.severity} />
          {mine && <StatusBadge status={task.status} />}
          {helpNeeded && (
            <span className="chip bg-warn-soft text-warn" title="Nobody has taken this for a while; an admin asked volunteers nearby for help">
              <LifeBuoy className="size-3.5" /> Help needed
            </span>
          )}
        </div>
        <p className="text-xs text-muted">
          {origin && `${formatDistance(distanceM(origin, task))} away · `}
          {task.team_size > 1
            ? `Team ${task.team_count + 1}/${task.team_size}${mine ? '' : ' · join'}`
            : task.route === 'authority' ? 'City Corporation' : 'Fix directly'}
          {!mine && task.validated_at && ` · validated ${timeAgo(task.validated_at)}`}
        </p>
        {mine && ['assigned', 'in_progress'].includes(task.status) && (
          <p className={clsx('flex items-center gap-1 text-xs font-semibold', left < 24 ? 'text-danger' : 'text-brand')}>
            <Clock className="size-3.5" /> {taskLockLine(task.lock_expires_at)}
          </p>
        )}
      </div>
    </Link>
  )
}
