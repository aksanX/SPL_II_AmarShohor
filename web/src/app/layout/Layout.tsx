import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { BellRing, Building2, CircleCheckBig, Compass, Flame, ListFilter, Siren, UserRound } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { GroupPicker } from '@/features/categories/components/CategoryBrowser'
import { emergencyService } from '@/features/emergency/services/emergency.service'
import { leaderboardService } from '@/features/leaderboard/services/leaderboard.service'
import { appSettingsService } from '@/shared/settings/appSettings.service'
import { displayName, timeAgo } from '@/shared/lib/format'
import { EMERGENCY_LABEL } from '@/features/emergency/lib/emergencyLabels'
import { locationService } from '@/shared/geo/location.service'
import { Avatar } from '@/shared/ui'
import { TopBar } from '@/app/layout/TopBar'
import { BottomNav } from '@/app/layout/BottomNav'

export function AppShell() {
  const { pathname } = useLocation()
  useEffect(() => {
    // Braces matter: newer Chrome returns a Promise from scrollTo, which React would treat as a cleanup function.
    window.scrollTo(0, 0)
  }, [pathname])
  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <TopBar />
      <Outlet />
      <BottomNav />
    </div>
  )
}

// ---------- Sidebars for feed-style pages ----------

function LeftSidebar() {
  const { profile } = useAuth()
  return (
    <aside className="sticky top-16 hidden max-h-[calc(100vh-5rem)] w-64 shrink-0 overflow-y-auto pb-6 lg:block">
      {profile && (
        <Link to={`/u/${profile.username}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-card-hover">
          <Avatar url={profile.avatar_url} name={displayName(profile.full_name, profile.username)} size={32} />
          <span className="truncate font-semibold">{displayName(profile.full_name, profile.username)}</span>
        </Link>
      )}
      <SideLink to="/map" icon={<Compass className="size-5 text-muted" />}>Explore Map</SideLink>
      <SideLink to="/feed?scope=following" icon={<BellRing className="size-5 text-muted" />}>Following</SideLink>
      <SideLink to="/feed?scope=unverified" icon={<Flame className="size-5 text-muted" />}>Needs validation</SideLink>
      <SideLink to="/feed?scope=resolved" icon={<CircleCheckBig className="size-5 text-muted" />}>Resolved</SideLink>
      {profile && <SideLink to="/feed?scope=mine" icon={<UserRound className="size-5 text-muted" />}>My reports</SideLink>}
      <SideLink to="/city-corp" icon={<Building2 className="size-5 text-muted" />}>City Corporations</SideLink>
      <SideLink to="/emergency" icon={<Siren className="size-5 text-muted" />}>Emergency alert</SideLink>

      <h3 className="mb-1 mt-4 flex items-center gap-2 px-2 text-sm font-semibold text-muted">
        <ListFilter className="size-4" /> Reported issues
      </h3>
      <GroupPicker />
    </aside>
  )
}

function SideLink({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium hover:bg-card-hover">
      {icon}
      {children}
    </Link>
  )
}

function RightSidebar() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: appSettingsService.getPlatformStats, staleTime: 60_000 }).data
  const top = useQuery({ queryKey: ['leaderboard'], queryFn: leaderboardService.getLeaderboard, staleTime: 60_000 }).data ?? []
  return (
    <aside className="sticky top-16 hidden max-h-[calc(100vh-5rem)] w-72 shrink-0 space-y-4 overflow-y-auto pb-6 xl:block">
      {stats && (
        <section className="card p-4">
          <h3 className="mb-3 font-semibold">Your city right now</h3>
          <dl className="grid grid-cols-2 gap-3 text-center">
            <Stat label="Reported" value={stats.reported} />
            <Stat label="Validated" value={stats.validated} />
            <Stat label="Being fixed" value={stats.in_progress} />
            <Stat label="Resolved" value={stats.resolved} tone="text-brand" />
          </dl>
        </section>
      )}
      <section className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">Top volunteers</h3>
          <Link to="/leaderboard" className="text-sm text-brand hover:underline">See all</Link>
        </div>
        {top.length === 0 && <p className="text-sm text-muted">No volunteers yet. Be the first!</p>}
        <ol className="space-y-2">
          {top.slice(0, 5).map((v) => (
            <li key={v.id}>
              <Link to={`/u/${v.username}`} className="flex items-center gap-3 rounded-lg p-1 hover:bg-card-hover">
                <span className="w-5 text-center text-sm font-bold text-muted">{v.rank}</span>
                <Avatar url={v.avatar_url} name={displayName(v.full_name, v.username)} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{displayName(v.full_name, v.username)}</span>
                  <span className="block text-xs text-muted">{v.tasks_completed} fixed · {v.reputation} rep</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-bg p-2">
      <dd className={clsx('text-xl font-bold', tone)}>{value}</dd>
      <dt className="text-xs text-muted">{label}</dt>
    </div>
  )
}

export function FeedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-7xl gap-6 px-2 py-4 sm:px-4">
      <LeftSidebar />
      <main className="mx-auto w-full min-w-0 max-w-[680px] flex-1">
        <ActiveAlerts />
        {children}
      </main>
      <RightSidebar />
    </div>
  )
}

/** Live emergency alerts, nearest first when we know where the user is. */
function ActiveAlerts() {
  const pos = locationService.getLastKnownPosition()
  const alerts = useQuery({
    queryKey: ['alerts', 'active', pos?.lat.toFixed(2), pos?.lng.toFixed(2)],
    queryFn: () => emergencyService.getActiveAlerts(pos?.lat ?? null, pos?.lng ?? null),
    refetchInterval: 60_000,
  }).data ?? []
  if (!alerts.length) return null
  return (
    <div className="mb-3 space-y-2">
      {alerts.slice(0, 3).map((a) => (
        <Link key={a.id} to={`/alert/${a.id}`} className="flex items-center gap-3 rounded-xl bg-danger p-3 text-danger-ink hover:brightness-110">
          <Siren className="size-6 shrink-0" />
          <span className="min-w-0 flex-1 text-sm">
            <strong className="block truncate">
              {/* The same names as the alert page ("Live electric wire", not "Live wire"). */}
              {EMERGENCY_LABEL[a.kind] ?? 'Emergency'}{a.address && ` near ${a.address}`}
            </strong>
            {a.confirm_count > 0 ? `Confirmed by ${a.confirm_count} nearby` : 'Unverified'} · {timeAgo(a.created_at)} · stay away
          </span>
        </Link>
      ))}
    </div>
  )
}
