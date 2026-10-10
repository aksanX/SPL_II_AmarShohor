import { useQuery, useQueryClient } from '@tanstack/react-query'
import { HardDrive, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useToast } from '../hooks/useToast'
import { getUnusedUploads } from '../lib/api'
import { formatBytes } from '../lib/format'
import { deleteFiles } from '../lib/media'
import { Empty, PageSpinner, Spinner } from './ui'

const BATCH = 100

/**
 * Photos and videos that nothing uses: uploaded for a post that was never sent, replaced profile
 * pictures, and so on. They still take up Storage space (1 GB on the free plan). Deleting goes through
 * the Storage API, which removes the actual files; Storage refuses any file that is in use.
 */
export function UnusedUploads() {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const q = useQuery({ queryKey: ['unused-uploads'], queryFn: () => getUnusedUploads(500) })
  if (q.isLoading) return <PageSpinner />
  if (q.error) return <Empty title="Couldn't load unused uploads">{(q.error as Error).message}</Empty>
  const files = q.data ?? []
  const total = files.reduce((s, f) => s + Number(f.size_bytes), 0)

  async function deleteAll() {
    if (!window.confirm(`Delete ${files.length} unused file${files.length === 1 ? '' : 's'} (${formatBytes(total)})? This can't be undone.`)) return
    setBusy(true)
    try {
      for (let i = 0; i < files.length; i += BATCH) {
        await deleteFiles(files.slice(i, i + BATCH).map((f) => f.path))
      }
      toast.success('Unused uploads deleted.')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
      qc.invalidateQueries({ queryKey: ['unused-uploads'] })
    }
  }

  return (
    <section className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2 font-bold"><HardDrive className="size-5 text-brand" /> Unused uploads</h2>
      <p className="text-sm text-muted">
        Files older than a day that no report, emergency or profile uses: posts that were never sent, replaced
        profile pictures. The app deletes most of these itself; this clears what's left.
      </p>
      {files.length === 0 ? (
        <p className="text-sm">Nothing to clean up.</p>
      ) : (
        <>
          <p className="text-sm">
            <strong>{files.length}{files.length >= 500 ? '+' : ''}</strong> file{files.length === 1 ? '' : 's'},{' '}
            <strong>{formatBytes(total)}</strong>
          </p>
          <ul className="max-h-48 overflow-y-auto rounded-lg bg-bg p-2 text-xs text-muted">
            {files.slice(0, 50).map((f) => (
              <li key={f.path} className="flex justify-between gap-2">
                <span className="truncate">{f.path}</span>
                <span className="shrink-0">{formatBytes(Number(f.size_bytes))}</span>
              </li>
            ))}
            {files.length > 50 && <li>…and {files.length - 50} more</li>}
          </ul>
          <button className="btn-danger" disabled={busy} onClick={deleteAll}>
            {busy ? <Spinner className="size-4" /> : <Trash2 className="size-4" />} Delete them
          </button>
        </>
      )}
    </section>
  )
}
