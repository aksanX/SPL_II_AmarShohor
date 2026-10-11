import { useQuery } from '@tanstack/react-query'
import { Building2, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, PageSpinner } from '@/shared/ui'
import { roleService } from '@/features/admin/services/role.service'
import { authorityService } from '@/features/city-corp/services/authority.service'
import type { Authority } from '@/models'
import { AuthorityEditor } from '@/features/admin/tabs/AuthorityEditor'

export function CityCorporations() {
  const authorities = useQuery({ queryKey: ['authorities'], queryFn: authorityService.getAuthorities })
  const records = useQuery({ queryKey: ['authority_records'], queryFn: authorityService.getAuthorityRecords }).data ?? []
  const cityAdmins = (useQuery({ queryKey: ['roles', 'all'], queryFn: roleService.getRoles }).data ?? []).filter((r) => r.role === 'city_admin')
  const [editing, setEditing] = useState<Authority | 'new' | null>(null)
  if (authorities.isLoading) return <PageSpinner />
  const list = authorities.data ?? []

  if (editing) {
    return <AuthorityEditor authority={editing === 'new' ? null : editing} all={list} onDone={() => setEditing(null)} />
  }
  return (
    <div className="space-y-3">
      {list.length === 0 && (
        <Empty icon={<Building2 className="size-8" />} title="No City Corporations yet">
          Add one and draw its service area. Escalated issues are sent to the City Corporation whose area contains them.
        </Empty>
      )}
      {list.map((a) => {
        const rec = records.find((r) => r.id === a.id)
        return (
          <article key={a.id} className="card flex flex-wrap items-center gap-3 p-4">
            <Building2 className="size-6 text-warn" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{a.name} <span className="text-muted">({a.short_name})</span>{a.kind === 'agency' && <span className="chip ml-2 bg-info-soft text-info">agency</span>}{!a.is_active && <span className="chip ml-2 bg-card-hover text-muted">inactive</span>}</p>
              <p className="text-xs text-muted">
                Hotline {a.hotline || 'not set'} · targets {a.due_days_critical}/{a.due_days_high}/{a.due_days_medium}/{a.due_days_low} days
                {rec && ` · ${rec.open} open, ${rec.overdue} overdue, ${rec.resolved} resolved`}
              </p>
              {a.kind === 'city_corporation' && (() => {
                const here = cityAdmins.filter((r) => r.authority_id === a.id)
                return (
                  <p className="text-xs">
                    {here.length
                      ? <>Area admin{here.length > 1 && 's'}: {here.map((r, i) => (
                        <span key={r.user_id}>{i > 0 && ', '}<Link to={`/u/${r.username}`} className="font-semibold hover:underline">@{r.username}</Link></span>
                      ))}</>
                      : <span className="text-warn">No admin appointed yet. Appoint one in Officials &amp; admins.</span>}
                  </p>
                )
              })()}
            </div>
            <button className="btn-soft" onClick={() => setEditing(a)}>Edit</button>
          </article>
        )
      })}
      <button className="btn-primary" onClick={() => setEditing('new')}><Plus className="size-4" /> Add City Corporation</button>
    </div>
  )
}
