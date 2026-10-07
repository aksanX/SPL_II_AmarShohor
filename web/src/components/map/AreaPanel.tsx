import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { ExternalLink, MapPin, X } from 'lucide-react'
import { getAreaSummary } from '../../lib/api'
import { formatDistance } from '../../lib/geo'
import { STATUS_META } from '../../lib/format'
import { mainGroupOf } from '../../lib/categories'
import { HEX_COLORS, RADII, areaLevel } from '../../lib/mapMath'
import type { Category, CategoryGroup } from '../../lib/types'
import { Spinner } from '../ui'

/** What the circle around the search pin looks like, by the same rules as the heatmap. */
export function AreaPanel({ lat, lng, label, radiusM, category, categories, groups, issueId, onRadius, onOpenIssue, onClose }: {
  lat: number
  lng: number
  label: string | null
  radiusM: number
  category: string | null
  categories: Category[]
  groups: CategoryGroup[]
  issueId: string | null
  onRadius: (m: number) => void
  onOpenIssue: (id: string) => void
  onClose: () => void
}) {
  // ~10 m precision is plenty and keeps the cache key stable while dragging the pin.
  const rl = (n: number) => Math.round(n * 10000) / 10000
  const query = useQuery({
    queryKey: ['area-summary', rl(lat), rl(lng), radiusM, category],
    queryFn: () => getAreaSummary(lat, lng, radiusM, category),
    staleTime: 30_000,
  })
  const s = query.data
  const cat = (slug: string) => categories.find((c) => c.slug === slug)
  const level = s ? areaLevel(Number(s.active), Number(s.heat_per_km2)) : null
  const totalHeat = s ? Number(s.heat) : 0

  // Heat per main group; categories outside any group are listed on their own.
  const byGroup = Object.values((s?.categories ?? []).reduce<
    Record<string, { key: string; name: string; color?: string; count: number; heat: number }>
  >((acc, c) => {
    const g = mainGroupOf(c.category, categories, groups)
    const key = g?.slug ?? c.category
    acc[key] ??= { key, name: g?.name ?? cat(c.category)?.name ?? c.category, color: g?.color ?? cat(c.category)?.color, count: 0, heat: 0 }
    acc[key].count += c.count
    acc[key].heat += Number(c.heat)
    return acc
  }, {})).sort((a, b) => b.heat - a.heat)

  return (
    <div className="card max-h-[45dvh] overflow-y-auto p-3 shadow-lg md:max-h-[calc(100dvh-56px-90px)]">
      <div className="flex items-start gap-2">
        <MapPin className="mt-0.5 size-4 shrink-0 text-[#1a6fd1]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{label || 'Dropped pin'}</p>
          <p className="text-xs text-muted">{lat.toFixed(5)}, {lng.toFixed(5)} · drag the pin to adjust</p>
        </div>
        <button onClick={onClose} aria-label="Remove pin" className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-card-hover">
          <X className="size-4" />
        </button>
      </div>

      {issueId && (
        <button onClick={() => onOpenIssue(issueId)} className="mt-2 flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
          Open this issue <ExternalLink className="size-3" />
        </button>
      )}

      <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-bg p-1" role="radiogroup" aria-label="Area radius">
        {RADII.map((m) => (
          <button key={m} role="radio" aria-checked={radiusM === m} onClick={() => onRadius(m)}
            className={clsx('rounded-md py-1 text-xs font-semibold', radiusM === m ? 'bg-card shadow-sm' : 'text-muted hover:text-ink')}>
            {formatDistance(m)}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <div className="grid place-items-center py-6"><Spinner className="size-5" /></div>
      ) : query.isError ? (
        <p className="mt-3 text-sm text-danger">{(query.error as Error).message}</p>
      ) : s && level && (
        <div className={clsx('mt-3 space-y-3', query.isFetching && 'opacity-60')}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span className="size-3 rounded-full" style={{ background: level.color }} />
              {level.label}
            </span>
            <span className="text-xs text-muted">heat {totalHeat.toFixed(1)} · {Number(s.heat_per_km2).toFixed(1)}/km²</span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            {([
              [s.active, 'active', 'Validated, not fixed yet — these make the heat'],
              [s.unverified, 'need validation', 'Not on the heatmap until the community validates them'],
              [s.resolved, 'resolved', 'Fixed and confirmed'],
            ] as const).map(([n, text, hint]) => (
              <div key={text} className="rounded-lg bg-bg px-1 py-2" title={hint}>
                <p className="text-lg font-bold leading-none">{n}</p>
                <p className="mt-1 text-[11px] text-muted">{text}</p>
              </div>
            ))}
          </div>

          {byGroup.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted">What makes it hot</p>
              {byGroup.map((g) => {
                const share = totalHeat > 0 ? (g.heat / totalHeat) * 100 : 0
                return (
                  <div key={g.key} className="text-xs">
                    <div className="flex justify-between">
                      <span>{g.name} <span className="text-muted">×{g.count}</span></span>
                      <span className="text-muted">{Math.round(share)}%</span>
                    </div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-bg">
                      <div className="h-full rounded-full" style={{ width: `${share}%`, background: g.color ?? HEX_COLORS[3] }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {s.hottest.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">Hottest issues here</p>
              <ul className="-mx-1">
                {s.hottest.map((h) => (
                  <li key={h.id}>
                    <button onClick={() => onOpenIssue(h.id)} className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-card-hover">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: cat(h.category)?.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{h.title}</span>
                        <span className="block text-[11px] text-muted">
                          {STATUS_META[h.status].label} · {formatDistance(Number(h.distance_m))} away
                        </span>
                      </span>
                      <span className="text-xs font-semibold text-muted">{Number(h.heat).toFixed(1)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
