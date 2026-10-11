import clsx from 'clsx'
import { useState } from 'react'
import type { Issue, ReleaseKind, WrongType } from '@/models'
import { useToast } from '@/shared/hooks/useToast'
import { Modal, Spinner } from '@/shared/ui'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { MediaPicker } from '@/features/media/components/MediaPicker'
import { isNetworkError } from '@/features/media/lib/mediaRules'
import { mediaService } from '@/features/media/services/media.service'
import { volunteerService } from '@/features/volunteer/services/volunteer.service'

const RELEASE_OPTIONS: { kind: ReleaseKind; title: string; help: string }[] = [
  { kind: 'busy', title: 'I can\'t do it right now', help: 'Back to the pool (or to your team). No penalty.' },
  { kind: 'needs_authority', title: 'This needs the City Corporation', help: 'Too big, dangerous or needs machinery. An admin decides. No reward, no penalty.' },
  { kind: 'wrong_issue', title: 'This report is wrong', help: 'Already fixed, fake, or at the wrong place. An admin checks.' },
]

const OFFICIAL_RELEASE_OPTIONS: { kind: ReleaseKind; title: string; help: string }[] = [
  { kind: 'busy', title: 'We\'re busy right now', help: 'Back to your City Corporation for another official. The target date keeps running.' },
  { kind: 'send_back', title: 'Volunteers can handle this', help: 'Small enough for local volunteers. Your area admin decides: approved goes to volunteers, rejected comes back to you.' },
  { kind: 'wrong_issue', title: 'This report is wrong', help: 'Already fixed, fake, or at the wrong place. An admin checks.' },
]

export function ReleaseDialog({ issue, open, onClose }: { issue: Issue; open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const [kind, setKind] = useState<ReleaseKind>('busy')
  const [wrongType, setWrongType] = useState<WrongType>('already_fixed')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const needsEvidence = kind !== 'busy'
  // Officials don't have to be on site to say volunteers can handle it, so the photo is optional.
  const needsPhoto = needsEvidence && kind !== 'send_back'
  const options = issue.assignee_role === 'official' ? OFFICIAL_RELEASE_OPTIONS : RELEASE_OPTIONS

  async function submit() {
    if (!user) return
    setBusy(true)
    try {
      const media = needsEvidence ? await mediaService.uploadMedia(user.id, files) : []
      await volunteerService.releaseTask(issue.id, note, kind, media, kind === 'wrong_issue' ? wrongType : null)
      toast.success(kind === 'busy' ? 'Task released. No penalty — thanks for being honest.'
        : kind === 'send_back' ? 'Sent to your area admin. Approved goes to volunteers; rejected comes back to you.'
        : 'Sent to an admin. Thanks for checking on site.')
      invalidate(issue.id)
      onClose()
    } catch (e) {
      if (needsEvidence && !isNetworkError(e)) await mediaService.discardUploads(files)
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Release this task">
      <div className="space-y-4">
        <div className="space-y-2" role="radiogroup" aria-label="Reason">
          {options.map((o) => (
            <label key={o.kind} className={clsx('flex cursor-pointer gap-3 rounded-lg border p-3',
              kind === o.kind ? 'border-brand bg-brand-soft' : 'border-line hover:bg-card-hover')}>
              <input type="radio" name="release-kind" className="mt-1 accent-[var(--brand)]" checked={kind === o.kind}
                onChange={() => setKind(o.kind)} />
              <span>
                <span className="block text-sm font-semibold">{o.title}</span>
                <span className="block text-xs text-muted">{o.help}</span>
              </span>
            </label>
          ))}
        </div>
        {kind === 'wrong_issue' && (
          <div>
            <label className="label" htmlFor="wrong-type">What's wrong with it?</label>
            <select id="wrong-type" className="input" value={wrongType} onChange={(e) => setWrongType(e.target.value as WrongType)}>
              <option value="already_fixed">It's already fixed</option>
              <option value="fake">It's fake / doesn't exist</option>
              <option value="wrong_location">It's at a different place</option>
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor="release-note">
            {kind === 'send_back' ? 'Why can volunteers handle it? (required)' : needsEvidence ? 'What did you find? (required)' : 'Why? (optional)'}
          </label>
          <textarea id="release-note" className="input" rows={3} maxLength={1000} value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={kind === 'needs_authority' ? 'e.g. About 5 tonnes of debris, needs a truck'
              : kind === 'send_back' ? 'e.g. Only a few bags of litter, a local cleanup is enough'
              : kind === 'wrong_issue' ? 'e.g. The drain was cleared yesterday' : ''} />
        </div>
        {needsEvidence && (
          <div>
            <span className="label">{needsPhoto ? 'Photo from the site (required)' : 'Photo (optional)'}</span>
            <MediaPicker files={files} onChange={setFiles} required={needsPhoto} imagesOnly />
          </div>
        )}
        <button className="btn-primary w-full"
          disabled={busy || (needsEvidence && note.trim().length < 10) || (needsPhoto && files.length === 0)} onClick={submit}>
          {busy && <Spinner className="size-4 text-brand-ink" />}
          {kind === 'busy' ? 'Release' : 'Send to an admin'}
        </button>
      </div>
    </Modal>
  )
}
