// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getLeaderboard } from '../lib/api'
import type { LeaderboardRow } from '../lib/types'
import { renderWithQuery } from '../test/utils'
import { LeaderboardPage } from './LeaderboardPage'

vi.mock('../lib/api', () => ({ getLeaderboard: vi.fn() }))
vi.mock('../hooks/useData', () => ({ useAppSettings: () => ({ data: undefined }) }))
const leaderboard = vi.mocked(getLeaderboard)

const row = (over: Partial<LeaderboardRow>) => ({
  id: 'u1', username: 'rahim', full_name: 'Rahim Uddin', avatar_url: null, area_name: 'Mirpur', reputation: 120,
  tasks_completed: 8, avg_rating: 4.5, rating_count: 2, rank: 1, ...over,
}) as LeaderboardRow

const renderPage = () => renderWithQuery(<MemoryRouter><LeaderboardPage /></MemoryRouter>)

beforeEach(() => {
  leaderboard.mockReset()
})

describe('LeaderboardPage', () => {
  it('lists volunteers by rank with their reputation', async () => {
    leaderboard.mockResolvedValue([row({}), row({ id: 'u2', username: 'karim', full_name: 'Karim', rank: 2, reputation: 90 })])
    renderPage()
    expect(await screen.findByText('Rahim Uddin')).toBeInTheDocument()
    expect(screen.getByText('Karim')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Rahim Uddin/ })).toHaveAttribute('href', '/u/rahim')
  })

  it('invites the first volunteer when the list is empty', async () => {
    leaderboard.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No volunteers yet')).toBeInTheDocument()
  })

  it('shows an error with Try again when loading fails, not "No volunteers yet"', async () => {
    leaderboard.mockRejectedValueOnce(new Error('Network down')).mockResolvedValue([row({})])
    renderPage()
    expect(await screen.findByText('Could not load the leaderboard: Network down')).toBeInTheDocument()
    expect(screen.queryByText('No volunteers yet')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Rahim Uddin')).toBeInTheDocument()
  })
})
