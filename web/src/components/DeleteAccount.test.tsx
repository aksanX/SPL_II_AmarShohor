// @vitest-environment jsdom
// Settings → "Delete my account": typed confirmation, then the account is emptied and the person logged out.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { deleteMyAccount } from '../lib/api'
import { discardPaths } from '../lib/media'
import { renderWithQuery } from '../test/utils'
import { DeleteAccount } from './DeleteAccount'

vi.mock('../lib/api', () => ({ deleteMyAccount: vi.fn() }))
vi.mock('../lib/media', () => ({ discardPaths: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }))
const signOut = vi.fn(async () => undefined)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useAuth).mockReturnValue({
    signOut,
    profile: { username: 'rahim', avatar_url: 'https://x.supabase.co/storage/v1/object/public/media/u/abc.jpg' },
  } as unknown as ReturnType<typeof useAuth>)
})

const renderIt = () => renderWithQuery(<MemoryRouter><DeleteAccount /></MemoryRouter>)

describe('Delete my account', () => {
  it('needs the username typed before it deletes anything', async () => {
    renderIt()
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }))
    const confirm = screen.getByRole('button', { name: /for good/ })
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox'), 'rahi')
    expect(confirm).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox'), 'm')
    expect(confirm).toBeEnabled()
  })

  it('deletes, removes the profile picture and logs out', async () => {
    vi.mocked(deleteMyAccount).mockResolvedValue(undefined)
    renderIt()
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }))
    await userEvent.type(screen.getByRole('textbox'), 'rahim')
    await userEvent.click(screen.getByRole('button', { name: /for good/ }))
    expect(deleteMyAccount).toHaveBeenCalledWith('rahim')
    expect(discardPaths).toHaveBeenCalledWith(['u/abc.jpg'])
    expect(signOut).toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalled()
  })

  it('stays logged in and explains when the server refuses (e.g. an active task)', async () => {
    const refusal = new Error('You are working on a task. Finish it, release it or leave the team first.')
    vi.mocked(deleteMyAccount).mockRejectedValue(refusal)
    renderIt()
    await userEvent.click(screen.getByRole('button', { name: /Delete my account/ }))
    await userEvent.type(screen.getByRole('textbox'), 'rahim')
    await userEvent.click(screen.getByRole('button', { name: /for good/ }))
    expect(toast.error).toHaveBeenCalledWith(refusal)
    expect(signOut).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /for good/ })).toBeEnabled()
  })
})
