import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2 } from 'lucide-react'
import { useState } from 'react'
import { LoadError, PageSpinner } from '@/shared/ui'
import { AuthorityTaskRow } from '@/features/city-corp/components/AuthorityTaskRow'
import { authorityService } from '@/features/city-corp/services/authority.service'

type Tab = 'new' | 'active' | 'overdue' | 'done'

const TABS: { id: Tab; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'active', label: 'In progress' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'done', label: 'Resolved' },
]

const EMPTY: Record<Tab, string> = {
  new: 'No new issues. Issues appear here once residents validate a problem in your area.',
  active: 'Nothing in progress. Accept a task from "New" to start.',
  overdue: 'Nothing overdue.',
  done: 'No resolved issues yet.',
}

export function OfficialDashboard({ shortName }: { shortName: string }) {
  const [tab, setTab] = useState<Tab>('new')
  const tasks = useQuery({ queryKey: ['authority_tasks', tab], queryFn: () => authorityService.getAuthorityTasks(tab) })

  return (
    <section className="space-y-3">
      <div className="card flex items-center gap-3 p-4">
        <div className="grid size-12 place-items-center rounded-xl bg-warn-soft text-warn"><Building2 className="size-7" /></div>
        <div>
          <h1 className="text-xl font-bold">{shortName} dashboard</h1>
          <p className="text-sm text-muted">Validated issues in your area are sent here automatically. Open one to work on it.</p>
        </div>
      </div>
      <div className="card flex gap-1 p-1" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={clsx('flex-1 rounded-lg px-3 py-2 text-sm font-semibold',
              tab === t.id ? (t.id === 'overdue' ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand') : 'text-muted hover:bg-card-hover')}>
            {t.label}
          </button>
        ))}
      </div>
      {tasks.isLoading && <PageSpinner />}
      {tasks.isError && <LoadError what="tasks" error={tasks.error} onRetry={() => tasks.refetch()} />}
      {tasks.isSuccess && !tasks.data.length && <p className="card p-4 text-sm text-muted">{EMPTY[tab]}</p>}
      {(tasks.data ?? []).map((t) => <AuthorityTaskRow key={t.id} task={t} />)}
    </section>
  )
}
