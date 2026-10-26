import { useQuery } from '@tanstack/react-query'
import { useId, useState } from 'react'
import type { PersonMatch } from '@/models'
import { useDebounced } from '@/shared/hooks/useDebounced'
import { displayName } from '@/shared/lib/format'
import { Avatar } from '@/shared/ui'
import { roleService } from '@/features/admin/services/role.service'

/** What the person already is: appointing them would be refused, so the list says so up front. */
function roleLabel(p: PersonMatch): string | null {
  const roles = p.roles?.split(',') ?? []
  if (roles.includes('admin')) return 'Super admin'
  if (roles.includes('city_admin')) return 'Area admin'
  if (roles.includes('official')) return 'Official'
  if (p.pending_official) return 'Official sign-up'
  return null
}

/**
 * The username box for appointing someone (0077): type part of a username or name and pick the person from the
 * list. Typing an exact username still works without picking.
 */
export function PersonSearch({ value, onChange }: { value: string; onChange: (username: string) => void }) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const q = useDebounced(value.trim(), 300)
  const found = useQuery({
    queryKey: ['people_search', q],
    queryFn: () => roleService.findPeople(q),
    enabled: open && q.length >= 2,
  })
  const people = found.data ?? []
  const showList = open && q.length >= 2

  return (
    <div className="relative">
      <input className="input" value={value} maxLength={80} placeholder="Name or username" aria-label="Username"
        role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }} />
      {showList && (
        <ul id={listId} role="listbox" className="card absolute z-20 mt-1 max-h-72 w-full min-w-64 divide-y divide-line overflow-y-auto shadow-lg">
          {found.isLoading && <li className="p-3 text-sm text-muted">Searching…</li>}
          {found.isError && <li className="p-3 text-sm text-danger">Search isn't working right now. Type the exact username.</li>}
          {found.isSuccess && !people.length && <li className="p-3 text-sm text-muted">Nobody found</li>}
          {people.map((p) => {
            const label = roleLabel(p)
            return (
              <li key={p.username} role="option" aria-selected={p.username === value}>
                {/* mousedown, not click: the input's blur would close the list before a click lands. */}
                <button type="button" className="flex w-full items-center gap-2 p-2 text-left text-sm hover:bg-card-hover"
                  onMouseDown={(e) => { e.preventDefault(); onChange(p.username); setOpen(false) }}>
                  <Avatar url={p.avatar_url} name={displayName(p.full_name, p.username)} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{displayName(p.full_name, p.username)}</span>
                    <span className="block truncate text-xs text-muted">@{p.username}{p.area_name ? ` · ${p.area_name}` : ''}</span>
                  </span>
                  {label && <span className="chip shrink-0 bg-warn-soft text-warn">{label}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
