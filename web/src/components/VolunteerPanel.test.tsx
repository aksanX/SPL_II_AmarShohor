// @vitest-environment jsdom
// The "Getting it fixed" panel on an issue: taking a task, your task, someone else's task, teams and rating.
// Database calls, the logged-in user, location and photo picking are replaced with fakes.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { acceptTask, getMyTasks, getTeam, offerLead, rateVolunteer } from '../lib/api'
import type { Issue, Profile } from '../lib/types'
import { issueFixture, renderWithQuery } from '../test/utils'
import { VolunteerPanel } from './VolunteerPanel'

vi.mock('../lib/api', () => ({
  acceptLead: vi.fn(), acceptTask: vi.fn(), checkIn: vi.fn(), getIssueMedia: vi.fn(async () => []), getMyTasks: vi.fn(),
  getTeam: vi.fn(), joinTeam: vi.fn(), leaveTeam: vi.fn(), offerLead: vi.fn(), postProgress: vi.fn(), rateVolunteer: vi.fn(),
  releaseTask: vi.fn(), requestSendBack: vi.fn(), reviewResolution: vi.fn(), setComplaintRef: vi.fn(), submitResolution: vi.fn(),
}))
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../hooks/useData', () => ({ useAppSettings: () => ({ data: { max_active_tasks: 2, team_lead_min_tasks: 3, lock_hours: 72 } }) }))
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }))
vi.mock('../lib/supabase', () => ({ mediaUrl: (path: string) => `/media/${path}` }))
vi.mock('./IssueDialogs', () => ({
  useInvalidateIssue: () => vi.fn(),
  useOnSiteLocation: () => ({ pos: null, distance: null, locating: false, error: null, locate: vi.fn() }),
  LocationStatus: () => <p>location</p>,
}))
// A tiny stand-in: one button adds a video, so tests can check what happens to picked files.
vi.mock('./MediaPicker', () => ({
  MediaPicker: ({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) => (
    <div>
      <span>{files.length} files</span>
      <button type="button" onClick={() => onChange([...files, new File(['x'], 'clip.mp4', { type: 'video/mp4' })])}>Add video</button>
    </div>
  ),
}))

const myTasks = vi.mocked(getMyTasks)

function signedIn(over: Partial<Profile> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'me' }, role: 'citizen', isAdmin: false,
    profile: { id: 'me', is_volunteer: true, tasks_completed: 0, reputation: 5, ...over } as Profile,
  } as unknown as ReturnType<typeof useAuth>)
}

const renderPanel = (issue: Issue) => renderWithQuery(<MemoryRouter><VolunteerPanel issue={issue} /></MemoryRouter>)
const ledTask = (id: string) => issueFixture({ id, status: 'assigned', volunteer_id: 'me' })

beforeEach(() => {
  vi.clearAllMocks()
  signedIn()
  myTasks.mockResolvedValue([])
  vi.mocked(acceptTask).mockResolvedValue(undefined)
  vi.mocked(getTeam).mockResolvedValue([])
})

describe('taking a task', () => {
  it('accepts a validated task', async () => {
    renderPanel(issueFixture())
    await userEvent.click(await screen.findByRole('button', { name: /Accept this task/ }))
    expect(acceptTask).toHaveBeenCalledWith('iss-1', 1)
  })

  it('stops before the click when you already lead the most tasks allowed', async () => {
    myTasks.mockResolvedValue([ledTask('a'), { ...ledTask('b'), status: 'resolution_submitted' } as Issue])
    renderPanel(issueFixture())
    expect(await screen.findByText(/You already lead 2 tasks, the most allowed at once/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Accept this task/ })).toBeDisabled()
  })

  it('does not count teams you only joined, or closed tasks', async () => {
    myTasks.mockResolvedValue([{ ...ledTask('a'), volunteer_id: 'someone' } as Issue, { ...ledTask('b'), status: 'closed' } as Issue, ledTask('c')])
    renderPanel(issueFixture())
    await waitFor(() => expect(myTasks).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: /Accept this task/ })).toBeEnabled()
    expect(screen.queryByText(/You already lead/)).not.toBeInTheDocument()
  })

  it('says how many completed tasks leading a team needs, with the right plural', () => {
    renderPanel(issueFixture())
    expect(screen.getByText(/Leading a team needs 3 completed tasks and positive reputation/)).toBeInTheDocument()
  })
})

