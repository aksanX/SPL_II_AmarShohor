import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Building2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { LoadError, PageSpinner } from '@/shared/ui'
import { CategoryPanel } from '@/features/categories/components/CategoryPanel'
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

/** The City Corporation's work queue, with a category panel on the left like the citizen "Reported issues". */
export function OfficialDashboard({ shortName, top }: { shortName: string; top?: ReactNode }) {
  const [tab, setTab] = useState<Tab>('new')
  const [category, setCategory] = useState<string | null>(null)
  const tasks = useQuery({ queryKey: ['authority_tasks', tab], queryFn: () => authorityService.getAuthorityTasks(tab) })
  const all = tasks.data ?? []
  const shown = category ? all.filter((t) => t.category === category) : all

  return (
    <div className="flex gap-6">
      <aside className="sticky top-16 hidden max-h-[calc(100vh-5rem)] w-64 shrink-0 overflow-y-auto pb-6 lg:block">
        <CategoryPanel issues={all} value={category} onChange={setCategory} />
      </aside>
      <section className="mx-auto w-full min-w-0 max-w-3xl flex-1 space-y-3">
        {top}
        <div className="card flex items-center gap-3 p-4">
          <div className="grid size-12 place-items-center rounded-xl bg-warn-soft text-warn"><Building2 className="size-7" /></div>
          <div>
            <h1 className="text-xl font-bold">{shortName} dashboard</h1>
            <p className="text-sm text-muted">Validated issues in your area are sent here automatically. Open one to work on it.</p>
          </div>
        </div>
        <div className="card flex gap-1 p-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); setCategory(null) }}
              className={clsx('flex-1 rounded-lg px-3 py-2 text-sm font-semibold',
                tab === t.id ? (t.id === 'overdue' ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand') : 'text-muted hover:bg-card-hover')}>
              {t.label}
            </button>
          ))}
        </div>
        {/* Phones: no left panel, so the category dropdown sits above the list. */}
        {all.length > 0 && (
          <div className="lg:hidden"><CategoryPanel issues={all} value={category} onChange={setCategory} /></div>
        )}
        {tasks.isLoading && <PageSpinner />}
        {tasks.isError && <LoadError what="tasks" error={tasks.error} onRetry={() => tasks.refetch()} />}
        {tasks.isSuccess && !all.length && <p className="card p-4 text-sm text-muted">{EMPTY[tab]}</p>}
        {shown.map((t) => <AuthorityTaskRow key={t.id} task={t} showStage={tab === 'active'} />)}
      </section>
    </div>
  )
}
