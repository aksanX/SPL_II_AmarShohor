// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { editComment, getComments } from '../lib/api'
import type { Comment } from '../lib/types'
import { issueFixture, renderWithQuery } from '../test/utils'
import { Comments } from './Comments'

vi.mock('../lib/api', () => ({
  addComment: vi.fn(), deleteComment: vi.fn(), editComment: vi.fn(async () => undefined), flagComment: vi.fn(), getComments: vi.fn(),
}))
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))
const comments = vi.mocked(getComments)

const mine = {
  id: 'c1', issue_id: 'iss-1', parent_id: null, author_id: 'me', author_username: 'rahim', author_full_name: 'Rahim',
  author_avatar_url: null, body: 'The drain is still blocked', created_at: new Date().toISOString(), edited_at: null,
  is_deleted: false, is_hidden: false, is_update: false, my_flagged: false,
} as unknown as Comment

const renderComments = () => renderWithQuery(<MemoryRouter><Comments issue={issueFixture()} /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'me' }, profile: { id: 'me', username: 'rahim', full_name: 'Rahim', avatar_url: null },
  } as unknown as ReturnType<typeof useAuth>)
})

describe('Comments', () => {
  it('labels the new comment box', async () => {
    comments.mockResolvedValue([])
    renderComments()
    expect(await screen.findByRole('textbox', { name: 'Write a comment…' })).toBeInTheDocument()
  })

  it('shows a load error with Try again, not "No comments yet"', async () => {
    comments.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue([mine])
    renderComments()
    expect(await screen.findByText('Could not load comments: Network down')).toBeInTheDocument()
    expect(screen.queryByText(/No comments yet/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('The drain is still blocked')).toBeInTheDocument()
  })

  it('saves an edit without stray spaces', async () => {
    comments.mockResolvedValue([mine])
    renderComments()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const box = screen.getByRole('textbox', { name: 'Edit comment' })
    await userEvent.clear(box)
    await userEvent.type(box, '  Cleared now  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(editComment).toHaveBeenCalledWith('c1', 'Cleared now')
  })

  it('forgets an unsaved edit after Cancel', async () => {
    comments.mockResolvedValue([mine])
    renderComments()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Edit comment' }), ' and more')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('textbox', { name: 'Edit comment' })).toHaveValue('The drain is still blocked')
  })
})
