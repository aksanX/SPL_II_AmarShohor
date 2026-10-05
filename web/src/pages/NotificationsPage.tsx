import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  BadgeCheck, Bell, Camera, CheckCircle2, Clock, EyeOff, Flag, Hourglass, Megaphone, MessageCircle, RotateCcw, Star, Wrench,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Avatar, Empty, PageSpinner } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useNotifications } from '../hooks/useData'
import { markNotificationsRead } from '../lib/api'
import { displayName, timeAgo } from '../lib/format'

const ICON: Record<string, ReactNode> = {
  comment: <MessageCircle className="size-4" />,
  reply: <MessageCircle className="size-4" />,
  issue_update: <Megaphone className="size-4" />,
  issue_confirmed: <Camera className="size-4" />,
  issue_validated: <BadgeCheck className="size-4" />,
  issue_flagged: <Flag className="size-4" />,
  issue_hidden: <EyeOff className="size-4" />,
  issue_expired: <Hourglass className="size-4" />,
  task_accepted: <Wrench className="size-4" />,
  task_progress: <Wrench className="size-4" />,
  task_released: <RotateCcw className="size-4" />,
  lock_reminder: <Clock className="size-4" />,
  lock_expired: <Hourglass className="size-4" />,
  resolution_submitted: <CheckCircle2 className="size-4" />,
  resolution_disputed: <RotateCcw className="size-4" />,
  issue_reopened: <RotateCcw className="size-4" />,
  issue_closed: <CheckCircle2 className="size-4" />,
  task_completed: <CheckCircle2 className="size-4" />,
  rate_volunteer: <Star className="size-4" />,
  rated: <Star className="size-4" />,
}

const TONE: Record<string, string> = {
  issue_flagged: 'bg-danger', issue_hidden: 'bg-danger', lock_expired: 'bg-danger', resolution_disputed: 'bg-danger',
  issue_reopened: 'bg-danger', lock_reminder: 'bg-warn', issue_validated: 'bg-info', resolution_submitted: 'bg-info',
}

export function NotificationsPage() {
  const { user, loading } = useAuth()
  const { data = [], isLoading, unread } = useNotifications()
  const qc = useQueryClient()
  const navigate = useNavigate()

  if (!loading && !user) return <Navigate to="/login" replace />

  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] })

  return (
    <div className="mx-auto max-w-2xl px-2 py-4 sm:px-4">
      <div className="card">
        <div className="flex items-center justify-between border-b border-line p-4">
          <h1 className="text-xl font-bold">Notifications</h1>
          {unread > 0 && (
            <button className="text-sm font-semibold text-brand hover:underline"
              onClick={async () => { await markNotificationsRead(); refresh() }}>
              Mark all as read
            </button>
          )}
        </div>
        {isLoading && <PageSpinner />}
        {!isLoading && data.length === 0 && (
          <div className="p-4"><Empty icon={<Bell className="size-8" />} title="No notifications yet">
            You'll hear here when someone comments, your report gets validated, or a volunteer acts.
          </Empty></div>
        )}
        <ul className="divide-y divide-line">
          {data.map((n) => (
            <li key={n.id}>
              <button
                className={clsx('flex w-full items-start gap-3 p-3 text-left hover:bg-card-hover', !n.read_at && 'bg-brand-soft/50')}
                onClick={async () => {
                  if (!n.read_at) { await markNotificationsRead([n.id]); refresh() }
                  if (n.alert_id) navigate(`/alert/${n.alert_id}`)
                  else if (n.issue_id) navigate(`/issue/${n.issue_id}`)
                  else if (n.type === 'role_request') navigate('/admin')
                }}
              >
                <div className="relative">
                  {n.actor_id
                    ? <Avatar url={n.actor_avatar_url} name={displayName(n.actor_full_name, n.actor_username)} size={48} />
                    : <div className="grid size-12 place-items-center rounded-full bg-bg text-muted"><Bell className="size-5" /></div>}
                  <span className={clsx('absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full border-2 border-card text-white',
                    TONE[n.type] ?? 'bg-brand')}>
                    {ICON[n.type] ?? <Bell className="size-4" />}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{n.message}</p>
                  <p className={clsx('text-xs', n.read_at ? 'text-muted' : 'font-semibold text-brand')}>{timeAgo(n.created_at)}</p>
                </div>
                {!n.read_at && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-brand" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
