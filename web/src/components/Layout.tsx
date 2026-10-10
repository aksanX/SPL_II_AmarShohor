import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  Bell, BellRing, Building2, CircleCheckBig, Compass, Flame, HandHelping, Home, LayoutDashboard, LogOut, Plus, Search, Settings,
  ListFilter, ShieldCheck, Siren, Trophy, UserRound, type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useNotifications } from '../hooks/useData'
import { GroupPicker } from './CategoryBrowser'
import { getActiveAlerts, getLeaderboard, getPlatformStats } from '../lib/api'
import { EMERGENCY_LABEL, displayName, timeAgo } from '../lib/format'
import { getLastKnownPosition } from '../lib/geo'
import { ThemeToggle } from './ThemeToggle'
import { Avatar } from './ui'

function Logo() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2">
      <img src="/favicon.svg" alt="" className="size-9" />
      <span className="hidden text-xl font-extrabold tracking-tight text-brand lg:inline">AmarShohor</span>
    </Link>
  )
}

type Role = ReturnType<typeof useAuth>['role']
type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean }

const FEED: NavItem = { to: '/feed', label: 'Home', icon: Home }
const MAP: NavItem = { to: '/map', label: 'Explore', icon: Compass }
const VOLUNTEER: NavItem = { to: '/volunteer', label: 'Volunteer', icon: HandHelping }
const LEADERBOARD: NavItem = { to: '/leaderboard', label: 'Leaderboard', icon: Trophy }
const CITY_RECORD: NavItem = { to: '/city-corp', label: 'City Corporations', icon: Building2, end: true }

/** Each role gets its own menu. The feed is for citizens; admins and officials work from their dashboard. */
function navFor(role: Role): NavItem[] {
  if (role === 'admin' || role === 'city_admin') return [{ to: '/admin', label: 'Admin', icon: LayoutDashboard }, MAP, CITY_RECORD]
  if (role === 'official') return [{ to: '/city-corp/dashboard', label: 'Dashboard', icon: LayoutDashboard }, MAP]
  return [FEED, MAP, VOLUNTEER, LEADERBOARD, CITY_RECORD]
}

