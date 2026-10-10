// @vitest-environment jsdom
// The volunteer dashboard with fake data: turning volunteer mode on and off, task lists, errors and filters.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { useCategories } from '../hooks/useData'
import { getMyTasks, getOpenTasks, getOpenTeams, setVolunteerMode } from '../lib/api'
import type { Category, Issue, Profile } from '../lib/types'
import { category, issueFixture, renderWithQuery } from '../test/utils'
import { VolunteerPage } from './VolunteerPage'

vi.mock('../lib/api', () => ({ getMyTasks: vi.fn(), getOpenTasks: vi.fn(), getOpenTeams: vi.fn(), setVolunteerMode: vi.fn() }))
vi.mock('../lib/supabase', () => ({ mediaUrl: (path: string) => `/media/${path}` }))
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../hooks/useData', () => ({
  useAppSettings: () => ({ data: undefined }), useCategories: vi.fn(() => ({ data: [] })), useMySettings: () => ({ data: undefined }),
}))
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }))

const api = {
  mine: vi.mocked(getMyTasks), open: vi.mocked(getOpenTasks), teams: vi.mocked(getOpenTeams), mode: vi.mocked(setVolunteerMode),
}
const refreshProfile = vi.fn(async () => {})

function signedIn(isVolunteer: boolean) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'me' }, role: 'citizen', loading: false, refreshProfile,
    profile: { id: 'me', is_volunteer: isVolunteer, reputation: 40, tasks_completed: 3, rating_sum: 9, rating_count: 2 } as Profile,
  } as unknown as ReturnType<typeof useAuth>)
}

function renderPage() {
  return renderWithQuery(<MemoryRouter><VolunteerPage /></MemoryRouter>)
}

const mine = (over: Partial<Issue>) => issueFixture({ id: 'm1', title: 'My drain task', status: 'assigned', volunteer_id: 'me', ...over })

beforeEach(() => {
  vi.clearAllMocks()
  signedIn(true)
  api.mine.mockResolvedValue([])
  api.open.mockResolvedValue([issueFixture({ id: 'o1', title: 'Open litter task' })])
  api.teams.mockResolvedValue([])
  api.mode.mockResolvedValue(undefined)
})

describe('becoming a volunteer', () => {
  it('turns volunteer mode on', async () => {
    signedIn(false)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /Turn on volunteer mode/ }))
    expect(api.mode).toHaveBeenCalledWith(true)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Welcome, volunteer! Pick a task near you.'))
  })
})

describe('turning volunteer mode off', () => {
  it('asks first, and does nothing when you keep it on', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off volunteer mode' }))
    expect(screen.getByText(/Turn off volunteer mode\? You stop getting task alerts/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep it on' }))
    expect(api.mode).not.toHaveBeenCalled()
  })

  it('turns it off after confirming', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off volunteer mode' }))
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(api.mode).toHaveBeenCalledWith(false)
  })

  it('explains it cannot be turned off while you still hold a task, instead of failing', async () => {
    api.mine.mockResolvedValue([mine({}), mine({ id: 'm2', status: 'resolution_submitted' })])
    renderPage()
    expect(await screen.findAllByText('My drain task')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Turn off volunteer mode' }))
    expect(screen.getByRole('status')).toHaveTextContent('Finish, release or leave your 2 tasks first')
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument()
    expect(api.mode).not.toHaveBeenCalled()
  })
})

describe('task lists', () => {
  it('shows my tasks and the open ones', async () => {
    api.mine.mockResolvedValue([mine({})])
    renderPage()
    expect(await screen.findByText('My drain task')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My tasks (1)' })).toBeInTheDocument()
    expect(await screen.findByText('Open litter task')).toBeInTheDocument()
  })

  it('says plainly when my lock has run out, instead of "expired — post an update"', async () => {
    api.mine.mockResolvedValue([mine({ lock_expires_at: new Date(Date.now() - 3_600_000).toISOString() })])
    renderPage()
    expect(await screen.findByText('Lock ran out. Post progress now to keep it')).toBeInTheDocument()
  })

  it('shows an error with Try again when tasks cannot load, not "No open tasks"', async () => {
    api.open.mockRejectedValueOnce(new Error('Network down'))
    renderPage()
    expect(await screen.findByText('Could not load tasks: Network down')).toBeInTheDocument()
    expect(screen.queryByText('No open tasks here')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Open litter task')).toBeInTheDocument()
  })

  it('does not suggest a bigger radius while the radius cannot be changed', async () => {
    api.open.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No open tasks here')).toBeInTheDocument()
    expect(screen.getByText(/use your location to see tasks near you/)).toBeInTheDocument()
    expect(screen.queryByText(/bigger radius/)).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Radius' })).toBeDisabled()
  })

  it('applies the category filter to teams too', async () => {
    vi.mocked(useCategories).mockReturnValue({ data: [category('drain', 'Drainage', null), category('garbage', 'Garbage', null)] } as unknown as { data: Category[] } as never)
    api.teams.mockResolvedValue([
      issueFixture({ id: 't1', title: 'Drain team', category: 'drain', team_size: 4 }),
      issueFixture({ id: 't2', title: 'Garbage team', category: 'garbage', team_size: 4 }),
    ])
    renderPage()
    expect(await screen.findByText('Drain team')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'garbage')
    await waitFor(() => expect(screen.queryByText('Drain team')).not.toBeInTheDocument())
    expect(screen.getByText('Garbage team')).toBeInTheDocument()
    expect(api.open).toHaveBeenLastCalledWith(null, null, 10_000, 'garbage')
  })
})
