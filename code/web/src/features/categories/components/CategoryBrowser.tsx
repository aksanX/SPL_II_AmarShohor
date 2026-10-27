import clsx from 'clsx'
import { useCategoryFilter } from '@/features/categories/hooks/useCategoryFilter'

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
