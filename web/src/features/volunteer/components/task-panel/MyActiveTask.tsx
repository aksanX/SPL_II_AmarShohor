import clsx from 'clsx'
import { CheckCircle2, Clock, Undo2, Upload } from 'lucide-react'
import { useState } from 'react'
import type { Issue } from '@/models'
import { useToast } from '@/shared/hooks/useToast'
import { hoursLeft } from '@/shared/lib/format'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { Spinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { LocationStatus } from '@/features/issues/components/dialogs/LocationStatus'
import { useOnSiteEvidence } from '@/features/issues/components/OnSiteEvidence'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { useOnSiteLocation } from '@/features/issues/hooks/useOnSiteLocation'
import { dueText } from '@/features/issues/lib/issueLabels'
import { MediaPicker } from '@/features/media/components/MediaPicker'
import { isNetworkError } from '@/features/media/lib/mediaRules'
import { mediaService } from '@/features/media/services/media.service'
import { ReleaseDialog } from '@/features/volunteer/components/task-panel/ReleaseDialog'
import { myLockText } from '@/features/volunteer/lib/volunteer'
import { volunteerService } from '@/features/volunteer/services/volunteer.service'

export function MyActiveTask({ issue }: { issue: Issue }) {
  const { user } = useAuth()
  const settings = useAppSettings().data
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [mode, setMode] = useState<'progress' | 'resolve' | null>(null)
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [releasing, setReleasing] = useState(false)
  const radius = settings?.resolution_radius_m ?? 200
  const loc = useOnSiteLocation(issue)
  const evidence = useOnSiteEvidence()
  const left = hoursLeft(issue.lock_expires_at)
  const isOfficial = issue.assignee_role === 'official'

  async function sendProgress() {
    if (!user) return
    setBusy(true)
    try {
      const media = await mediaService.uploadMedia(user.id, files)
      await volunteerService.postProgress(issue.id, note, media)
      toast.success(isOfficial ? 'Update posted.' : `Update posted. Your lock is extended by ${issue.team_size > 1 ? settings?.team_lock_hours ?? 120 : settings?.lock_hours ?? 72} hours.`)
      setNote(''); setFiles([]); setMode(null)
      invalidate(issue.id)
    } catch (e) {
      if (!isNetworkError(e)) await mediaService.discardUploads(files)
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  async function sendResolution() {
    // Officials don't need to be on site: their crews do the work.
    if (!user || (!isOfficial && !loc.pos)) return
    setBusy(true)
    try {
      // Officials send a normal "after" photo; volunteers' fix photos are live (0053, 0070).
      // Officials' "after" photo is also optional (0070): residents confirm it's gone or still there.
      const media = isOfficial ? (files.length ? await mediaService.uploadMedia(user.id, files) : []) : await evidence.upload(user.id)
      await volunteerService.submitResolution(issue.id, note, loc.pos?.lat ?? null, loc.pos?.lng ?? null, loc.pos?.accuracy ?? null, media)
      toast.success('Fix submitted! The reporter and neighbours will confirm it.')
      setNote(''); setFiles([]); evidence.reset(); setMode(null)
      invalidate(issue.id)
    } catch (e) {
      if (!isNetworkError(e)) await (isOfficial ? mediaService.discardUploads(files) : evidence.discard())
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className={clsx('flex items-center gap-2 rounded-lg p-3 text-sm font-semibold',
        !isOfficial && left < 24 ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand')}>
        <Clock className="size-5" />
        {isOfficial
          ? <>This is your task · {issue.authority_short_name} {dueText(issue.due_at)}</>
          : myLockText(issue.lock_expires_at)}
      </div>

      {mode === null && (
        <div className="grid gap-2 sm:grid-cols-3">
          <button className="btn-soft" onClick={() => setMode('progress')}><Upload className="size-4" /> Post progress</button>
          <button className="btn-primary" onClick={() => setMode('resolve')}><CheckCircle2 className="size-4" /> Submit fix</button>
          <button className="btn-ghost" onClick={() => setReleasing(true)}><Undo2 className="size-4" /> Release</button>
        </div>
      )}

      {mode && (
        <div className="space-y-3 rounded-lg border border-line p-3">
          <h3 className="font-semibold">{mode === 'progress' ? 'Progress update' : 'Submit the fix'}</h3>
          <textarea className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
            aria-label={mode === 'progress' ? 'Progress update' : 'What was fixed'}
            placeholder={mode === 'progress'
              ? isOfficial ? 'e.g. Road team scheduled for Thursday' : 'e.g. Gathered 4 people and gloves, cleaning on Friday'
              : 'What was done? Who fixed it?'} />
          {mode === 'progress' ? <MediaPicker files={files} onChange={setFiles} />
            : isOfficial ? <MediaPicker files={files} onChange={setFiles} imagesOnly /> : evidence.picker}
          {mode === 'resolve' && !isOfficial && <LocationStatus loc={loc} radius={radius} />}
          <div className="flex gap-2">
            <button
              className="btn-primary flex-1"
              disabled={busy || note.trim().length < 3 || (mode === 'resolve' && !isOfficial && (!loc.pos || !evidence.ready))}
              onClick={mode === 'progress' ? sendProgress : sendResolution}
            >
              {busy && <Spinner className="size-4 text-brand-ink" />} {mode === 'progress' ? 'Post update' : 'Submit fix'}
            </button>
            {/* Clear the note and files too; live photos are already uploaded and won't be used. */}
            <button className="btn-ghost" onClick={() => { setMode(null); setNote(''); setFiles([]); evidence.discard() }}>Cancel</button>
          </div>
          {mode === 'resolve' && (
            <p className="text-xs text-muted">
              {isOfficial
                ? `An "after" photo is optional. Residents nearby confirm whether it's gone; if they say it's still there, it comes back to your dashboard.`
                : `Take the "after" photo ${evidence.live ? 'with the in-app camera ' : ''}from the same spot as the original. Fake fixes get disputed and cost ${Math.abs(settings?.rep_task_reopened ?? 15)} reputation.`}
            </p>
          )}
        </div>
      )}

      <ReleaseDialog issue={issue} open={releasing} onClose={() => setReleasing(false)} />
    </div>
  )
}
