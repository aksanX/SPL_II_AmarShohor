import clsx from 'clsx'
import { LayoutGrid } from 'lucide-react'
import { useCategoryFilter } from '../hooks/useCategoryFilter'
import { CategoryIcon } from '../lib/categories'

/**
 * "Reported issues": View all, or tick any of the main groups. Lives in the left sidebar on wide screens and on
 * top of the feed on phones. Unticking a group also forgets its subcategories.
 */
export function GroupPicker({ className }: { className?: string }) {
  const { tree, groups, subs, setPicked, onIssues } = useCategoryFilter()

  function toggle(slug: string) {
    if (!groups.includes(slug)) return setPicked([...groups, slug], subs)
    const own = tree.find((n) => n.group.slug === slug)?.subgroups.map((s) => s.group.slug) ?? []
    setPicked(groups.filter((g) => g !== slug), subs.filter((s) => !own.includes(s)))
  }

  const allOn = onIssues && groups.length === 0
  return (
    <div className={clsx('space-y-0.5', className)} role="group" aria-label="Reported issue categories">
      <button
        type="button"
        aria-pressed={allOn}
        onClick={() => setPicked([], [])}
        className={clsx('flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-card-hover',
          allOn && 'bg-brand-soft font-semibold text-brand')}
      >
        <span className="size-4 shrink-0" />
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
          <LayoutGrid className="size-4" aria-hidden />
        </span>
        View all
      </button>
      {tree.map((node) => {
        const on = groups.includes(node.group.slug)
        return (
          <label
            key={node.group.slug}
            className={clsx('flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-card-hover',
              on && 'bg-brand-soft font-semibold')}
          >
            <input type="checkbox" className="size-4 shrink-0 accent-[var(--brand)]" checked={on}
              onChange={() => toggle(node.group.slug)} />
            <span className="grid size-8 shrink-0 place-items-center rounded-full"
              style={{ background: `${node.group.color}1f`, color: node.group.color }}>
              <CategoryIcon icon={node.group.icon} className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block leading-tight">{node.group.name}</span>
              <span className="block truncate text-xs font-normal text-muted">{node.group.name_bn}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

/** The subcategories of the picked groups, shown on top of the feed. Nothing ticked in a group = the whole group. */
export function SubgroupPicker() {
  const { tree, groups, subs, setPicked } = useCategoryFilter()
  const picked = tree.filter((n) => groups.includes(n.group.slug))
  if (picked.length === 0) return null

  const toggle = (slug: string) =>
    setPicked(groups, subs.includes(slug) ? subs.filter((s) => s !== slug) : [...subs, slug])

  return (
    <section className="card space-y-4 p-3" aria-label="Subcategories">
      {picked.map((node) => {
        const chosen = node.subgroups.filter((s) => subs.includes(s.group.slug)).length
        return (
          <div key={node.group.slug} className="space-y-2">
            <div className="px-1">
              <h2 className="text-sm font-semibold" style={{ color: node.group.color }}>{node.group.name}</h2>
              <p className="text-xs text-muted">
                {chosen === 0
                  ? 'Showing all subcategories. Tick some to narrow it down.'
                  : `${chosen} of ${node.subgroups.length} subcategories`}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {node.subgroups.map((sub) => {
                const on = subs.includes(sub.group.slug)
                return (
                  <label
                    key={sub.group.slug}
                    className={clsx('flex cursor-pointer items-start gap-2 rounded-lg border p-2.5',
                      on ? 'border-brand bg-brand-soft' : 'border-line hover:bg-card-hover')}
                  >
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" checked={on}
                      onChange={() => toggle(sub.group.slug)} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{sub.group.code} {sub.group.name}</span>
                      <span className="block text-xs text-muted">
                        {sub.categories.filter((c) => c.is_active).map((c) => c.name).join(' · ')}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </section>
  )
}
