// @vitest-environment jsdom
// Fix and "I see this too" photos: live camera unless the admin turned live evidence off.
import { renderWithQuery } from '@/test/utils'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadedMedia } from '@/models'
import { useOnSiteEvidence } from '@/features/issues/components/OnSiteEvidence'
import { mediaService } from '@/features/media/services/media.service'

const settings = { current: {} as { live_issue_evidence?: boolean } }
vi.mock('@/shared/settings/useAppSettings', () => ({ useAppSettings: () => ({ data: settings.current }) }))
vi.mock('@/features/media/services/media.service', () => ({ mediaService: { uploadMedia: vi.fn(async () => [{ path: 'u/g.jpg', type: 'image' }]), discardPaths: vi.fn(), discardUploads: vi.fn() } }))
vi.mock('@/features/media/components/LiveCamera', () => ({
  LiveCamera: ({ media, onChange }: { media: UploadedMedia[]; onChange: (m: UploadedMedia[]) => void }) => (
    <button type="button" onClick={() => onChange([...media, { path: 'u/live.jpg', type: 'image', token: 't' }])}>live camera</button>
  ),
}))
vi.mock('@/features/media/components/MediaPicker', () => ({
  MediaPicker: ({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) => (
    <button type="button" onClick={() => onChange([...files, new File(['x'], 'a.jpg', { type: 'image/jpeg' })])}>gallery</button>
  ),
}))

let sent: UploadedMedia[] = []
function Form() {
  const e = useOnSiteEvidence()
  return (
    <div>
      {e.picker}
      <button type="button" disabled={!e.ready} onClick={async () => { sent = await e.upload('me') }}>send</button>
      <button type="button" onClick={() => e.discard()}>refused</button>
      <button type="button" onClick={() => e.reset()}>sent</button>
    </div>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  sent = []
})

describe('on-site evidence', () => {
  it('uses the live camera by default and sends the photo with its code, without uploading again', async () => {
    settings.current = {}
    renderWithQuery(<Form />)
    expect(screen.queryByText('gallery')).not.toBeInTheDocument()
    expect(screen.getByText('send')).toBeDisabled()
    await userEvent.click(screen.getByText('live camera'))
    await userEvent.click(screen.getByText('send'))
    expect(sent).toEqual([{ path: 'u/live.jpg', type: 'image', token: 't' }])
    expect(mediaService.uploadMedia).not.toHaveBeenCalled()
  })

  it('deletes live photos the server refused', async () => {
    settings.current = { live_issue_evidence: true }
    renderWithQuery(<Form />)
    await userEvent.click(screen.getByText('live camera'))
    await userEvent.click(screen.getByText('refused'))
    expect(mediaService.discardPaths).toHaveBeenCalledWith(['u/live.jpg'])
    expect(screen.getByText('send')).toBeDisabled()
  })

  it('falls back to the gallery when the admin turned live evidence off', async () => {
    settings.current = { live_issue_evidence: false }
    renderWithQuery(<Form />)
    expect(screen.queryByText('live camera')).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('gallery'))
    await userEvent.click(screen.getByText('send'))
    expect(mediaService.uploadMedia).toHaveBeenCalledWith('me', [expect.any(File)])
    expect(sent).toEqual([{ path: 'u/g.jpg', type: 'image' }])
  })

  it('deletes live photos that were never sent when the form goes away', async () => {
    settings.current = {}
    const { unmount } = renderWithQuery(<Form />)
    await userEvent.click(screen.getByText('live camera'))
    unmount()
    expect(mediaService.discardPaths).toHaveBeenCalledWith(['u/live.jpg'])
  })

  it('keeps sent photos when the form goes away', async () => {
    settings.current = {}
    const { unmount } = renderWithQuery(<Form />)
    await userEvent.click(screen.getByText('live camera'))
    await userEvent.click(screen.getByText('sent'))
    unmount()
    expect(mediaService.discardPaths).not.toHaveBeenCalled()
  })
})
