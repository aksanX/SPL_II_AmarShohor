import clsx from 'clsx'
import { Check, ChevronDown, LayoutGrid, ListFilter, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CategoryIcon } from '@/features/categories/components/CategoryIcon'
import { useCategoryFilter } from '@/features/categories/hooks/useCategoryFilter'

export function CategoryDropdown({ className }: { className?: string }) {
  const { tree, groups, subs, setPicked, onIssues } = useCategoryFilter()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    if (!isOpen) return

    function handleMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  function toggle(slug: string) {
    if (!groups.includes(slug)) {
      return setPicked([...groups, slug], subs)
    }
    const own = tree.find((n) => n.group.slug === slug)?.subgroups.map((s) => s.group.slug) ?? []
    setPicked(groups.filter((g) => g !== slug), subs.filter((s) => !own.includes(s)))
  }

  const allOn = onIssues && groups.length === 0
  const selectedNode = groups.length === 1 ? tree.find((n) => n.group.slug === groups[0]) : null

  const summaryText =
    groups.length === 0
      ? 'All Categories'
      : groups.length === 1 && selectedNode
        ? selectedNode.group.name
        : `${groups.length} categories selected`

  return (
    <div className={clsx('relative w-full', className)} ref={dropdownRef}>
      {/* Dropdown trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={clsx(
          'flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 py-2 text-left text-sm font-medium transition-all duration-150 cursor-pointer shadow-xs',
          isOpen ? 'border-brand ring-2 ring-brand/15 bg-card-hover' : 'hover:border-line/80 hover:bg-card-hover',
          groups.length > 0 && 'border-brand/40 bg-brand-soft/30'
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {selectedNode ? (
            <span
              className="grid size-6 shrink-0 place-items-center rounded-full text-xs"
              style={{ background: `${selectedNode.group.color}22`, color: selectedNode.group.color }}
            >
              <CategoryIcon icon={selectedNode.group.icon} className="size-3.5" />
            </span>
          ) : groups.length > 1 ? (
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-brand text-xs">
              <ListFilter className="size-3.5" />
            </span>
          ) : (
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft text-brand text-xs">
              <LayoutGrid className="size-3.5" />
            </span>
          )}
          <span className="truncate font-semibold text-ink">{summaryText}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {groups.length > 0 && (
            <span className="grid min-w-5 place-items-center rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-bold text-brand-ink">
              {groups.length}
            </span>
          )}
          <ChevronDown
            className={clsx('size-4 text-muted transition-transform duration-200', isOpen && 'rotate-180 text-brand')}
          />
        </div>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          role="listbox"
          aria-label="Filter issues by category"
          className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-line bg-card p-1.5 shadow-xl"
        >
          {/* View all option */}
          <button
            type="button"
            role="option"
            aria-selected={allOn}
            onClick={() => {
              setPicked([], [])
              setIsOpen(false)
            }}
            className={clsx(
              'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors cursor-pointer',
              allOn ? 'bg-brand-soft font-semibold text-brand' : 'hover:bg-card-hover text-ink'
            )}
          >
            <div className="flex items-center gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                <LayoutGrid className="size-3.5" />
              </span>
              <div>
                <span className="block leading-tight font-semibold">View all categories</span>
                <span className="block text-xs text-muted font-normal">Show every reported issue</span>
              </div>
            </div>
            {allOn && <Check className="size-4 shrink-0 text-brand" />}
          </button>

          <div className="my-1 border-t border-line" />

          {/* Group list */}
          <div className="space-y-0.5">
            {tree.map((node) => {
              const on = groups.includes(node.group.slug)
              return (
                <label
                  key={node.group.slug}
                  className={clsx(
                    'flex cursor-pointer items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                    on ? 'bg-brand-soft/60 font-semibold text-ink' : 'hover:bg-card-hover text-ink'
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 rounded accent-[var(--brand)] cursor-pointer"
                      checked={on}
                      onChange={() => toggle(node.group.slug)}
                    />
                    <span
                      className="grid size-7 shrink-0 place-items-center rounded-full"
                      style={{ background: `${node.group.color}1f`, color: node.group.color }}
                    >
                      <CategoryIcon icon={node.group.icon} className="size-3.5" />
                    </span>
                    <span className="min-w-0 truncate">
                      <span className="block truncate leading-tight">{node.group.name}</span>
                      <span className="block truncate text-xs font-normal text-muted">{node.group.name_bn}</span>
                    </span>
                  </div>

                  {on && <Check className="size-3.5 shrink-0 text-brand" />}
                </label>
              )
            })}
          </div>

          {/* Footer if categories are selected */}
          {groups.length > 0 && (
            <div className="mt-1 flex items-center justify-between border-t border-line pt-1.5 px-1">
              <button
                type="button"
                onClick={() => setPicked([], [])}
                className="flex items-center gap-1 text-xs font-medium text-muted hover:text-ink cursor-pointer px-1 py-1"
              >
                <RotateCcw className="size-3" />
                Reset
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-brand-ink hover:brightness-105 cursor-pointer"
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
