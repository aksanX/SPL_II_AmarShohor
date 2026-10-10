// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getUnusedUploads } from '../lib/api'
import { deleteFiles } from '../lib/media'
import { renderWithQuery } from '../test/utils'
import { UnusedUploads } from './UnusedUploads'

vi.mock('../lib/api', () => ({ getUnusedUploads: vi.fn() }))
vi.mock('../lib/media', () => ({ deleteFiles: vi.fn(async () => undefined) }))
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))
const unused = vi.mocked(getUnusedUploads)
const FILES = [{ path: 'u/a.jpg', size_bytes: 1536 }, { path: 'u/b.mp4', size_bytes: 5_000_000 }] as never

beforeEach(() => {
  vi.clearAllMocks()
})

describe('UnusedUploads', () => {
  it('lists unused files with their total size', async () => {
    unused.mockResolvedValue(FILES)
    renderWithQuery(<UnusedUploads />)
    expect(await screen.findByText('u/a.jpg')).toBeInTheDocument()
    expect(screen.getAllByText('4.8 MB')).toHaveLength(2) // the total, and the video's own size
  })

  it('says when there is nothing to clean up', async () => {
    unused.mockResolvedValue([])
    renderWithQuery(<UnusedUploads />)
    expect(await screen.findByText('Nothing to clean up.')).toBeInTheDocument()
  })

  it('asks before deleting and does nothing when cancelled', async () => {
    unused.mockResolvedValue(FILES)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderWithQuery(<UnusedUploads />)
    await userEvent.click(await screen.findByRole('button', { name: /Delete them/ }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/^Delete 2 unused files/))
    expect(deleteFiles).not.toHaveBeenCalled()
  })

  it('deletes after confirming', async () => {
    unused.mockResolvedValue(FILES)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderWithQuery(<UnusedUploads />)
    await userEvent.click(await screen.findByRole('button', { name: /Delete them/ }))
    await waitFor(() => expect(deleteFiles).toHaveBeenCalledWith(['u/a.jpg', 'u/b.mp4']))
  })

  it('shows a load error that can be retried', async () => {
    unused.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue([])
    renderWithQuery(<UnusedUploads />)
    expect(await screen.findByText('Could not load unused uploads: Network down')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Nothing to clean up.')).toBeInTheDocument()
  })
})
