import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Calendar, Download, MapPin, Settings, Star } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { IssueCard } from '../components/IssueCard'
import { Avatar, Empty, LoadError, PageSpinner, Spinner, VolunteerBadge } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useTitle } from '../hooks/useTitle'
import { useToast } from '../hooks/useToast'
import { getFeed, getProfileByUsername, getRatingsFor, getRolesOf, getUserIssues } from '../lib/api'
import { displayName, timeAgo } from '../lib/format'
import {
  averageRating, exportFileName, fetchAllPages, nextReportsOffset, raterText, reportsCsv, roleLabel,
} from '../lib/profile'

export function ProfilePage() {
  const { username = '' } = useParams()
  const { user } = useAuth()
  const [tab, setTab] = useState<'reports' | 'ratings'>('reports')
  const profileQ = useQuery({ queryKey: ['profile-by-username', username], queryFn: () => getProfileByUsername(username) })
  const p = profileQ.data
  useTitle(p ? displayName(p.full_name, p.username) : null)
  const isMe = Boolean(user && p && user.id === p.id)

  const reports = useInfiniteQuery({
    queryKey: ['feed', 'user', username],
    queryFn: ({ pageParam }) => getUserIssues(username, pageParam),
    initialPageParam: 0,
    getNextPageParam: nextReportsOffset,
    enabled: Boolean(p),
  })
  const ratings = useQuery({
    queryKey: ['ratings', p?.id],
    queryFn: () => getRatingsFor(p!.id),
    enabled: Boolean(p) && tab === 'ratings',
  })

  const roles = useQuery({ queryKey: ['roles', p?.id], queryFn: () => getRolesOf(p!.id), enabled: Boolean(p) }).data ?? []

  if (profileQ.isLoading) return <PageSpinner />
  // A network or database failure is not the same as a user who doesn't exist.
  if (profileQ.isError) {
    return <div className="mx-auto max-w-2xl p-4"><LoadError what="this profile" error={profileQ.error} onRetry={() => profileQ.refetch()} /></div>
  }
  if (!p) return <div className="mx-auto max-w-2xl p-4"><Empty title="User not found" /></div>

  const name = displayName(p.full_name, p.username)
  const avg = averageRating(p.rating_sum, p.rating_count)

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-2 py-4 sm:px-4">
      <div className="card overflow-hidden">
        <div className="h-28 bg-gradient-to-r from-brand to-[#1a6fd1] sm:h-36" />
        <div className="px-4 pb-4">
          <div className="-mt-12 flex flex-wrap items-end gap-4">
            <div className="rounded-full border-4 border-card"><Avatar url={p.avatar_url} name={name} size={104} /></div>
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">{name} {p.is_volunteer && <VolunteerBadge />}
                {roles.map((r) => (
                  <span key={r.role} className={clsx('chip', r.role === 'official' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand')}
                    title={r.role === 'official' ? 'Verified by an admin' : r.role === 'city_admin' ? `Admin of the ${r.authority_area} area` : undefined}>
                    {roleLabel(r)}
                  </span>
                ))}
              </h1>
              <p className="text-sm text-muted">@{p.username}</p>
            </div>
            {isMe && (
              <div className="flex gap-2 pb-1">
                <ExportButton />
                <Link to="/settings" className="btn-soft"><Settings className="size-4" /> Edit profile</Link>
              </div>
            )}
          </div>
          {p.bio && <p className="mt-3 whitespace-pre-line">{p.bio}</p>}
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted">
            {p.area_name && <span className="flex items-center gap-1"><MapPin className="size-4" /> {p.area_name}</span>}
            <span className="flex items-center gap-1"><Calendar className="size-4" /> Joined {timeAgo(p.created_at)}</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <Stat label="Reputation" value={p.reputation} />
            <Stat label="Reports" value={p.reports_count} />
            <Stat label="Fixed" value={p.tasks_completed} />
            <Stat label="Rating" value={avg ? `${avg}★` : '—'} />
          </dl>
        </div>
        <div className="flex border-t border-line px-2">
          {(['reports', 'ratings'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={clsx('border-b-[3px] px-4 py-3 text-sm font-semibold capitalize',
                tab === t ? 'border-brand text-brand' : 'border-transparent text-muted')}>
              {t === 'ratings' ? `Ratings received (${p.rating_count})` : 'Reports'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'reports' && (
        <div className="space-y-3">
          {reports.isLoading && <PageSpinner />}
          {reports.isError && <LoadError what="reports" error={reports.error} onRetry={() => reports.refetch()} />}
          {reports.isSuccess && reports.data.pages.flat().length === 0 && (
            <Empty title="No public reports">{isMe ? 'Your anonymous reports are only visible to you in "My reports".' : null}</Empty>
          )}
          {reports.data?.pages.flat().map((i) => <IssueCard key={i.id} issue={i} />)}
          {reports.hasNextPage && (
            <button className="btn-soft w-full" onClick={() => reports.fetchNextPage()} disabled={reports.isFetchingNextPage}>
              {reports.isFetchingNextPage && <Spinner className="size-4" />} Load more
            </button>
          )}
        </div>
      )}

      {tab === 'ratings' && (
        <div className="card divide-y divide-line">
          {ratings.isLoading && <PageSpinner />}
          {ratings.isError && <div className="p-4"><LoadError what="ratings" error={ratings.error} onRetry={() => ratings.refetch()} /></div>}
          {ratings.isSuccess && ratings.data.length === 0 && <p className="p-4 text-sm text-muted">No ratings yet.</p>}
          {(ratings.data ?? []).map((r) => (
            <div key={r.id} className="space-y-1 p-4">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={clsx('size-4', n <= r.stars ? 'fill-warn text-warn' : 'text-line')} />
                ))}
                <span className="ml-2 text-xs text-muted">{timeAgo(r.created_at)} · by {raterText(r.rater_username)}</span>
              </div>
              <Link to={`/issue/${r.issue_id}`} className="block text-sm font-semibold hover:underline">{r.issue_title}</Link>
              {r.review && <p className="text-sm">{r.review}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-bg p-2">
      <dd className="text-xl font-bold">{value}</dd>
      <dt className="text-xs text-muted">{label}</dt>
    </div>
  )
}

/** "Download personal reports": all of my reports (including anonymous) as CSV. */
function ExportButton() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function run() {
    setBusy(true)
    try {
      const all = await fetchAllPages((offset) => getFeed({ sort: 'new', scope: 'mine', limit: 50, offset }))
      const blob = new Blob([reportsCsv(all, window.location.origin)], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = exportFileName(new Date())
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button className="btn-soft" onClick={run} disabled={busy} title="Download my reports (CSV)">
      {busy ? <Spinner className="size-4" /> : <Download className="size-4" />}
      <span className="hidden sm:inline">My reports</span>
    </button>
  )
}
