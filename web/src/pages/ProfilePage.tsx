import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { Calendar, Download, MapPin, Settings, Star } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { IssueCard } from '../components/IssueCard'
import { Avatar, Empty, PageSpinner, Spinner, VolunteerBadge } from '../components/ui'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { getFeed, getProfileByUsername, getRatingsFor, getRolesOf, getUserIssues } from '../lib/api'
import { STATUS_META, displayName, timeAgo } from '../lib/format'
import type { Issue } from '../lib/types'

export function ProfilePage() {
  const { username = '' } = useParams()
  const { user } = useAuth()
  const [tab, setTab] = useState<'reports' | 'ratings'>('reports')
  const profileQ = useQuery({ queryKey: ['profile-by-username', username], queryFn: () => getProfileByUsername(username) })
  const p = profileQ.data
  const isMe = Boolean(user && p && user.id === p.id)

  const reports = useInfiniteQuery({
    queryKey: ['feed', 'user', username],
    queryFn: ({ pageParam }) => getUserIssues(username, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length === 20 ? all.length * 20 : undefined),
    enabled: Boolean(p),
  })
  const ratings = useQuery({
    queryKey: ['ratings', p?.id],
    queryFn: () => getRatingsFor(p!.id),
    enabled: Boolean(p) && tab === 'ratings',
  })

  const roles = useQuery({ queryKey: ['roles', p?.id], queryFn: () => getRolesOf(p!.id), enabled: Boolean(p) }).data ?? []

  if (profileQ.isLoading) return <PageSpinner />
  if (!p) return <div className="mx-auto max-w-2xl p-4"><Empty title="User not found" /></div>

  const name = displayName(p.full_name, p.username)
  const avg = p.rating_count ? (p.rating_sum / p.rating_count).toFixed(1) : null

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
                  <span key={r.role} className={clsx('chip', r.role === 'admin' ? 'bg-brand-soft text-brand' : 'bg-warn-soft text-warn')}
                    title={r.role === 'official' ? 'Verified by an admin' : undefined}>
                    {r.role === 'admin' ? 'Admin' : `${r.authority_short_name} Official ✓`}
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
          {!reports.isLoading && (reports.data?.pages.flat().length ?? 0) === 0 && (
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
          {!ratings.isLoading && (ratings.data ?? []).length === 0 && <p className="p-4 text-sm text-muted">No ratings yet.</p>}
          {(ratings.data ?? []).map((r) => (
            <div key={r.id} className="space-y-1 p-4">
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={clsx('size-4', n <= r.stars ? 'fill-warn text-warn' : 'text-line')} />
                ))}
                <span className="ml-2 text-xs text-muted">{timeAgo(r.created_at)} · by {r.rater_username ? `@${r.rater_username}` : 'an anonymous reporter'}</span>
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
      const all: Issue[] = []
      for (let offset = 0; ; offset += 50) {
        const page = await getFeed({ sort: 'new', scope: 'mine', limit: 50, offset })
        all.push(...page)
        if (page.length < 50) break
      }
      const cols = ['Title', 'Category', 'Severity', 'Status', 'Address', 'Latitude', 'Longitude', 'Upvotes',
        'On-site confirmations', 'Comments', 'Anonymous', 'Reported', 'Validated', 'Closed', 'Volunteer', 'Link']
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
      const rows = all.map((i) => [
        i.title, i.category_name, i.severity, STATUS_META[i.status].label, i.address, i.lat, i.lng, i.upvote_count,
        i.confirmation_count, i.comment_count, i.is_anonymous ? 'yes' : 'no', i.created_at, i.validated_at ?? '',
        i.closed_at ?? '', i.volunteer_username ?? '', `${window.location.origin}/issue/${i.id}`,
      ].map(esc).join(','))
      const blob = new Blob(['﻿' + [cols.map(esc).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `amarshohor-my-reports-${new Date().toISOString().slice(0, 10)}.csv`
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
