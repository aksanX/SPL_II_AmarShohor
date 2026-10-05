import { useInfiniteQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Camera, Flame, ListFilter, LocateFixed, MapPin, Sparkles, TrendingUp, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { GroupPicker, SubgroupPicker } from '../components/CategoryBrowser'
import { IssueCard } from '../components/IssueCard'
import { FeedLayout } from '../components/Layout'
import { Avatar, Empty, PageSpinner, Spinner } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useCategoryFilter } from '../hooks/useCategoryFilter'
import { useCategories, useMySettings } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { getFeed } from '../lib/api'
import { displayName } from '../lib/format'
import { getCurrentPosition } from '../lib/geo'
import type { FeedScope, FeedSort } from '../lib/types'

const PAGE = 15

const SORTS: { value: FeedSort; label: string; icon: typeof Flame }[] = [
  { value: 'hot', label: 'Hot', icon: Flame },
  { value: 'new', label: 'New', icon: Sparkles },
  { value: 'near', label: 'Near me', icon: MapPin },
  { value: 'top', label: 'Top', icon: TrendingUp },
]

const SCOPES: { value: FeedScope; label: string; needsLogin?: boolean }[] = [
  { value: 'all', label: 'All' },
  { value: 'unverified', label: 'Needs validation' },
  { value: 'validated', label: 'Validated' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'following', label: 'Following', needsLogin: true },
  { value: 'mine', label: 'My reports', needsLogin: true },
]

/**
 * The citizen feed. With `browse` it is the "Reported issues" page: the main groups are picked in the left
 * sidebar (on top of the feed on phones) and their subcategories on top of the feed.
 */
