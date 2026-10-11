import clsx from 'clsx'
import { AlarmClock, Clock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { mediaUrl } from '@/core/supabase'
import type { Issue } from '@/models'
import { timeAgo } from '@/shared/lib/format'
import { NoPhoto } from '@/shared/ui'
import { CategoryChip, SeverityBadge, StatusBadge } from '@/features/issues/components/IssueBadges'
import { dueText } from '@/features/issues/lib/issueLabels'

export function AuthorityTaskRow({ task }: { task: Issue }) {
  const thumb = task.media.find((m) => m.media_type === 'image')
  return (
    <Link to={`/issue/${task.id}`} className="card flex gap-3 p-3 hover:bg-card-hover">
      {thumb ? <img src={mediaUrl(thumb.path)} alt="" className="size-20 shrink-0 rounded-lg object-cover" />
        : <NoPhoto />}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="line-clamp-2 font-semibold leading-snug">{task.title}</p>
        <div className="flex flex-wrap gap-1">
          <CategoryChip issue={task} />
          <SeverityBadge severity={task.severity} />
          <StatusBadge status={task.status} />
        </div>
        <p className="text-xs text-muted">{task.address || `${task.lat.toFixed(4)}, ${task.lng.toFixed(4)}`}</p>
        {task.status !== 'closed' ? (
          <p className={clsx('flex items-center gap-1 text-xs font-semibold', task.is_overdue ? 'text-danger' : 'text-warn')}>
            {task.is_overdue ? <AlarmClock className="size-3.5" /> : <Clock className="size-3.5" />} {dueText(task.due_at)}
            {task.volunteer_username && <span className="font-normal text-muted"> · {task.volunteer_full_name || task.volunteer_username} on it</span>}
          </p>
        ) : (
          <p className="text-xs text-muted">Resolved {task.closed_at ? timeAgo(task.closed_at) : ''}</p>
        )}
      </div>
    </Link>
  )
}
