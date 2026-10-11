import clsx from 'clsx'
import { useState } from 'react'
import { Spinner } from '@/shared/ui'
import { useCategoryGroups } from '@/features/categories/hooks/useCategories'
import { categoryService } from '@/features/categories/services/category.service'
import { CategoryIcon, ICON_NAMES } from '@/features/categories/components/CategoryIcon'
import { SEVERITIES, SEVERITY_META } from '@/features/issues/lib/issueLabels'
import type { Category, Severity } from '@/models'
import { useRunner } from '@/features/admin/hooks/useRunner'

export type CategoryDraft = Omit<Category, 'slug'> & { slug: string | null }

export function CategoryEditor({ initial, onDone }: { initial: CategoryDraft; onDone: () => void }) {
  const { busy, run } = useRunner()
  const [c, setC] = useState<CategoryDraft>(initial)
  const set = (patch: Partial<CategoryDraft>) => setC({ ...c, ...patch })
  const groups = useCategoryGroups().data ?? []

  function save() {
    run(() => categoryService.adminSaveCategory(c), 'Saved.', onDone)
  }

  return (
    <div className="card space-y-3 p-4">
      <h2 className="text-lg font-bold">{c.slug ? `Edit ${initial.name}` : 'New category'}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="c-name">Name</label>
          <input id="c-name" className="input" value={c.name} onChange={(e) => set({ name: e.target.value })} /></div>
        <div><label className="label" htmlFor="c-bn">Name in Bangla</label>
          <input id="c-bn" className="input" value={c.name_bn} onChange={(e) => set({ name_bn: e.target.value })} /></div>
        <div><label className="label" htmlFor="c-route">Usually fixed by</label>
          <select id="c-route" className="input" value={c.resolver} onChange={(e) => set({ resolver: e.target.value as Category['resolver'] })}>
            <option value="community" disabled={!c.volunteer_allowed}>Volunteers</option><option value="authority">City Corporation</option>
          </select></div>
        <div><label className="label" htmlFor="c-sev">Default severity</label>
          <select id="c-sev" className="input" value={c.default_severity} onChange={(e) => set({ default_severity: e.target.value as Severity })}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_META[s].label}</option>)}
          </select></div>
        <div><label className="label" htmlFor="c-color">Colour</label>
          <input id="c-color" type="color" className="h-10 w-full rounded-lg border border-line" value={c.color} onChange={(e) => set({ color: e.target.value })} /></div>
        <div><label className="label" htmlFor="c-order">Order in lists</label>
          <input id="c-order" type="number" className="input" value={c.sort_order} onChange={(e) => set({ sort_order: Number(e.target.value) })} /></div>
      </div>
      <div>
        <span className="label">Icon</span>
        <div className="flex flex-wrap gap-1">
          {ICON_NAMES.map((n) => (
            <button key={n} type="button" aria-label={n} onClick={() => set({ icon: n })}
              className={clsx('grid size-10 place-items-center rounded-lg border', c.icon === n ? 'border-brand bg-brand-soft' : 'border-line')}
              style={{ color: c.color }}>
              <CategoryIcon icon={n} className="size-5" />
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={!c.volunteer_allowed}
          onChange={(e) => set({ volunteer_allowed: !e.target.checked, ...(e.target.checked ? { resolver: 'authority' as const } : {}) })} />
        <span>Too dangerous for volunteers <span className="block text-xs text-muted">Live wires, open manholes… Never shown to volunteers; always sent to an authority, even by an admin.</span></span>
      </label>
      <div><label className="label" htmlFor="c-subgroup">Group</label>
        <select id="c-subgroup" className="input" value={c.group_slug ?? ''}
          onChange={(e) => set({ group_slug: e.target.value || null })}>
          <option value="">No group (only shown under View all)</option>
          {groups.filter((g) => !g.parent_slug).map((g) => (
            <optgroup key={g.slug} label={`${g.code}. ${g.name}`}>
              {groups.filter((s) => s.parent_slug === g.slug).map((s) => (
                <option key={s.slug} value={s.slug}>{s.code} {s.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">Where citizens find it under Reported issues and when reporting.</p>
      </div>
      <div><label className="label" htmlFor="c-group">Duplicate group (optional)</label>
        <input id="c-group" className="input" value={c.duplicate_group ?? ''} placeholder="e.g. waste"
          onChange={(e) => set({ duplicate_group: e.target.value || null })} />
        <p className="mt-1 text-xs text-muted">Categories with the same group count as the same problem when checking for duplicates nearby (e.g. garbage and illegal dumping).</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={c.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
        Active (inactive categories stay on old issues but can't be chosen)
      </label>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy || c.name.trim().length < 2} onClick={save}>
          {busy && <Spinner className="size-4 text-brand-ink" />} Save
        </button>
        <button className="btn-ghost" onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}
