import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { deleteMyAccount } from '../lib/api'
import { discardPaths } from '../lib/media'
import { pathFromMediaUrl } from '../lib/supabase'
import { Modal, Spinner } from './ui'

/** Settings → "Delete my account": personal details go, reports stay without a name. */
export function DeleteAccount() {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  if (!profile) return null

  async function remove() {
    if (!profile) return
    setBusy(true)
    try {
      await deleteMyAccount(typed.trim())
      // The profile no longer uses the picture, so Storage lets its owner delete it.
      const avatar = pathFromMediaUrl(profile.avatar_url)
      if (avatar) await discardPaths([avatar])
      await signOut().catch(() => undefined)
      toast.success('Your account was deleted.')
      navigate('/', { replace: true })
    } catch (e) {
      toast.error(e)
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-3 border border-danger/30 p-4">
      <h2 className="text-lg font-bold text-danger">Delete my account</h2>
      <p className="text-sm text-muted">
        Removes your email, name, picture, bio, home location and notifications, and closes your login. Your reports,
        photos, comments and votes stay so the problems aren't lost, but without your name.
      </p>
      <button className="btn-danger" onClick={() => setOpen(true)}><Trash2 className="size-4" /> Delete my account</button>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Delete your account?">
        <div className="space-y-3 text-sm">
          <p>This can't be undone. You won't be able to log in again; you can sign up later as a new person.</p>
          <p className="text-muted">If you are working on a task, finish it or release it first.</p>
          <label className="block">
            <span className="label">Type your username <strong>{profile.username}</strong> to confirm</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
          <button className="btn-danger w-full" disabled={busy || typed.trim() !== profile.username} onClick={remove}>
            {busy ? <Spinner className="size-4" /> : <Trash2 className="size-4" />} Delete my account for good
          </button>
        </div>
      </Modal>
    </section>
  )
}
