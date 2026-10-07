import { keepPreviousData, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Crosshair, FileText, MapPin, Search, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { getFeed, type BBox } from '../../lib/api'
import { parseLatLng, searchArea, searchPlaces, type Place } from '../../lib/geo'
import type { Issue } from '../../lib/types'
import { Spinner } from '../ui'

export type SearchPick =
  | { kind: 'place'; place: Place }
  | { kind: 'coords'; lat: number; lng: number }
  | { kind: 'issue'; issue: Issue }

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * One box for places (OpenStreetMap), reported issues (title / description / address) and raw coordinates.
 * The `near` viewport biases place results, so results are kept per ~5 km part of the map (searchArea): the same
 * text searched after moving across the city finds places there. Small pans reuse the results, and nothing is
 * searched while the list is closed, so panning the map doesn't fire requests.
 */
export function MapSearch({
  near, onPick, initialQuery, includeIssues = true, placeholder = 'Search a place, area or issue…', className,
}: {
  near: BBox | null
  onPick: (pick: SearchPick) => void
  initialQuery?: string
  /** Also search reported issues (the map page). The report form only needs places. */
  includeIssues?: boolean
  placeholder?: string
  className?: string
}) {
  const [text, setText] = useState(initialQuery ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  // Unique per box: the report form and the map page each have one.
  const listId = useId()
  const nearRef = useRef(near)
  useEffect(() => { nearRef.current = near }, [near])

  const q = useDebounced(text.trim(), 300)
  const coords = useMemo(() => parseLatLng(q), [q])

  const places = useQuery({
    queryKey: ['place-search', q.toLowerCase(), searchArea(near)],
    enabled: open && q.length >= 2 && !coords,
    staleTime: Infinity,
    // Keep showing the last results while the next ones load, so the list doesn't flash empty on every key.
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => searchPlaces(q, near ?? undefined, signal),
  })
  const issues = useQuery({
    queryKey: ['issue-search', q.toLowerCase()],
    enabled: includeIssues && q.length >= 2 && !coords,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: () => getFeed({ sort: 'hot', scope: 'all', search: q, limit: 5 }),
  })

  const options: SearchPick[] = useMemo(() => {
    if (coords) return [{ kind: 'coords', ...coords }]
    return [
      ...(places.data ?? []).map((place): SearchPick => ({ kind: 'place', place })),
      ...(includeIssues ? issues.data ?? [] : []).map((issue): SearchPick => ({ kind: 'issue', issue })),
    ]
  }, [coords, places.data, issues.data, includeIssues])


  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function pick(o: SearchPick) {
    setText(o.kind === 'place' ? o.place.name : o.kind === 'issue' ? o.issue.title : `${o.lat}, ${o.lng}`)
    setOpen(false)
    setSubmitError(null)
    onPick(o)
  }

  // Never below 0: an arrow key pressed before results arrive must not leave the first result unselected.
  const sel = Math.max(0, Math.min(active, options.length - 1))
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  /**
   * Enter: take the highlighted suggestion if the suggestions match what's typed. Otherwise (still typing,
   * nothing found, or search failed) run a full search for the exact text and go to the top result.
   */
  async function submit() {
    const query = text.trim()
    if (query.length < 2 || submitting) return
    const c = parseLatLng(query)
    if (c) return pick({ kind: 'coords', ...c })
    if (query === q && !places.isFetching && options[sel]) return pick(options[sel])
    setSubmitting(true)
    setSubmitError(null)
    setOpen(true)
    try {
      const [place] = await searchPlaces(query, nearRef.current ?? undefined, undefined, true)
      if (place) return pick({ kind: 'place', place })
      const issue = includeIssues && query === q ? issues.data?.[0] : undefined
      if (issue) return pick({ kind: 'issue', issue })
      setSubmitError(`Nothing found for “${query}”. Try a nearby landmark or area, then drag the pin.`)
    } catch (e) {
      setSubmitError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const loading = text.trim() !== q || places.isFetching || issues.isFetching || submitting
  const placeCount = places.data?.length ?? 0

  return (
    <div ref={boxRef} className="relative">
      {/* Not a <form>: this box also sits inside the report form, and Enter here must not submit that. */}
      <div className={clsx('card relative', className ?? 'shadow-lg')}>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          className="w-full rounded-xl bg-transparent py-2.5 pl-9 pr-9 text-sm outline-none"
          placeholder={placeholder}
          value={text}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); setSubmitError(null) }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.max(0, Math.min(a + 1, options.length - 1))) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter') { e.preventDefault(); void submit() }
          }}
          aria-label="Search the map"
          role="combobox"
          aria-expanded={open && q.length >= 2}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && q.length >= 2 && options[sel] ? `${listId}-${sel}` : undefined}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2">
          {loading && text.trim().length >= 2 ? (
            <Spinner className="mr-1 size-4" />
          ) : text ? (
            <button type="button" className="grid size-7 place-items-center rounded-full text-muted hover:bg-card-hover"
              onClick={() => { setText(''); setOpen(false); setSubmitError(null) }} aria-label="Clear search">
              <X className="size-4" />
            </button>
          ) : null}
        </span>
      </div>

      {open && q.length >= 2 && (
        <ul id={listId} role="listbox" aria-label="Search results"
          className={clsx('card absolute inset-x-0 top-full z-10 mt-1 max-h-80 overflow-y-auto py-1 shadow-lg transition-opacity',
            (places.isPlaceholderData || issues.isPlaceholderData) && 'opacity-60')}>
          {options.map((o, idx) => {
            const first = idx === 0 || (o.kind === 'issue' && idx === placeCount)
            return (
              <li key={o.kind === 'place' ? `p${idx}` : o.kind === 'issue' ? o.issue.id : 'c'} id={`${listId}-${idx}`} role="option" aria-selected={idx === sel}>
                {first && (
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {o.kind === 'place' ? 'Places' : o.kind === 'issue' ? 'Reported issues' : 'Coordinates'}
                  </p>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => pick(o)}
                  className={clsx('flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm', idx === sel && 'bg-card-hover')}
                >
                  {o.kind === 'place' && <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />}
                  {o.kind === 'coords' && <Crosshair className="mt-0.5 size-4 shrink-0 text-brand" />}
                  {o.kind === 'issue' && (
                    <FileText className="mt-0.5 size-4 shrink-0" style={{ color: o.issue.category_color }} />
                  )}
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">
                        {o.kind === 'place' ? o.place.name : o.kind === 'issue' ? o.issue.title : `Go to ${o.lat}, ${o.lng}`}
                      </span>
                      {o.kind === 'place' && o.place.isArea && (
                        <span className="shrink-0 rounded bg-bg px-1.5 text-[10px] font-semibold uppercase text-muted">Area</span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {o.kind === 'place'
                        ? [o.place.house, o.place.detail].filter(Boolean).join(', ')
                        : o.kind === 'issue'
                          ? [o.issue.category_name, o.issue.address].filter(Boolean).join(' · ')
                          : 'Drop a pin at these coordinates'}
                    </span>
                    {o.kind === 'place' && o.place.note && (
                      <span className="block text-xs text-warn">{o.place.note}</span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
          {submitError ? (
            <li className="px-3 py-3 text-sm text-danger">{submitError}</li>
          ) : !loading && options.length === 0 && (
            <li className="px-3 py-3 text-sm text-muted">
              {places.isError
                ? (places.error as Error).message
                : <>No quick match for “{q}”. Press <kbd className="font-semibold">Enter</kbd> to search full addresses.</>}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
