import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { timeAgo } from '@/shared/lib/format'
import { PageSpinner } from '@/shared/ui'
import { moderationService } from '@/features/admin/services/moderation.service'
import { roleService } from '@/features/admin/services/role.service'
import { useAuth } from '@/features/auth/hooks/useAuth'

export function ActivityLog() {
  const { isAdmin, cityAdminOf } = useAuth()
  // Super admins: whose actions to show. '' = everyone, 'super' = super admins, else an area admin's area.
  // Filtered in the database, so one admin's latest actions show however busy everyone else was.
  const [who, setWho] = useState('')
  const log = useQuery({ queryKey: ['admin_log', who], queryFn: () => moderationService.getAdminLog(200, who || null) })
  const areas = [...new Set((useQuery({ queryKey: ['roles', 'all'], queryFn: roleService.getRoles }).data ?? [])
    .filter((r) => r.role === 'city_admin' && r.authority_area).map((r) => r.authority_area as string))].sort()
  if (log.isLoading && !log.data) return <PageSpinner />
  const shown = log.data ?? []
  return (
    <div className="card divide-y divide-line">
      {!isAdmin && cityAdminOf && (
        <p className="p-3 text-xs text-muted">Your own actions, and every admin action about {cityAdminOf.area}'s issues, alerts and officials.</p>
      )}
      {isAdmin && (
        <div className="flex flex-wrap items-center gap-2 p-3">
          <label className="text-sm text-muted" htmlFor="log-who">Show actions by</label>
          <select id="log-who" className="input w-auto py-1.5" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {areas.map((a) => <option key={a} value={a}>{a} admin</option>)}
            <option value="super">Super admins</option>
          </select>
        </div>
      )}
      {shown.map((l) => (
        <div key={l.id} className="p-3 text-sm">
          <p>
            <strong>{l.admin_username ?? 'someone'}</strong>
            {l.admin_city && <span className="chip ml-1 bg-brand-soft px-1.5 text-[10px] text-brand">{l.admin_city} admin</span>}
            {' '}· {l.action.replaceAll('_', ' ')}
            {l.issue_title && <> on <Link to={`/issue/${l.issue_id}`} className="font-semibold hover:underline">"{l.issue_title}"</Link></>}
            {l.target_username && <> for <Link to={`/u/${l.target_username}`} className="hover:underline">@{l.target_username}</Link></>}
            {/* Deleted accounts: the profile is gone, so the log keeps the name. */}
            {!l.target_username && typeof l.data.username === 'string' && <> for @{l.data.username}</>}
            <span className="text-xs text-muted"> · {timeAgo(l.created_at)}</span>
          </p>
          {l.reason && <p className="text-muted">{l.reason}</p>}
        </div>
      ))}
      {!shown.length && <p className="p-4 text-sm text-muted">No admin actions yet.</p>}
    </div>
  )
}