describe('a task someone holds', () => {
  const held = (minutesLeft: number) => issueFixture({
    status: 'assigned', volunteer_id: 'karim', volunteer_username: 'karim', volunteer_full_name: 'Karim',
    assigned_at: '2026-10-08T00:00:00Z', lock_expires_at: new Date(Date.now() + minutesLeft * 60_000).toISOString(),
  })

  it('never shows "runs out in expired"', () => {
    renderPanel(held(-30))
    expect(screen.getByText(/Their lock has run out, so the task goes back to the pool soon/)).toBeInTheDocument()
    expect(screen.queryByText(/runs out in expired/)).not.toBeInTheDocument()
  })

  it('says how long is left while it runs', () => {
    renderPanel(held(5 * 60))
    expect(screen.getByText(/Their lock runs out in 5 hours unless they post progress/)).toBeInTheDocument()
  })
})

describe('my own task', () => {
  const mineIssue = (minutesLeft: number) =>
    issueFixture({ status: 'in_progress', volunteer_id: 'me', lock_expires_at: new Date(Date.now() + minutesLeft * 60_000).toISOString() })

  it('says plainly when my lock has run out', () => {
    renderPanel(mineIssue(-10))
    expect(screen.getByText('Your lock has run out. Post progress now to keep this task.')).toBeInTheDocument()
  })

  it('Cancel forgets the note and files, so a video from an update never reaches a fix', async () => {
    renderPanel(mineIssue(600))
    await userEvent.click(screen.getByRole('button', { name: /Post progress/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Progress update' }), 'Gathered gloves')
    await userEvent.click(screen.getByRole('button', { name: 'Add video' }))
    expect(screen.getByText('1 files')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: /Submit fix/ }))
    expect(screen.getByText('0 files')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'What was fixed' })).toHaveValue('')
  })

  it('limits the note to 1000 characters', async () => {
    renderPanel(mineIssue(600))
    await userEvent.click(screen.getByRole('button', { name: /Post progress/ }))
    expect(screen.getByRole('textbox', { name: 'Progress update' })).toHaveAttribute('maxLength', '1000')
  })
})

describe('team leader', () => {
  it('asks before handing the team over', async () => {
    vi.mocked(getTeam).mockResolvedValue([
      { user_id: 'me', username: 'me', full_name: 'Me', avatar_url: null, is_leader: true, checked_in_at: null, joined_at: '2026-10-01T00:00:00Z' },
      { user_id: 'u2', username: 'nadia', full_name: 'Nadia', avatar_url: null, is_leader: false, checked_in_at: null, joined_at: '2026-10-02T00:00:00Z' },
    ] as never)
    vi.mocked(offerLead).mockResolvedValue(undefined)
    renderPanel(issueFixture({ status: 'assigned', volunteer_id: 'me', team_size: 3, team_count: 1, lock_expires_at: new Date(Date.now() + 3_600_000).toISOString() }))
    await userEvent.click(await screen.findByRole('button', { name: 'Hand over' }))
    expect(offerLead).not.toHaveBeenCalled()
    expect(screen.getByText('Make them leader?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(offerLead).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Hand over' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(offerLead).toHaveBeenCalledWith('iss-1', 'u2')
  })
})

describe('rating the volunteer', () => {
  const closed = issueFixture({ status: 'closed', is_mine: true, is_rated: false, volunteer_id: 'karim', volunteer_username: 'karim', closed_at: '2026-10-09T00:00:00Z' } as Partial<Issue>)

  it('reads the stars correctly and marks the chosen one', async () => {
    renderPanel(closed)
    expect(screen.getByRole('radio', { name: '1 star' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: '4 stars' }))
    expect(screen.getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: '5 stars' })).toHaveAttribute('aria-checked', 'false')
  })

  it('sends the rating with the review', async () => {
    vi.mocked(rateVolunteer).mockResolvedValue(undefined)
    renderPanel(closed)
    expect(screen.getByRole('button', { name: 'Submit rating' })).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: '5 stars' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Review (optional)' }), 'Quick work')
    await userEvent.click(screen.getByRole('button', { name: 'Submit rating' }))
    expect(rateVolunteer).toHaveBeenCalledWith('iss-1', 5, 'Quick work')
  })
})
