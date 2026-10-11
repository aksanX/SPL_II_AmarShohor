// The menu each role sees.
import { Building2, Compass, HandHelping, Home, LayoutDashboard, Trophy, type LucideIcon } from 'lucide-react'
import { useAuth } from '@/features/auth/hooks/useAuth'

type Role = ReturnType<typeof useAuth>['role']

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean }

const FEED: NavItem = { to: '/feed', label: 'Home', icon: Home }

const MAP: NavItem = { to: '/map', label: 'Explore', icon: Compass }

const VOLUNTEER: NavItem = { to: '/volunteer', label: 'Volunteer', icon: HandHelping }

const LEADERBOARD: NavItem = { to: '/leaderboard', label: 'Leaderboard', icon: Trophy }

const CITY_RECORD: NavItem = { to: '/city-corp', label: 'City Corporations', icon: Building2, end: true }

/** Each role gets its own menu. The feed is for citizens; admins and officials work from their dashboard. */
export function navFor(role: Role): NavItem[] {
  if (role === 'admin' || role === 'city_admin') return [{ to: '/admin', label: 'Admin', icon: LayoutDashboard }, MAP, CITY_RECORD]
  if (role === 'official') return [{ to: '/city-corp/dashboard', label: 'Dashboard', icon: LayoutDashboard }, MAP]
  return [FEED, MAP, VOLUNTEER, LEADERBOARD, CITY_RECORD]
}