export function FeedPage({ browse = false }: { browse?: boolean }) {
  const { user, profile, role } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const sort = (params.get('sort') as FeedSort) || 'hot'
  const scope = (params.get('scope') as FeedScope) || 'all'
  const category = params.get('category')
  const search = params.get('q')
  const categories = useCategories().data ?? []
  const mySettings = useMySettings().data
  const filter = useCategoryFilter()
  const pickedCategories = browse ? filter.categories : null

  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const origin = here ?? (mySettings?.home_lat != null ? { lat: mySettings.home_lat, lng: mySettings.home_lng! } : null)

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value === null) next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }


  async function chooseNear() {
    setParam('sort', 'near')
    if (here) return
    setLocating(true)
    try {
      const p = await getCurrentPosition()
      setHere({ lat: p.lat, lng: p.lng })
    } catch (e) {
      if (!origin) toast.error(e)
    } finally {
      setLocating(false)
    }
  }

  const feed = useInfiniteQuery({
    queryKey: ['feed', sort, scope, category, pickedCategories, search, sort === 'near' ? origin : null],
    queryFn: ({ pageParam }) =>
      getFeed({
        sort, scope, category, search, categories: pickedCategories,
        lat: origin?.lat, lng: origin?.lng, radiusM: 5000,
        limit: PAGE, offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === PAGE ? all.length * PAGE : undefined),
    enabled: (sort !== 'near' || Boolean(origin)) && (!browse || filter.ready),
  })

  // Infinite scroll
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && feed.hasNextPage && !feed.isFetchingNextPage) feed.fetchNextPage()
    }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [feed])

  // The feed is for citizens; admins and officials work from their own dashboard.
  if (role === 'admin') return <Navigate to="/admin" replace />
  if (role === 'official') return <Navigate to="/city-corp/dashboard" replace />

  const issues = feed.data?.pages.flat() ?? []
  const activeCategory = categories.find((c) => c.slug === category)

  return (
    <FeedLayout>
      <div className="space-y-3">
        {browse && (
          <>
            <h1 className="px-1 text-lg font-bold">Reported issues</h1>
            <div className="card p-2 lg:hidden"><GroupPicker /></div>
            <SubgroupPicker />
          </>
        )}

        {/* Composer */}
        {browse ? null : user && profile ? (
          <div className="card p-3">
            <div className="flex items-center gap-2">
              <Avatar url={profile.avatar_url} name={displayName(profile.full_name, profile.username)} />
              <Link to="/new" className="flex-1 rounded-full bg-bg px-4 py-2.5 text-muted hover:brightness-95">
                What's wrong in your area, {displayName(profile.full_name, profile.username).split(' ')[0]}?
              </Link>
            </div>
            <div className="mt-2 flex border-t border-line pt-2">
              <Link to="/new" className="btn-ghost flex-1"><Camera className="size-5 text-danger" /> Photo / video</Link>
              <Link to="/new" className="btn-ghost flex-1"><MapPin className="size-5 text-brand" /> Pin location</Link>
            </div>
          </div>
        ) : (
          <div className="card flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center">
            <div className="flex-1">
              <h1 className="text-lg font-bold">See a problem in your city?</h1>
              <p className="text-sm text-muted">Report it, let neighbours verify it, and volunteers fix it — no paperwork, no admins.</p>
            </div>
            <Link to="/login" className="btn-primary">Join AmarShohor</Link>
          </div>
        )}

        {/* Sort tabs */}
        <div className="card flex gap-1 p-1.5">
          {SORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => (s.value === 'near' ? chooseNear() : setParam('sort', s.value === 'hot' ? null : s.value))}
              className={clsx('flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold',
                sort === s.value ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-card-hover')}
            >
              {s.value === 'near' && locating ? <Spinner className="size-4" /> : <s.icon className="size-4" />}
              {s.label}
            </button>
          ))}
        </div>

        {/* Scope chips */}
        <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-1 sm:mx-0 sm:px-0">
          {SCOPES.filter((s) => !s.needsLogin || user).map((s) => (
            <button
              key={s.value}
              onClick={() => setParam('scope', s.value === 'all' ? null : s.value)}
              className={clsx('shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold',
                scope === s.value ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-card text-ink hover:bg-card-hover')}
            >
              {s.label}
            </button>
          ))}
          {!browse && (
            <Link to="/issues"
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold hover:bg-card-hover lg:hidden">
              <ListFilter className="size-4" /> Categories
            </Link>
          )}
        </div>

        {(activeCategory || search) && (
          <div className="flex flex-wrap gap-2">
            {activeCategory && (
              <button className="chip bg-card-hover py-1 text-ink" onClick={() => setParam('category', null)}>
                {activeCategory.name} <X className="size-3.5" />
              </button>
            )}
            {search && (
              <button className="chip bg-card-hover py-1 text-ink" onClick={() => setParam('q', null)}>
                “{search}” <X className="size-3.5" />
              </button>
            )}
          </div>
        )}

        {sort === 'near' && !origin && !locating && (
          <Empty icon={<LocateFixed className="size-8" />} title="Where are you?">
            Allow location access, or set your home area in <Link className="text-brand underline" to="/settings">Settings</Link>,
            to see issues within 5 km.
          </Empty>
        )}

        {feed.isLoading && <PageSpinner />}
        {feed.isError && <Empty title="Couldn't load the feed">{(feed.error as Error).message}</Empty>}
        {!feed.isLoading && !feed.isError && issues.length === 0 && (sort !== 'near' || origin) && (
          <Empty icon={<Sparkles className="size-8" />} title="Nothing here yet">
            {scope === 'following' ? 'Follow issues to see them here.'
              : pickedCategories ? 'No reported issues in these categories yet.'
              : 'Be the first to report a problem in your area.'}
          </Empty>
        )}

        {issues.map((issue) => <IssueCard key={issue.id} issue={issue} />)}

        <div ref={sentinel} />
        {feed.isFetchingNextPage && <PageSpinner />}
        {!feed.hasNextPage && issues.length > PAGE && (
          <p className="py-6 text-center text-sm text-muted">You're all caught up.</p>
        )}
      </div>
    </FeedLayout>
  )
}
