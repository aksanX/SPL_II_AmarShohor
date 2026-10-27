import clsx from 'clsx'
import { Check, ChevronDown, LayoutGrid, ListFilter } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Issue } from '@/models'
import { CategoryIcon } from '@/features/categories/components/CategoryIcon'
import { useCategories } from '@/features/categories/hooks/useCategories'

type Categorised = Pick<Issue, 'category' | 'category_name' | 'category_icon' | 'category_color'>

/** The categories in a list of issues, each with how many issues it has, most first. */
function countCategories(issues: Categorised[]) {
  const seen = new Map<string, Categorised & { count: number }>()
  for (const i of issues) {
    if (!i.category) continue
    const c = seen.get(i.category)
    if (c) c.count += 1
    else seen.set(i.category, { ...i, count: 1 })
  }
  return [...seen.values()].sort((a, b) => b.count - a.count || a.category_name.localeCompare(b.category_name))
}

/**
 * A category dropdown to narrow a dashboard list, styled like the citizen "Reported issues" one:
 * "All categories" or one category, each with how many issues it has.
 */
export function CategoryPanel({ issues, value, onChange, className }: {
  issues: Categorised[]; value: string | null; onChange: (slug: string | null) => void; className?: string
}) {
  const all = useCategories().data ?? []
  const counted = countCategories(issues)
  // Every active category is listed, like the citizen dropdown: those with issues here first (most first), then the
  // rest A–Z with 0. A picked category so stays picked when switching tabs, even where it has none.
  const empty = all
    .filter((c) => c.is_active && !counted.some((k) => k.category === c.slug))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ category: c.slug, category_name: c.name, category_icon: c.icon, category_color: c.color, count: 0 }))
  const categories = [...counted, ...empty]
  const selected = categories.find((c) => c.category === value) ?? null
  const [isOpen, setIsOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close when clicking outside or pressing Escape.
  useEffect(() => {
    if (!isOpen) return
    const onMouseDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false) }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false) }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const pick = (slug: string | null) => { onChange(slug); setIsOpen(false) }
  const option = (active: boolean) => clsx('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
    active ? 'bg-brand-soft font-semibold text-brand' : 'text-ink hover:bg-card-hover')

  return (
    <div className={clsx('space-y-2', className)}>
      <h3 className="flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wider text-muted">
        <ListFilter className="size-3.5" /> Categories
      </h3>
      <div className="relative w-full" ref={ref}>
        <button type="button" onClick={() => setIsOpen((o) => !o)} aria-expanded={isOpen} aria-haspopup="listbox"
          className={clsx('flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 py-2 text-left text-sm font-medium shadow-xs transition-all duration-150',
            isOpen ? 'border-brand bg-card-hover ring-2 ring-brand/15' : 'hover:bg-card-hover',
            selected && 'border-brand/40 bg-brand-soft/30')}>
          <span className="flex min-w-0 items-center gap-2.5">
            {selected ? (
              <span className="grid size-6 shrink-0 place-items-center rounded-full"
                style={{ background: `${selected.category_color}22`, color: selected.category_color }}>
                <CategoryIcon icon={selected.category_icon} className="size-3.5" />
              </span>
            ) : (
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><LayoutGrid className="size-3.5" /></span>
            )}
            <span className="truncate font-semibold text-ink">{selected ? selected.category_name : 'All categories'}</span>
          </span>
          <ChevronDown className={clsx('size-4 shrink-0 text-muted transition-transform duration-200', isOpen && 'rotate-180 text-brand')} />
        </button>

        {isOpen && (
          <div role="listbox" aria-label="Filter by category"
            // In the page flow, not floating: a floating list was cut off by a short side panel.
            className="mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-line bg-card p-1.5 shadow-xl">
            <button type="button" role="option" aria-selected={!value} className={option(!value)} onClick={() => pick(null)}>
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><LayoutGrid className="size-3.5" /></span>
              <span className="min-w-0 flex-1 truncate">All categories</span>
              <span className="text-xs text-muted">{issues.length}</span>
              {!value && <Check className="size-4 shrink-0 text-brand" />}
            </button>
            <div className="my-1 border-t border-line" />
            {categories.map((c) => (
              <button key={c.category} type="button" role="option" aria-selected={value === c.category}
                className={clsx(option(value === c.category), c.count === 0 && value !== c.category && 'opacity-50')}
                onClick={() => pick(c.category)}>
                <span className="grid size-7 shrink-0 place-items-center rounded-full"
                  style={{ background: `${c.category_color}22`, color: c.category_color }}>
                  <CategoryIcon icon={c.category_icon} className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1 truncate">{c.category_name}</span>
                <span className="text-xs text-muted">{c.count}</span>
                {value === c.category && <Check className="size-4 shrink-0 text-brand" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
