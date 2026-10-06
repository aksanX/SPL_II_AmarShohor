import { useMemo } from 'react'
import { useCategories, useCategoryGroups } from '../hooks/useData'
import { buildCategoryTree } from '../lib/categories'

/** Active categories as a dropdown, grouped by subgroup ("1.1 Road & Sidewalk Conditions"). */
export function CategorySelect({ value, onChange, exclude, placeholder = 'Choose what it really is…' }: {
  value: string; onChange: (slug: string) => void; exclude?: string | null; placeholder?: string
}) {
  const all = useCategories().data
  const groups = useCategoryGroups().data
  const categories = useMemo(() => (all ?? []).filter((c) => c.is_active && c.slug !== exclude), [all, exclude])
  const tree = useMemo(() => buildCategoryTree(groups ?? [], categories), [groups, categories])
  const grouped = new Set(tree.flatMap((g) => g.subgroups.flatMap((s) => s.categories.map((c) => c.slug))))
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Category">
      <option value="">{placeholder}</option>
      {tree.flatMap((g) => g.subgroups.map((s) => (
        <optgroup key={s.group.slug} label={`${s.group.code} ${s.group.name}`}>
          {s.categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </optgroup>
      )))}
      {categories.filter((c) => !grouped.has(c.slug)).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
    </select>
  )
}
