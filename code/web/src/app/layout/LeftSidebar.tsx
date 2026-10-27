import { ListFilter } from 'lucide-react'
import { Link } from 'react-router-dom'
import { displayName } from '@/shared/lib/format'
import { Avatar } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { CategoryDropdown } from '@/features/categories/components/CategoryDropdown'

export function LeftSidebar() {
  const { profile } = useAuth()
  return (
    <aside className="sticky top-16 hidden max-h-[calc(100vh-5rem)] w-64 shrink-0 overflow-y-auto pb-6 lg:block">
      {profile && (
        <div className="card mb-4 p-3 shadow-xs">
          <Link
            to={`/u/${profile.username}`}
            className="flex items-center gap-3 rounded-lg p-1 hover:bg-card-hover transition-colors"
          >
            <Avatar url={profile.avatar_url} name={displayName(profile.full_name, profile.username)} size={36} />
            <div className="min-w-0 flex-1">
              <span className="block truncate font-semibold leading-tight text-ink">
                {displayName(profile.full_name, profile.username)}
              </span>
              <span className="block truncate text-xs text-muted">
                @{profile.username} · {profile.reputation} rep
              </span>
            </div>
          </Link>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wider text-muted">
          <ListFilter className="size-3.5" /> Reported issues
        </h3>
        <CategoryDropdown />
      </div>
    </aside>
  )
}