function RoleBadge() {
  const { role, officialOf, cityAdminOf } = useAuth()
  if (role === 'citizen') return null
  return (
    <span className={clsx('hidden rounded-full px-2.5 py-1 text-xs font-bold sm:inline',
      role === 'official' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand')}>
      {role === 'admin' ? 'Super admin' : role === 'city_admin' ? `${cityAdminOf?.area} admin` : `${officialOf?.shortName} official`}
    </span>
  )
}

function TopBar() {
  const { user, profile, role, officialOf, cityAdminOf } = useAuth()
  const nav = navFor(role)
  const { unread } = useNotifications()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const location = useLocation()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  return (
    <header className="sticky top-0 z-[1000] border-b border-line bg-card">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
        <Logo />
        {role === 'citizen' ? <form
          className="relative max-w-xs flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            // On the map, searching moves the map to the place (MapPage reads ?q=) instead of filtering the feed.
            if (location.pathname === '/map') {
              if (!q.trim()) return
              const next = new URLSearchParams(params)
              next.set('q', q.trim())
              navigate(`/map?${next}`, { replace: true })
              return
            }
            navigate(q.trim() ? `/feed?q=${encodeURIComponent(q.trim())}` : '/feed')
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input
            className="w-full rounded-full border-0 bg-card-hover py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            placeholder="Search issues, places…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search"
          />
        </form> : <div className="flex-1" />}

        <nav className="hidden flex-1 justify-center gap-1 md:flex">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={n.label}
              className={({ isActive }) =>
                clsx(
                  'flex h-12 w-24 items-center justify-center transition-colors',
                  isActive ? 'rounded-lg bg-brand-soft text-brand' : 'rounded-lg text-muted hover:bg-card-hover',
                )
              }
            >
              <n.icon className="size-6" />
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <RoleBadge />
              {role === 'citizen' && (
                <Link to="/new" className="btn-primary hidden sm:inline-flex">
                  <Plus className="size-4" /> Report
                </Link>
              )}
              <Link to="/notifications" aria-label="Notifications"
                className="relative grid size-10 place-items-center rounded-full bg-bg hover:brightness-95">
                {unread ? <BellRing className="size-5" /> : <Bell className="size-5" />}
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold text-danger-ink">
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </Link>
              <ThemeToggle />
              <div className="relative" ref={menuRef}>
                <button aria-label="Account menu" onClick={() => setMenu(!menu)} className="block rounded-full">
                  <Avatar url={profile?.avatar_url} name={displayName(profile?.full_name, profile?.username)} size={40} />
                </button>
                {menu && profile && (
                  <div className="card absolute right-0 mt-2 w-64 overflow-hidden py-1 shadow-xl">
                    <Link to={`/u/${profile.username}`} onClick={() => setMenu(false)}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-card-hover">
                      <Avatar url={profile.avatar_url} name={displayName(profile.full_name, profile.username)} size={36} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{displayName(profile.full_name, profile.username)}</div>
                        <div className="text-xs text-muted">See your profile · {profile.reputation} rep</div>
                      </div>
                    </Link>
                    <div className="my-1 border-t border-line" />
                    <MenuLink to="/settings" icon={<Settings className="size-4" />} onClick={() => setMenu(false)}>
                      Settings & privacy
                    </MenuLink>
                    {(role === 'admin' || role === 'city_admin') && (
                      <MenuLink to="/admin" icon={<ShieldCheck className="size-4 text-brand" />} onClick={() => setMenu(false)}>
                        {role === 'city_admin' ? `${cityAdminOf?.area} admin dashboard` : 'Admin dashboard'}
                      </MenuLink>
                    )}
                    {role === 'official' && (
                      <MenuLink to="/city-corp/dashboard" icon={<Building2 className="size-4 text-warn" />} onClick={() => setMenu(false)}>
                        {officialOf?.shortName} dashboard
                      </MenuLink>
                    )}
                    {role === 'citizen' && (
                      <MenuLink to="/volunteer" icon={<ShieldCheck className="size-4" />} onClick={() => setMenu(false)}>
                        {profile.is_volunteer ? 'Volunteer dashboard' : 'Become a volunteer'}
                      </MenuLink>
                    )}
                    <MenuLink to="/emergency" icon={<Siren className="size-4 text-danger" />} onClick={() => setMenu(false)}>
                      Emergency alert
                    </MenuLink>
                    <SignOutButton />
                  </div>
                )}
              </div>
            </>
          ) : (
            <Link to="/login" className="btn-primary">Log in</Link>
          )}
        </div>
      </div>
    </header>
  )
}

function SignOutButton() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  return (
    <button
      onClick={async () => { await signOut(); navigate('/') }}
      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-card-hover"
    >
      <LogOut className="size-4" /> Log out
    </button>
  )
}

function MenuLink({ to, icon, children, onClick }: { to: string; icon: ReactNode; children: ReactNode; onClick?: () => void }) {
  return (
    <Link to={to} onClick={onClick} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-card-hover">
      {icon}
      {children}
    </Link>
  )
}

function BottomNav() {
  const { user, role } = useAuth()
  const nav = navFor(role)
  const items = role === 'citizen'
    ? [nav[0], nav[1], { to: user ? '/new' : '/login', label: 'Report', icon: Plus, end: false }, nav[2], nav[3]]
    : nav
  return (
    <nav className="fixed inset-x-0 bottom-0 z-[1000] flex border-t border-line bg-card pb-[env(safe-area-inset-bottom)] md:hidden">
      {items.map((n) => (
        <NavLink
          key={n.label}
          to={n.to}
          className={({ isActive }) =>
            clsx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold',
              isActive ? 'text-brand' : 'text-muted')
          }
        >
          {n.label === 'Report' ? (
            <span className="grid size-8 place-items-center rounded-full bg-brand text-brand-ink">
              <n.icon className="size-5" />
            </span>
          ) : (
            <n.icon className="size-6" />
          )}
          {n.label !== 'Report' && n.label}
        </NavLink>
      ))}
    </nav>
  )
}

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
  const stats = useQuery({ queryKey: ['stats'], queryFn: getPlatformStats, staleTime: 60_000 }).data
  const top = useQuery({ queryKey: ['leaderboard'], queryFn: getLeaderboard, staleTime: 60_000 }).data ?? []
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
  const pos = getLastKnownPosition()
  const alerts = useQuery({
    queryKey: ['alerts', 'active', pos?.lat.toFixed(2), pos?.lng.toFixed(2)],
    queryFn: () => getActiveAlerts(pos?.lat ?? null, pos?.lng ?? null),
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
