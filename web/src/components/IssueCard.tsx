import clsx from 'clsx'
import {
  ArrowBigUp, Bell, BellRing, Camera, Clock, Ellipsis, EyeOff, Flag, MapPin, MessageCircle, Pencil,
  Share2, Trash2, Wrench,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useAppSettings } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { toggleFollow, toggleVote, unflagIssue } from '../lib/api'
import { compact, displayName, hoursLeft, timeAgo, timeLeft } from '../lib/format'
import { getLastKnownPosition } from '../lib/geo'
import type { Issue } from '../lib/types'
import {
  ConfirmOnSiteDialog, EditIssueDialog, FlagDialog, useDeleteIssue, useInvalidateIssue,
} from './IssueDialogs'
import { MediaGallery } from './MediaGallery'
import { Avatar, CategoryChip, SeverityBadge, StatusBadge, ValidationMeter } from './ui'

const CONFIRMABLE = ['community_review', 'validated', 'assigned', 'in_progress']

export function IssueCard({ issue, full = false, autoConfirm = false }: { issue: Issue; full?: boolean; autoConfirm?: boolean }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const deleteIssue = useDeleteIssue()
  const minSupporters = useAppSettings().data?.min_supporters ?? 2

  // Optimistic UI for the two most-clicked buttons.
  const [voted, setVoted] = useState(issue.my_vote)
  const [votes, setVotes] = useState(issue.upvote_count)
  const [following, setFollowing] = useState(issue.my_following)
  useEffect(() => { setVoted(issue.my_vote); setVotes(issue.upvote_count) }, [issue.my_vote, issue.upvote_count])
  useEffect(() => { setFollowing(issue.my_following) }, [issue.my_following])

  const canConfirm = CONFIRMABLE.includes(issue.status) && !issue.is_mine && !issue.my_confirmed
  // Arriving from the duplicate check ("Yes — I see this too") opens the confirmation straight away.
  const [dialog, setDialog] = useState<'confirm' | 'flag' | 'edit' | null>(
    autoConfirm && canConfirm && user ? 'confirm' : null,
  )
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])

  const requireLogin = () => {
    if (!user) navigate('/login', { state: { from: `/issue/${issue.id}` } })
    return Boolean(user)
  }

  async function onVote() {
    if (!requireLogin()) return
    if (issue.my_confirmed) return toast.info('You already confirmed this on-site — that counts more than an upvote.')
    const prev = { voted, votes }
    setVoted(!voted)
    setVotes(votes + (voted ? -1 : 1))
    try {
      const pos = getLastKnownPosition()
      await toggleVote(issue.id, pos?.lat, pos?.lng)
      invalidate(issue.id)
    } catch (e) {
      setVoted(prev.voted)
      setVotes(prev.votes)
      toast.error(e)
    }
  }

  async function onFollow() {
    if (!requireLogin()) return
    setFollowing(!following)
    try {
      const now = await toggleFollow(issue.id)
      setFollowing(now)
      toast.success(now ? 'You\'ll be notified about updates' : 'Unfollowed')
    } catch (e) {
      setFollowing(following)
      toast.error(e)
    }
  }

  async function onShare() {
    const url = `${window.location.origin}/issue/${issue.id}`
    const text = `${issue.title} — ${issue.address || 'AmarShohor'}`
    try {
      if (navigator.share) await navigator.share({ title: issue.title, text, url })
      else {
        await navigator.clipboard.writeText(url)
        toast.success('Link copied — share it on Facebook or WhatsApp')
      }
    } catch {
      /* user cancelled */
    }
  }

  async function onUnflag() {
    try {
      await unflagIssue(issue.id)
      toast.success('Flag removed')
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    }
  }

  const reporterName = issue.is_anonymous && !issue.is_mine
    ? 'Anonymous citizen'
    : displayName(issue.reporter_full_name, issue.reporter_username)
  const canEdit = issue.is_mine && issue.status === 'community_review'
  const canDelete = issue.is_mine && ['community_review', 'hidden', 'expired'].includes(issue.status)
  const canFlag = !issue.is_mine && ['community_review', 'validated', 'hidden'].includes(issue.status)
  const lockHours = hoursLeft(issue.lock_expires_at)

  return (
    <article className="card overflow-hidden">
      {issue.status === 'hidden' && (
        <div className="flex items-center gap-2 bg-danger-soft px-4 py-2 text-sm text-danger">
          <EyeOff className="size-4" /> Hidden from the feed: the community flagged this as fake or misleading.
        </div>
      )}

      {/* Header */}
      <header className="flex items-start gap-3 px-4 pt-3">
        {issue.is_anonymous && !issue.is_mine ? (
          <Avatar anonymous />
        ) : (
          <Link to={`/u/${issue.reporter_username}`}>
            <Avatar url={issue.reporter_avatar_url} name={reporterName} />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm">
            {issue.is_anonymous && !issue.is_mine ? (
              <span className="font-semibold">{reporterName}</span>
            ) : (
              <Link to={`/u/${issue.reporter_username}`} className="font-semibold hover:underline">{reporterName}</Link>
            )}
            {issue.is_anonymous && issue.is_mine && <span className="text-xs text-muted">(posted anonymously)</span>}
            <span className="text-muted">reported</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <Link to={`/issue/${issue.id}`} className="hover:underline">{timeAgo(issue.created_at)}</Link>
            {issue.address && (
              <>
                <span>·</span>
                <span className="inline-flex min-w-0 items-center gap-0.5">
                  <MapPin className="size-3 shrink-0" />
                  <span className="truncate">{issue.address}</span>
                </span>
              </>
            )}
          </div>
        </div>
        <div className="relative" ref={menuRef}>
          <button aria-label="More options" className="rounded-full p-1.5 text-muted hover:bg-card-hover" onClick={() => setMenu(!menu)}>
            <Ellipsis className="size-5" />
          </button>
          {menu && (
            <div className="card absolute right-0 z-20 mt-1 w-56 overflow-hidden py-1 shadow-lg">
              {canEdit && (
                <MenuItem icon={<Pencil className="size-4" />} onClick={() => { setMenu(false); setDialog('edit') }}>Edit report</MenuItem>
              )}
              {canDelete && (
                <MenuItem icon={<Trash2 className="size-4" />} danger onClick={() => { setMenu(false); deleteIssue(issue, full) }}>
                  Delete report
                </MenuItem>
              )}
              {canFlag && !issue.my_flagged && (
                <MenuItem icon={<Flag className="size-4" />} onClick={() => { setMenu(false); if (requireLogin()) setDialog('flag') }}>
                  Report fake / problem
                </MenuItem>
              )}
              {issue.my_flagged && (
                <MenuItem icon={<Flag className="size-4" />} onClick={() => { setMenu(false); onUnflag() }}>Undo my report</MenuItem>
              )}
              <MenuItem icon={<Share2 className="size-4" />} onClick={() => { setMenu(false); onShare() }}>Share</MenuItem>
            </div>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="space-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <CategoryChip issue={issue} />
          <SeverityBadge severity={issue.severity} />
          <StatusBadge status={issue.status} />
        </div>
        <Link to={`/issue/${issue.id}`} className="block">
          <h2 className={clsx('font-bold leading-snug hover:underline', full ? 'text-xl' : 'text-[17px]')}>{issue.title}</h2>
        </Link>
        {issue.description && (
          <p className={clsx('whitespace-pre-line text-[15px]', !full && 'line-clamp-3')}>{issue.description}</p>
        )}
        {issue.status === 'community_review' && <ValidationMeter issue={issue} minSupporters={minSupporters} />}
        {issue.volunteer_id && ['assigned', 'in_progress', 'resolution_submitted', 'closed'].includes(issue.status) && (
          <div className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-sm">
            <Wrench className="size-4 shrink-0 text-brand" />
            <span className="min-w-0 flex-1">
              <Link to={`/u/${issue.volunteer_username}`} className="font-semibold hover:underline">
                {displayName(issue.volunteer_full_name, issue.volunteer_username)}
              </Link>{' '}
              {issue.status === 'closed' ? 'fixed this' : issue.status === 'resolution_submitted' ? 'submitted a fix' : 'is working on this'}
            </span>
            {['assigned', 'in_progress'].includes(issue.status) && (
              <span className={clsx('inline-flex items-center gap-1 text-xs', lockHours < 24 ? 'text-danger' : 'text-muted')}>
                <Clock className="size-3.5" /> {timeLeft(issue.lock_expires_at)}
              </span>
            )}
          </div>
        )}
      </div>

      <MediaGallery items={issue.media} />

      {/* Counts */}
      <div className="flex items-center justify-between px-4 py-2 text-sm text-muted">
        <span>
          {compact(votes)} upvote{votes === 1 ? '' : 's'}
          {issue.confirmation_count > 0 && ` · ${issue.confirmation_count} confirmed on-site`}
        </span>
        <Link to={`/issue/${issue.id}#discussion`} className="hover:underline">
          {issue.comment_count} comment{issue.comment_count === 1 ? '' : 's'}
        </Link>
      </div>

      {/* Actions */}
      <div className="mx-3 flex border-t border-line py-1">
        <ActionButton
          active={voted}
          activeClass="text-upvote"
          onClick={onVote}
          disabled={issue.is_mine || ['closed', 'expired'].includes(issue.status)}
          title={issue.is_mine ? 'You can\'t upvote your own report' : 'Upvote if this is real'}
          icon={<ArrowBigUp className={clsx('size-5', voted && 'fill-current')} />}
          label="Upvote"
        />
        <ActionButton
          onClick={() => navigate(`/issue/${issue.id}#discussion`)}
          icon={<MessageCircle className="size-5" />}
          label="Comment"
        />
        {canConfirm ? (
          <ActionButton
            onClick={() => requireLogin() && setDialog('confirm')}
            icon={<Camera className="size-5" />}
            label="I see this too"
            title="Confirm on-site with a photo"
          />
        ) : issue.my_confirmed ? (
          <ActionButton active activeClass="text-brand" icon={<Camera className="size-5" />} label="Confirmed" disabled />
        ) : null}
        <ActionButton
          active={following}
          activeClass="text-info"
          onClick={onFollow}
          icon={following ? <BellRing className="size-5" /> : <Bell className="size-5" />}
          label={following ? 'Following' : 'Follow'}
        />
        <ActionButton onClick={onShare} icon={<Share2 className="size-5" />} label="Share" hideLabelOnMobile />
      </div>

      {dialog === 'confirm' && <ConfirmOnSiteDialog issue={issue} open onClose={() => setDialog(null)} />}
      {dialog === 'flag' && <FlagDialog issue={issue} open onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <EditIssueDialog issue={issue} open onClose={() => setDialog(null)} />}
    </article>
  )
}

function ActionButton({ icon, label, onClick, active, activeClass, disabled, title, hideLabelOnMobile }: {
  icon: React.ReactNode; label: string; onClick?: () => void; active?: boolean; activeClass?: string
  disabled?: boolean; title?: string; hideLabelOnMobile?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={clsx(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-sm font-semibold transition-colors',
        'hover:bg-card-hover disabled:cursor-not-allowed disabled:hover:bg-transparent',
        active ? activeClass : 'text-muted',
        disabled && !active && 'opacity-50',
      )}
    >
      {icon}
      <span className={clsx('hidden', hideLabelOnMobile ? 'md:inline' : 'sm:inline')}>{label}</span>
    </button>
  )
}

function MenuItem({ icon, children, onClick, danger }: {
  icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={clsx('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-card-hover', danger && 'text-danger')}
    >
      {icon}
      {children}
    </button>
  )
}
