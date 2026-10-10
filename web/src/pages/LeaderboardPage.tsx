import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Star, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar, Empty, LoadError, PageSpinner } from '../components/ui'
import { useAppSettings } from '../hooks/useData'
import { useTitle } from '../hooks/useTitle'
import { getLeaderboard } from '../lib/api'
import { displayName } from '../lib/format'

export function LeaderboardPage() {
  useTitle('Leaderboard')
  const { data = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ['leaderboard'], queryFn: getLeaderboard })
  const s = useAppSettings().data
  const medal = ['bg-[#f5c518] text-black', 'bg-[#c0c0c0] text-black', 'bg-[#cd7f32] text-white']

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-2 py-4 sm:px-4">
      <div className="card p-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Trophy className="size-7 text-warn" /> Volunteer leaderboard</h1>
        <p className="mt-1 text-sm text-muted">
          Reputation: +{s?.rep_task_completed ?? 10} per confirmed fix · ±{2 * (s?.rep_per_star ?? 5)} for a 5★ / 1★ rating ·{' '}
          {s?.rep_task_reopened ?? -15} if a fix is disputed · {s?.rep_task_expired ?? -5} if a task lock expires.
        </p>
      </div>

      {isLoading && <PageSpinner />}
      {isError && <LoadError what="the leaderboard" error={error} onRetry={() => refetch()} />}
      {!isLoading && !isError && data.length === 0 && <Empty icon={<Trophy className="size-8" />} title="No volunteers yet">Be the first to fix something!</Empty>}

      {data.length > 0 && (
        <ol className="card divide-y divide-line">
          {data.map((v) => (
            <li key={v.id}>
              <Link to={`/u/${v.username}`} className="flex items-center gap-3 p-3 hover:bg-card-hover">
                <span className={clsx('grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold',
                  v.rank <= 3 ? medal[v.rank - 1] : 'bg-bg text-muted')}>
                  {v.rank}
                </span>
                <Avatar url={v.avatar_url} name={displayName(v.full_name, v.username)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{displayName(v.full_name, v.username)}</p>
                  <p className="truncate text-xs text-muted">
                    @{v.username}{v.area_name && ` · ${v.area_name}`}
                  </p>
                </div>
                <div className="hidden text-right text-xs text-muted sm:block">
                  <p>{v.tasks_completed} fixed</p>
                  {v.avg_rating !== null && (
                    <p className="flex items-center justify-end gap-0.5"><Star className="size-3 fill-warn text-warn" /> {v.avg_rating} ({v.rating_count})</p>
                  )}
                </div>
                <div className="w-16 text-right">
                  <p className="text-lg font-bold text-brand">{v.reputation}</p>
                  <p className="text-[11px] text-muted">rep</p>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
