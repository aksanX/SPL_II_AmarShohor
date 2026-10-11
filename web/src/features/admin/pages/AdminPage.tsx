import { UnusedUploads } from '@/features/admin/components/UnusedUploads'
import clsx from 'clsx'
import { Building2, History, Inbox, Settings2, Tags, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Avatar, PageSpinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useTitle } from '@/shared/hooks/useTitle'
import { displayName } from '@/shared/lib/format'
import { ReviewQueue } from '@/features/admin/tabs/review-queue/ReviewQueue'
import { People } from '@/features/admin/tabs/People'
import { CityCorporations } from '@/features/admin/tabs/CityCorporations'
import { Categories } from '@/features/admin/tabs/Categories'
import { SettingsTab } from '@/features/admin/tabs/SettingsTab'
import { ActivityLog } from '@/features/admin/tabs/ActivityLog'

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
