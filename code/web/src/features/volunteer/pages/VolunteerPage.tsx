import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { ArrowLeft, Building2, ChevronDown, Clock, HandHelping, House, Info, LifeBuoy, LocateFixed, MapPin, ShieldCheck, Trophy, Users, Wrench, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { mediaUrl } from '@/core/supabase'
import type { Issue } from '@/models'
import { distanceM, formatDistance } from '@/shared/geo/distance'
import { locationService } from '@/shared/geo/location.service'
import { useTitle } from '@/shared/hooks/useTitle'
import { useToast } from '@/shared/hooks/useToast'
import { hoursLeft, timeAgo } from '@/shared/lib/format'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { Empty, LoadError, NoPhoto, PageSpinner, Spinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { CategoryIcon } from '@/features/categories/components/CategoryIcon'
import { CategoryChip, SeverityBadge, StatusBadge } from '@/features/issues/components/IssueBadges'
import { LocationPicker } from '@/features/map/components/LocationPicker'
import { useMySettings } from '@/features/settings/hooks/useMySettings'
import { accountService } from '@/features/settings/services/account.service'
import { activeTasks, noTasksHint, taskLockLine } from '@/features/volunteer/lib/volunteer'
import { teamService } from '@/features/volunteer/services/team.service'
import { volunteerService } from '@/features/volunteer/services/volunteer.service'

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
        await accountService.updateMySettings(home.lat, home.lng, mySettings.default_anonymous, mySettings.show_on_leaderboard)
        await qc.invalidateQueries({ queryKey: ['my_settings'] })
      }
      await volunteerService.setVolunteerMode(on)
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
                try { const p = await locationService.getCurrentPosition(); setHome({ lat: p.lat, lng: p.lng }) } catch (e) { toast.error(e) }
              }}><LocateFixed className="size-4" /> I'm home now</button>
            </div>
          )}
          <div className="flex items-center gap-3 rounded-lg border border-line p-3">
            <span className="flex-1 font-semibold">Volunteer mode</span>
            {busy && <Spinner className="size-4" />}
            <Switch label="Volunteer mode" on={false} disabled={busy || (!hasHome && !home)} onChange={() => toggle(true)} />
          </div>
          <p className="text-center text-xs text-muted">Accounts must be at least {settings?.volunteer_min_account_hours ?? 72} hours old.</p>
        </div>
      </div>
    )
  }

  return <VolunteerDashboard onTurnOff={() => toggle(false)} busy={busy} />
}

