import clsx from 'clsx'
import { Plus } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { navFor } from '@/app/layout/nav'

export function BottomNav() {
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
