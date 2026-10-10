// @vitest-environment jsdom
// Fix and "I see this too" photos: live camera unless the admin turned live evidence off.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { discardPaths, uploadMedia } from '../lib/media'
import type { UploadedMedia } from '../lib/types'
import { renderWithQuery } from '../test/utils'
import { useOnSiteEvidence } from './OnSiteEvidence'

const settings = { current: {} as { live_issue_evidence?: boolean } }
vi.mock('../hooks/useData', () => ({ useAppSettings: () => ({ data: settings.current }) }))
vi.mock('../lib/media', () => ({ uploadMedia: vi.fn(async () => [{ path: 'u/g.jpg', type: 'image' }]), discardPaths: vi.fn(), discardUploads: vi.fn() }))
vi.mock('./LiveCamera', () => ({
  LiveCamera: ({ media, onChange }: { media: UploadedMedia[]; onChange: (m: UploadedMedia[]) => void }) => (
    <button type="button" onClick={() => onChange([...media, { path: 'u/live.jpg', type: 'image', token: 't' }])}>live camera</button>
  ),
}))
vi.mock('./MediaPicker', () => ({
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
    expect(uploadMedia).not.toHaveBeenCalled()
  })

  it('deletes live photos the server refused', async () => {
    settings.current = { live_issue_evidence: true }
    renderWithQuery(<Form />)
    await userEvent.click(screen.getByText('live camera'))
    await userEvent.click(screen.getByText('refused'))
    expect(discardPaths).toHaveBeenCalledWith(['u/live.jpg'])
    expect(screen.getByText('send')).toBeDisabled()
  })

  it('falls back to the gallery when the admin turned live evidence off', async () => {
    settings.current = { live_issue_evidence: false }
    renderWithQuery(<Form />)
    expect(screen.queryByText('live camera')).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('gallery'))
    await userEvent.click(screen.getByText('send'))
    expect(uploadMedia).toHaveBeenCalledWith('me', [expect.any(File)])
    expect(sent).toEqual([{ path: 'u/g.jpg', type: 'image' }])
  })
})
