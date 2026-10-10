// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { useMySettings } from '../hooks/useData'
import { updateMySettings } from '../lib/api'
import { renderWithQuery } from '../test/utils'
import { HomeAreaPrompt } from './HomeAreaPrompt'

vi.mock('../lib/api', () => ({ updateMySettings: vi.fn(async () => undefined) }))
vi.mock('../lib/geo', () => ({ getCurrentPosition: vi.fn(async () => ({ lat: 23.87, lng: 90.39, accuracy: 10 })) }))
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../hooks/useData', () => ({ useMySettings: vi.fn() }))
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

const settings = (home: number | null) =>
  vi.mocked(useMySettings).mockReturnValue({ data: { home_lat: home, home_lng: home, default_anonymous: true, show_on_leaderboard: false } } as never)
const renderPrompt = () => renderWithQuery(<MemoryRouter><HomeAreaPrompt /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.mocked(useAuth).mockReturnValue({ user: { id: 'me' } } as unknown as ReturnType<typeof useAuth>)
})

describe('HomeAreaPrompt', () => {
  it('asks people without a home area to set one', () => {
    settings(null)
    renderPrompt()
    expect(screen.getByText('Set your home area')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pick on map' })).toHaveAttribute('href', '/settings')
  })

  it('is not shown once a home area is set', () => {
    settings(23.8)
    renderPrompt()
    expect(screen.queryByText('Set your home area')).not.toBeInTheDocument()
  })

  it('saves the current position as home, keeping the other settings', async () => {
    settings(null)
    renderPrompt()
    await userEvent.click(screen.getByRole('button', { name: /I'm home now/ }))
    await waitFor(() => expect(updateMySettings).toHaveBeenCalledWith(23.87, 90.39, true, false))
  })

  it('stays hidden after "Not now", even on the next visit', async () => {
    settings(null)
    const { unmount } = renderPrompt()
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByText('Set your home area')).not.toBeInTheDocument()
    unmount()
    renderPrompt()
    expect(screen.queryByText('Set your home area')).not.toBeInTheDocument()
  })
})
