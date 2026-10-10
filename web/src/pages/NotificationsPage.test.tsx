// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { useNotifications } from '../hooks/useData'
import { renderWithQuery } from '../test/utils'
import { NotificationsPage } from './NotificationsPage'

vi.mock('../lib/api', () => ({ markNotificationsRead: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../hooks/useData', () => ({ useNotifications: vi.fn() }))
const notifications = vi.mocked(useNotifications)

function withState(over: Record<string, unknown>) {
  notifications.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn(), unread: 0, ...over } as never)
}

const renderPage = () => renderWithQuery(<MemoryRouter><NotificationsPage /></MemoryRouter>)

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({ user: { id: 'me' }, loading: false } as unknown as ReturnType<typeof useAuth>)
})

describe('NotificationsPage', () => {
  it('says there are none yet when the list is really empty', () => {
    withState({})
    renderPage()
    expect(screen.getByText('No notifications yet')).toBeInTheDocument()
  })

  it('shows an error with Try again when loading fails, not "No notifications yet"', async () => {
    const refetch = vi.fn()
    withState({ isError: true, error: new Error('Network down'), refetch })
    renderPage()
    expect(screen.getByText('Could not load notifications: Network down')).toBeInTheDocument()
    expect(screen.queryByText('No notifications yet')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })
})
