import { useState } from 'react'
import type { Issue } from '@/models'
import { useToast } from '@/shared/hooks/useToast'
import { Modal, Spinner } from '@/shared/ui'
import { useCategories } from '@/features/categories/hooks/useCategories'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { issueService } from '@/features/issues/services/issue.service'

export function EditIssueDialog({ issue, open, onClose }: { issue: Issue; open: boolean; onClose: () => void }) {
  const categories = useCategories().data ?? []
  const [title, setTitle] = useState(issue.title)
  const [description, setDescription] = useState(issue.description)
  const [category, setCategory] = useState(issue.category)
  const [address, setAddress] = useState(issue.address)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const invalidate = useInvalidateIssue()

  async function save() {
    setBusy(true)
    try {
      await issueService.updateIssue(issue.id, title, description, category, address)
      toast.success('Report updated')
      invalidate(issue.id)
      onClose()
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit report">
      <div className="space-y-3">
        <p className="text-xs text-muted">You can edit until the community validates the report.</p>
        <div>
          <label className="label" htmlFor="e-title">Title</label>
          <input id="e-title" className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="e-cat">Category</label>
          <select id="e-cat" className="input" value={category ?? ''} onChange={(e) => setCategory(e.target.value || null)}>
            {!category && <option value="">Uncategorised (an admin will choose)</option>}
            {categories.filter((c) => c.is_active || c.slug === category).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="e-desc">Description</label>
          <textarea id="e-desc" className="input" rows={4} maxLength={2000} value={description}
            onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="e-addr">Address / landmark</label>
          <input id="e-addr" className="input" value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <button className="btn-primary w-full" disabled={busy || title.trim().length < 5} onClick={save}>
          {busy && <Spinner className="size-4 text-brand-ink" />} Save changes
        </button>
      </div>
    </Modal>
  )
}
