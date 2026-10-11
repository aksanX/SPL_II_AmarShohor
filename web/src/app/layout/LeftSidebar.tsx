import { BellRing, Building2, CircleCheckBig, Compass, Flame, ListFilter, Siren, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { GroupPicker } from '@/features/categories/components/CategoryBrowser'
import { displayName } from '@/shared/lib/format'
import { Avatar } from '@/shared/ui'

export function LeftSidebar() {
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
