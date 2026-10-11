import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { type CategoryDraft, CategoryEditor } from '@/features/admin/tabs/CategoryEditor'
import { CategoryIcon } from '@/features/categories/components/CategoryIcon'
import { categoryService } from '@/features/categories/services/category.service'
import { ROUTE_LABEL, SEVERITY_META } from '@/features/issues/lib/issueLabels'

const EMPTY_CATEGORY: CategoryDraft = {
  slug: null, name: '', name_bn: '', icon: 'circle-help', color: '#64748b', resolver: 'community',
  default_severity: 'medium', sort_order: 0, is_active: true, volunteer_allowed: true, duplicate_group: null,
  group_slug: null,
}

export function Categories() {
  const qc = useQueryClient()
  const categories = useQuery({ queryKey: ['categories', 'all'], queryFn: categoryService.getAllCategories })
  const [editing, setEditing] = useState<CategoryDraft | null>(null)

  if (editing) {
    return <CategoryEditor initial={editing} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['categories'] }) }} />
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2 className="px-1 font-bold">Categories</h2>
        <p className="px-1 text-xs text-muted">Reporters choose from these. New issues go to whoever usually fixes the category; you can move any issue later.</p>
        <div className="card divide-y divide-line">
          {categories.data?.map((c) => (
            <div key={c.slug} className="flex items-center gap-3 p-3 text-sm">
              <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: `${c.color}1f`, color: c.color }}>
                <CategoryIcon icon={c.icon} className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{c.name}</span> <span className="text-muted">{c.name_bn}</span>
                <span className="block text-xs text-muted">Usually {ROUTE_LABEL[c.resolver].toLowerCase()} · {SEVERITY_META[c.default_severity].label}{!c.volunteer_allowed && ' · never volunteers'}{c.duplicate_group && ` · duplicates: ${c.duplicate_group}`}{!c.is_active && ' · inactive'}</span>
              </span>
              <button className="btn-soft py-1.5 text-xs" onClick={() => setEditing(c)}>Edit</button>
            </div>
          ))}
          {!categories.data?.length && <p className="p-4 text-sm text-muted">No categories yet. Add some so people can report.</p>}
        </div>
        <button className="btn-primary" onClick={() => setEditing({ ...EMPTY_CATEGORY, sort_order: (categories.data?.length ?? 0) + 1 })}>
          <Plus className="size-4" /> Add category
        </button>
      </section>
    </div>
  )
}