function VolunteerDashboard({ onTurnOff, busy }: { onTurnOff: () => void; busy: boolean }) {
  const { profile } = useAuth()
  const mySettings = useMySettings().data
  const settings = useAppSettings().data
  const toast = useToast()
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

  const mine = useQuery({ queryKey: ['tasks', 'mine'], queryFn: volunteerService.getMyTasks })
  const teams = useQuery({
    queryKey: ['tasks', 'teams', origin, radiusM],
    queryFn: () => teamService.getOpenTeams(origin!.lat, origin!.lng, radiusM),
    enabled: Boolean(origin),
  })
  const open = useQuery({
    queryKey: ['tasks', 'open', origin, radiusM],
    queryFn: () => volunteerService.getOpenTasks(origin!.lat, origin!.lng, radiusM, null),
    enabled: Boolean(origin),
  })
  // Tasks an admin asked nearby volunteers to help with: marked, and listed first.
  // Tasks an admin asked volunteers for, or sent to volunteers: first, the latest on top (0073).
  const helpAt = new Map((useQuery({ queryKey: ['tasks', 'help'], queryFn: volunteerService.getHelpRequests }).data ?? []).map((h) => [h.issue_id, h.requested_at]))
  const helpIds = new Set(helpAt.keys())
  const openList = [...(open.data ?? [])].sort((a, b) => (helpAt.get(b.id) ?? '').localeCompare(helpAt.get(a.id) ?? ''))

  async function locate() {
    setLocating(true)
    try {
      const p = await locationService.getCurrentPosition()
      setHere({ lat: p.lat, lng: p.lng })
    } catch (e) {
      toast.error(e)
    } finally {
      setLocating(false)
    }
  }

  const active = activeTasks(mine.data ?? [])
  const teamList = teams.data ?? []
  const groups = groupByCategory(teamList, openList)
  // The category whose tasks are shown; gone once it has no open tasks left.
  const [picked, setPicked] = useState<string | null>(null)
  const pickedGroup = groups.find((g) => g.slug === picked)
  const done = (mine.data ?? []).filter((t) => t.status === 'closed')
  // One list open at a time, so Open Tasks and its categories never end up far down the page.
  const [section, setSection] = useState<'mine' | 'open' | null>(null)
  const toggleSection = (s: 'mine' | 'open') => setSection(section === s ? null : s)
  const [showDone, setShowDone] = useState(false)

  // The task whose details are shown. The lists turn into a sidebar of titles next to it.
  const [selected, setSelected] = useState<{ task: Issue; mine: boolean } | null>(null)
  const current = selected && ([...(mine.data ?? []), ...teamList, ...openList].find((t) => t.id === selected.task.id) ?? selected.task)
  const detailRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = detailRef.current
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [selected?.task.id])
  const row = (t: Issue, mine = false) => (
    <TaskRow key={t.id} task={t} compact={Boolean(current)} selected={current?.id === t.id} onSelect={() => setSelected({ task: t, mine })} />
  )

  return (
    <div className={clsx('mx-auto space-y-4 px-2 py-4 sm:px-4', current ? 'max-w-6xl' : 'max-w-3xl')}>
      {mySettings && mySettings.home_lat == null && (
        <Link to="/settings" className="card flex items-center gap-3 border-warn/40 bg-warn-soft p-3 text-sm text-warn">
          <House className="size-5 shrink-0" />
          <span><strong>Set your home area.</strong> You see tasks and teams within {radiusKm} km of it, and hear when volunteers near it are needed.</span>
        </Link>
      )}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <ShieldCheck className="size-6 shrink-0 text-brand" />
        <span className="font-semibold">Volunteer mode</span>
        <Switch label="Volunteer mode" on={!confirmOff} disabled={busy || mine.isLoading} onChange={(on) => setConfirmOff(!on)} />
        <span className="ml-auto flex items-center gap-1.5 text-sm font-semibold">
          <Trophy className="size-4 text-brand" /> My Reputation : {profile?.reputation ?? 0}
        </span>
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

      <div className={clsx(current && 'md:grid md:grid-cols-[20rem_1fr] md:items-start md:gap-4')}>
        {/* With a task open: a sidebar of titles that scrolls on its own, so the lists stay within reach. */}
        <div className={clsx('space-y-3', current && 'hidden md:sticky md:top-[72px] md:block md:max-h-[calc(100dvh-88px)] md:overflow-y-auto md:pr-1')}>
          <Dropdown title={`My Tasks (${active.length})`} open={section === 'mine'} onToggle={() => toggleSection('mine')}>
            {mine.isLoading && <PageSpinner />}
            {mine.isError && <LoadError what="tasks" error={mine.error} onRetry={() => mine.refetch()} />}
            {mine.isSuccess && active.length === 0 && (
              <p className="card p-4 text-sm text-muted">No active tasks. Pick one from Open Tasks.</p>
            )}
            {active.map((t) => row(t, true))}
            {done.length > 0 && (
              <>
                <button className="flex w-full items-center gap-1 px-1 pt-1 text-left text-sm font-bold" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
                  <span className="flex-1">Completed ({done.length})</span>
                  <ChevronDown className={clsx('size-4 text-muted transition-transform', showDone && 'rotate-180')} />
                </button>
                {showDone && done.map((t) => row(t, true))}
              </>
            )}
          </Dropdown>

          <Dropdown title={`Open Tasks${open.isSuccess ? ` (${open.data.length + teamList.length})` : ''}`} open={section === 'open'} onToggle={() => toggleSection('open')}>
            {/* Where and how far: two small pill groups instead of a row of buttons and selects. */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-full bg-card-hover p-1 text-xs font-semibold">
                {home && (
                  <button aria-pressed={!here} onClick={() => setHere(null)}
                    className={clsx('flex items-center gap-1 rounded-full px-3 py-1.5 transition', !here ? 'bg-card text-brand shadow-sm' : 'text-muted hover:text-ink')}>
                    <House className="size-3.5" /> Home
                  </button>
                )}
                <button aria-pressed={Boolean(here)} onClick={locate} disabled={locating} title={here ? 'Update my location' : undefined}
                  className={clsx('flex items-center gap-1 rounded-full px-3 py-1.5 transition', here ? 'bg-card text-brand shadow-sm' : 'text-muted hover:text-ink')}>
                  {locating ? <Spinner className="size-3.5" /> : <LocateFixed className="size-3.5" />} Near me
                </button>
              </div>
              <div role="group" aria-label="Radius" className="flex rounded-full bg-card-hover p-1 text-xs font-semibold">
                {[...new Set([2, 5, 10, 25, radiusKm])].sort((a, b) => a - b).map((r) => (
                  <button key={r} aria-pressed={r === radiusKm} onClick={() => setRadiusKm(r)}
                    className={clsx('rounded-full px-2.5 py-1.5 transition', r === radiusKm ? 'bg-card text-brand shadow-sm' : 'text-muted hover:text-ink')}>
                    {r} km
                  </button>
                ))}
              </div>
            </div>
            <h3 className="px-1 text-xs text-muted">Within {radiusKm} km of {here ? 'where you are' : 'your home'}</h3>

            {!origin && mySettings && (
              <p className="card p-4 text-sm text-muted">
                <Link to="/settings" className="font-semibold text-brand">Set your home area</Link> or tap "Near me" to see tasks near you.
              </p>
            )}
            {open.isLoading && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Loading tasks">
                {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-card-hover" />)}
              </div>
            )}
            {open.isError && <LoadError what="tasks" error={open.error} onRetry={() => open.refetch()} />}
            {open.isSuccess && open.data.length === 0 && teamList.length === 0 && (
              <Empty icon={<HandHelping className="size-8" />} title="No open tasks here">
                {noTasksHint(radiusKm, Boolean(here))}
              </Empty>
            )}

            {/* Categories first, side by side in equal tiles; tapping one opens its tasks below. */}
            {groups.length > 0 && (
              <div className={clsx('fade-in grid grid-cols-2 gap-2', !current && 'sm:grid-cols-3')}>
                {groups.map((g) => {
                  const first = g.tasks[0] ?? g.teams[0]
                  const on = pickedGroup?.slug === g.slug
                  const n = g.tasks.length + g.teams.length
                  return (
                    <button key={g.slug} aria-pressed={on} onClick={() => setPicked(on ? null : g.slug)}
                      style={on ? { borderColor: first.category_color, background: `${first.category_color}14` } : undefined}
                      className="card flex min-w-0 items-center gap-3 p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md">
                      <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: `${first.category_color}1f`, color: first.category_color }}>
                        <CategoryIcon icon={first.category_icon} className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{first.category_name}</span>
                        <span className="block text-xs text-muted">{n} task{n === 1 ? '' : 's'}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            {pickedGroup && (
              <div key={pickedGroup.slug} className="fade-in space-y-2 pt-1">
                <div className="flex items-center gap-2 px-1">
                  <h3 className="flex-1 text-sm font-bold">
                    {(pickedGroup.tasks[0] ?? pickedGroup.teams[0]).category_name}
                    <span className="font-normal text-muted"> · {pickedGroup.tasks.length + pickedGroup.teams.length} near you</span>
                  </h3>
                  <button className="text-xs font-semibold text-muted hover:text-ink" onClick={() => setPicked(null)}>Clear</button>
                </div>
                {pickedGroup.teams.length > 0 && !current && (
                  <p className="px-1 text-xs text-muted">Teams looking for people: a volunteer started these and needs help. Join, then plan the work day in the issue discussion.</p>
                )}
                {current ? (
                  [...pickedGroup.teams, ...pickedGroup.tasks].map((t) => row(t))
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[...pickedGroup.teams, ...pickedGroup.tasks].map((t) => (
                      <TaskCard key={t.id} task={t} onSelect={() => setSelected({ task: t, mine: false })} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </Dropdown>
        </div>

        {current && selected && (
          <TaskDetail ref={detailRef} task={current} origin={origin} mine={selected.mine}
            helpNeeded={helpIds.has(current.id)} onClose={() => setSelected(null)} />
        )}
      </div>
    </div>
  )
}

/** Open tasks and teams by category, in the order they are listed (a category with a "Help needed" task comes early). */
function groupByCategory(teams: Issue[], tasks: Issue[]) {
  const groups = new Map<string, { slug: string; teams: Issue[]; tasks: Issue[] }>()
  const group = (t: Issue) => {
    const slug = t.category ?? ''
    if (!groups.has(slug)) groups.set(slug, { slug, teams: [], tasks: [] })
    return groups.get(slug)!
  }
  teams.forEach((t) => group(t).teams.push(t))
  tasks.forEach((t) => group(t).tasks.push(t))
  return [...groups.values()]
}

/** An on/off switch. */
function Switch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={clsx('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50', on ? 'bg-brand' : 'bg-line')}>
      <span className={clsx('absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform', on && 'translate-x-5')} />
    </button>
  )
}

/** A titled list that opens and closes. */
function Dropdown({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <button className="card flex w-full items-center p-4 text-left font-bold hover:bg-card-hover" aria-expanded={open} onClick={onToggle}>
        <h2 className="flex-1">{title}</h2>
        <ChevronDown className={clsx('size-5 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-2">{children}</div>}
    </section>
  )
}

/** An open task as a card in the category's grid: big photo (or the category's icon), title and a Details button. */
function TaskCard({ task, onSelect }: { task: Issue; onSelect: () => void }) {
  const thumb = task.media.find((m) => m.media_type === 'image')
  return (
    <div className="card group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md">
      <button onClick={onSelect} className="flex flex-1 flex-col text-left">
        {thumb ? (
          <img src={mediaUrl(thumb.path)} alt="" loading="lazy" className="aspect-video w-full object-cover" />
        ) : (
          <span className="grid aspect-video w-full place-items-center" style={{ background: `${task.category_color}14`, color: task.category_color }}>
            <CategoryIcon icon={task.category_icon} className="size-10 opacity-70" />
          </span>
        )}
        <p className="line-clamp-2 px-3 pt-3 font-semibold leading-snug">{task.title}</p>
      </button>
      <div className="flex justify-end p-3 pt-2">
        <button className="btn-soft px-3 py-1.5 text-xs" onClick={onSelect}><Info className="size-3.5" /> Details</button>
      </div>
    </div>
  )
}

/** A task in a list: photo, title and a Details button. Beside an open task's details, just the title. */
function TaskRow({ task, compact, selected, onSelect }: { task: Issue; compact: boolean; selected: boolean; onSelect: () => void }) {
  const thumb = task.media.find((m) => m.media_type === 'image')
  if (compact) {
    return (
      <button onClick={onSelect} aria-current={selected || undefined}
        className={clsx('card block w-full truncate px-3 py-2.5 text-left text-sm font-semibold transition hover:bg-card-hover',
          selected && 'bg-brand-soft text-brand ring-2 ring-brand')}>
        {task.title}
      </button>
    )
  }
  return (
    <div className="card flex items-center gap-3 p-3">
      <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {thumb ? (
          <img src={mediaUrl(thumb.path)} alt="" className="size-20 shrink-0 rounded-lg object-cover" />
        ) : (
          <NoPhoto />
        )}
        <p className="line-clamp-2 min-w-0 flex-1 font-semibold leading-snug">{task.title}</p>
      </button>
      <button className="btn-soft shrink-0 px-3 py-1.5 text-xs" onClick={onSelect}><Info className="size-3.5" /> Details</button>
    </div>
  )
}

/** The chosen task's details, beside the sidebar of titles (in place of it on phones). */
function TaskDetail({ ref, task, origin, mine, helpNeeded, onClose }: {
  ref: React.Ref<HTMLElement>; task: Issue; origin: { lat: number; lng: number } | null; mine: boolean; helpNeeded: boolean; onClose: () => void
}) {
  const thumb = task.media.find((m) => m.media_type === 'image')
  const left = hoursLeft(task.lock_expires_at)
  return (
    <section ref={ref} aria-label="Task details" className="card scroll-mt-20 space-y-4 p-4 md:sticky md:top-[72px]">
      <button className="btn-ghost px-2 py-1 text-sm md:hidden" onClick={onClose}><ArrowLeft className="size-4" /> Back to tasks</button>
      <div className="flex items-start gap-2">
        <h2 className="flex-1 text-lg font-bold leading-snug">{task.title}</h2>
        <button aria-label="Close details" className="hidden rounded-full p-1.5 text-muted hover:bg-card-hover md:block" onClick={onClose}>
          <X className="size-5" />
        </button>
      </div>
      {thumb && <img src={mediaUrl(thumb.path)} alt="" className="max-h-72 w-full rounded-lg object-cover" />}
      {task.description && <p className="whitespace-pre-line text-sm">{task.description}</p>}
      <dl className="space-y-3 text-sm">
        <Detail label="Issue type"><CategoryChip issue={task} /></Detail>
        <Detail label="Severity"><SeverityBadge severity={task.severity} /></Detail>
        {mine && <Detail label="Status"><StatusBadge status={task.status} /></Detail>}
        {helpNeeded && (
          <Detail label="Help needed">
            <span className="chip bg-warn-soft text-warn"><LifeBuoy className="size-3.5" /> An admin asked volunteers to take it</span>
          </Detail>
        )}
        {origin && <Detail label="Distance">{formatDistance(distanceM(origin, task))} away</Detail>}
        <Detail label="Type">
          {task.team_size > 1
            ? `Team ${task.team_count + 1}/${task.team_size}${mine ? '' : ' · join'}`
            : task.route === 'authority' ? 'City Corporation' : 'Fix directly'}
        </Detail>
        {!mine && task.validated_at && <Detail label="Validated">{timeAgo(task.validated_at)}</Detail>}
        {mine && ['assigned', 'in_progress'].includes(task.status) && (
          <Detail label="Lock">
            <span className={clsx('inline-flex items-center gap-1 font-semibold', left < 24 ? 'text-danger' : 'text-brand')}>
              <Clock className="size-3.5" /> {taskLockLine(task.lock_expires_at)}
            </span>
          </Detail>
        )}
      </dl>
      <Link to={`/issue/${task.id}`} className="btn-primary w-full">Open issue</Link>
    </section>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}
