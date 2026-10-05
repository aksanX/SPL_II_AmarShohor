import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Megaphone, Send } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { addComment, deleteComment, editComment, flagComment, getComments } from '../lib/api'
import { displayName, timeAgo } from '../lib/format'
import type { Comment, Issue } from '../lib/types'
import { Avatar, PageSpinner, Spinner } from './ui'

export function Comments({ issue }: { issue: Issue }) {
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['comments', issue.id],
    queryFn: () => getComments(issue.id),
  })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['comments', issue.id] })
    qc.invalidateQueries({ queryKey: ['issue', issue.id] })
  }

  const top = comments.filter((c) => !c.parent_id)
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id)

  return (
    <div className="space-y-4">
      {user && profile ? (
        <Composer
          avatar={<Avatar url={profile.avatar_url} name={displayName(profile.full_name, profile.username)} size={36} />}
          allowUpdate
          placeholder="Write a comment…"
          onSubmit={async (body, isUpdate) => {
            await addComment(issue.id, body, null, isUpdate)
            refresh()
          }}
          onError={toast.error}
        />
      ) : (
        <p className="text-sm text-muted"><Link to="/login" className="font-semibold text-brand">Log in</Link> to join the discussion.</p>
      )}

      {isLoading && <PageSpinner />}
      {!isLoading && top.length === 0 && <p className="py-4 text-center text-sm text-muted">No comments yet. Start the conversation.</p>}

      <ul className="space-y-4">
        {top.map((c) => (
          <li key={c.id}>
            <CommentItem comment={c} onChanged={refresh} canReply={Boolean(user)} issueId={issue.id} />
            {repliesOf(c.id).length > 0 && (
              <ul className="ml-11 mt-2 space-y-2 border-l-2 border-line pl-3">
                {repliesOf(c.id).map((r) => (
                  <li key={r.id}>
                    <CommentItem comment={r} onChanged={refresh} canReply={Boolean(user)} issueId={issue.id} replyTo={c.id} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Composer({ avatar, placeholder, onSubmit, onError, allowUpdate, autoFocus }: {
  avatar?: React.ReactNode; placeholder: string; allowUpdate?: boolean; autoFocus?: boolean
  onSubmit: (body: string, isUpdate: boolean) => Promise<void>; onError: (e: unknown) => void
}) {
  const [body, setBody] = useState('')
  const [isUpdate, setIsUpdate] = useState(false)
  const [busy, setBusy] = useState(false)
  async function send() {
    if (!body.trim()) return
    setBusy(true)
    try {
      await onSubmit(body.trim(), isUpdate)
      setBody('')
      setIsUpdate(false)
    } catch (e) {
      onError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex gap-2">
      {avatar}
      <div className="flex-1">
        <div className="flex items-end gap-2 rounded-2xl bg-bg px-3 py-1.5">
          <textarea
            rows={1}
            autoFocus={autoFocus}
            className="max-h-40 flex-1 resize-none bg-transparent py-1 text-sm outline-none"
            placeholder={placeholder}
            value={body}
            maxLength={2000}
            onChange={(e) => {
              setBody(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${e.target.scrollHeight}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
          />
          <button aria-label="Send" className="pb-1 text-brand disabled:text-muted" disabled={busy || !body.trim()} onClick={send}>
            {busy ? <Spinner className="size-5" /> : <Send className="size-5" />}
          </button>
        </div>
        {allowUpdate && (
          <label className="mt-1 flex cursor-pointer items-center gap-1.5 px-2 text-xs text-muted">
            <input type="checkbox" className="accent-[var(--brand)]" checked={isUpdate} onChange={(e) => setIsUpdate(e.target.checked)} />
            Share as an update (notifies everyone following)
          </label>
        )}
      </div>
    </div>
  )
}

function CommentItem({ comment, onChanged, canReply, issueId, replyTo }: {
  comment: Comment; onChanged: () => void; canReply: boolean; issueId: string; replyTo?: string
}) {
  const { user } = useAuth()
  const toast = useToast()
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body ?? '')
  const mine = user?.id === comment.author_id
  const name = displayName(comment.author_full_name, comment.author_username)

  if (comment.is_deleted) return <p className="ml-11 text-sm italic text-muted">Comment deleted.</p>
  if (comment.is_hidden) return <p className="ml-11 text-sm italic text-muted">Hidden after being flagged by several people.</p>

  return (
    <div>
      <div className="flex gap-2">
        <Link to={`/u/${comment.author_username}`}>
          <Avatar url={comment.author_avatar_url} name={name} size={36} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className={clsx('inline-block max-w-full rounded-2xl px-3 py-2', comment.is_update ? 'bg-info-soft' : 'bg-bg')}>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <Link to={`/u/${comment.author_username}`} className="font-semibold hover:underline">{name}</Link>
              {comment.is_reporter && <span className="chip bg-card px-1.5 text-[10px] text-muted">Reporter</span>}
              {comment.is_volunteer && <span className="chip bg-brand-soft px-1.5 text-[10px] text-brand">Volunteer</span>}
              {comment.author_official_of && (
                <span className="chip bg-warn-soft px-1.5 text-[10px] text-warn" title="Verified by an admin">
                  {comment.author_official_of} Official ✓
                </span>
              )}
              {comment.is_update && (
                <span className="chip bg-info px-1.5 text-[10px] text-white"><Megaphone className="size-3" /> Update</span>
              )}
            </div>
            {editing ? (
              <div className="mt-1 space-y-1">
                <textarea className="input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} />
                <div className="flex gap-2">
                  <button className="btn-primary px-2 py-1 text-xs" onClick={async () => {
                    try { await editComment(comment.id, draft); setEditing(false); onChanged() } catch (e) { toast.error(e) }
                  }}>Save</button>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-line break-words text-[15px]">{comment.body}</p>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-3 px-3 text-xs font-semibold text-muted">
            <span className="font-normal">{timeAgo(comment.created_at)}{comment.edited_at && ' · edited'}</span>
            {canReply && <button className="hover:underline" onClick={() => setReplying(!replying)}>Reply</button>}
            {mine && !editing && <button className="hover:underline" onClick={() => setEditing(true)}>Edit</button>}
            {mine && (
              <button className="hover:underline" onClick={async () => {
                if (!window.confirm('Delete this comment?')) return
                try { await deleteComment(comment.id); onChanged() } catch (e) { toast.error(e) }
              }}>Delete</button>
            )}
            {user && !mine && !comment.my_flagged && (
              <button className="hover:underline" onClick={async () => {
                try { await flagComment(comment.id); toast.success('Comment reported'); onChanged() } catch (e) { toast.error(e) }
              }}>Report</button>
            )}
          </div>
        </div>
      </div>
      {replying && (
        <div className="ml-11 mt-2">
          <Composer
            autoFocus
            placeholder={`Reply to ${name}…`}
            onSubmit={async (body) => {
              await addComment(issueId, body, replyTo ?? comment.id, false)
              setReplying(false)
              onChanged()
            }}
            onError={toast.error}
          />
        </div>
      )}
    </div>
  )
}
