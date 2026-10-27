import clsx from 'clsx'
import { Bell, BellRing, Building2, LogOut, Plus, Settings, ShieldCheck, Siren } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { ThemeToggle } from '@/shared/components/ThemeToggle'
import { displayName } from '@/shared/lib/format'
import { Avatar } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useNotifications } from '@/features/notifications/hooks/useNotifications'
import { Logo } from '@/app/layout/Logo'
import { navFor } from '@/app/layout/nav'

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

export function TopBar() {
  const { user, profile, role, officialOf, cityAdminOf } = useAuth()
  const nav = navFor(role)
  const { unread } = useNotifications()
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
        <div className="flex-1" />

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
