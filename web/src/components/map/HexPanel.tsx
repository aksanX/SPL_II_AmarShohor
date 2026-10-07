import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Hexagon, MapPin, X } from 'lucide-react'
import { getMapIssues } from '../../lib/api'
import { SEVERITY_META, STATUS_META, timeAgo } from '../../lib/format'
import { areaName } from '../../lib/geo'
import { mediaUrl } from '../../lib/supabase'
import { hexCenter, hexIssues, hexNameDetail } from '../../lib/mapMath'
import type { Category, HexCell, MapIssue } from '../../lib/types'
import { Spinner } from '../ui'

/**
 * The issues behind one hexagon. Uses the same rules as the heatmap (validated, still-open issues and the
 * same category filter), so the list always matches the hexagon's count.
 */
export function HexPanel({ cell, mostly, category, categories, onOpenIssue, onShowPins, onClose }: {
  cell: HexCell
  /** Name of the main group that makes this hexagon hot. */
  mostly: string
  category: string | null
  categories: Category[]
  onOpenIssue: (id: string) => void
  onShowPins: () => void
  onClose: () => void
}) {
  const ring = cell.hex.coordinates[0]
  const lats = ring.map((p) => p[1])
  const lngs = ring.map((p) => p[0])
  const query = useQuery({
    queryKey: ['hex-issues', ring.map((p) => p.join(',')).join(';'), category],
    staleTime: 30_000,
    queryFn: async () => {
      const issues = await getMapIssues(
        { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) },
        category, ['active'],
      )
      return hexIssues(issues, ring)
    },
  })
  // Name the area the hexagon covers ("Sector 7, Uttara"), from OpenStreetMap, at its middle.
  const center = hexCenter(cell)
  const detail = hexNameDetail(cell)
  const place = useQuery({
    queryKey: ['area-name', center.lat.toFixed(4), center.lng.toFixed(4), detail],
    staleTime: Infinity,
    queryFn: () => areaName(center.lat, center.lng, detail),
  })
  const categoryName = (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug
  const issues: MapIssue[] = query.data ?? []

  return (
    <div className="card max-h-[45dvh] overflow-y-auto p-3 shadow-lg md:max-h-[calc(100dvh-56px-90px)]">
      <div className="flex items-start gap-2">
        <Hexagon className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {place.isPending
              ? <span className="font-normal text-muted">Finding the area…</span>
              : place.data ? `Around ${place.data}` : 'This area'}
          </p>
          <p className="text-xs text-muted">
            {cell.issue_count} active issue{cell.issue_count === 1 ? '' : 's'} · heat score {Number(cell.weight).toFixed(1)} · mostly {mostly}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close" className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-card-hover">
          <X className="size-4" />
        </button>
      </div>

      {query.isPending ? (
        <div className="grid place-items-center py-6"><Spinner className="size-5" /></div>
      ) : query.isError ? (
        <p className="mt-3 text-sm text-danger">{(query.error as Error).message}</p>
      ) : (
        <ul className="-mx-1 mt-2">
          {issues.map((i) => (
            <li key={i.id}>
              <button onClick={() => onOpenIssue(i.id)}
                className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-left hover:bg-card-hover">
                {i.thumb_path && i.thumb_type === 'image' ? (
                  <img src={mediaUrl(i.thumb_path)} alt="" className="size-12 shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="grid size-12 shrink-0 place-items-center rounded-md" style={{ background: `${i.category_color}1f` }}>
                    <MapPin className="size-5" style={{ color: i.category_color }} />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{i.title}</span>
                  <span className="block truncate text-xs text-muted">
                    <span style={{ color: i.category_color }}>●</span> {categoryName(i.category)} · {SEVERITY_META[i.severity].label}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {STATUS_META[i.status].label} · ▲ {i.upvote_count} · ✓ {i.confirmation_count} · {timeAgo(i.created_at)}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted" />
              </button>
            </li>
          ))}
          {issues.length === 0 && (
            <li className="px-1 py-3 text-sm text-muted">These issues were just updated. Move the map to refresh.</li>
          )}
        </ul>
      )}

      <button className="btn-soft mt-2 w-full" onClick={onShowPins}>
        <MapPin className="size-4" /> Show them as pins on the map
      </button>
    </div>
  )
}
