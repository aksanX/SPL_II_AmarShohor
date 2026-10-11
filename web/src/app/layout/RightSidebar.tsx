import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Link } from 'react-router-dom'
import { leaderboardService } from '@/features/leaderboard/services/leaderboard.service'
import { appSettingsService } from '@/shared/settings/appSettings.service'
import { displayName } from '@/shared/lib/format'
import { Avatar } from '@/shared/ui'

export function RightSidebar() {
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
