import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2, Phone } from 'lucide-react'
import { Empty, LoadError, PageSpinner } from '@/shared/ui'
import { authorityService } from '@/features/city-corp/services/authority.service'

export function PublicRecord() {
  const records = useQuery({ queryKey: ['authority_records'], queryFn: authorityService.getAuthorityRecords })
  if (records.isLoading) return <PageSpinner />
  if (records.isError) return <LoadError what="the City Corporation record" error={records.error} onRetry={() => records.refetch()} />
  const list = records.data ?? []
  return (
    <section className="space-y-3">
      <div className="px-1">
        <h2 className="text-lg font-bold">City Corporation record</h2>      </div>
      {!list.length && <Empty icon={<Building2 className="size-8" />} title="No City Corporations set up yet" />}
      {list.map((r) => (
        <article key={r.id} className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Building2 className="size-5 text-warn" />
            <h3 className="font-bold">{r.name}</h3>
            {!r.is_active && (
              <span className="chip bg-card-hover text-muted" title="Gets no new issues; its record stays visible">Switched off</span>
            )}
            {r.hotline && (
              <span className="ml-auto flex items-center gap-1 text-sm">
                <Phone className="size-4 text-muted" /> <span className="select-all font-semibold">{r.hotline}</span>
              </span>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
            <Stat label="Sent to them" value={r.escalated} />
            <Stat label="Resolved" value={r.resolved} />
            <Stat label="Open" value={r.open} />
            <Stat label="Overdue" value={r.overdue} danger={r.overdue > 0} />
            <Stat label="Avg. days to fix" value={r.avg_days_to_resolve ?? '–'} />
          </dl>
        </article>
      ))}
    </section>
  )
}

function Stat({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return (
    <div className={clsx('rounded-lg p-2', danger ? 'bg-danger-soft text-danger' : 'bg-bg')}>
      <dd className="text-xl font-bold tabular-nums">{value}</dd>
      <dt className="text-xs text-muted">{label}</dt>
    </div>
  )
}
