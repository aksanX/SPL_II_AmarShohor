// @vitest-environment jsdom
// The "Getting it fixed" panel on an issue: taking a task, your task, someone else's task, teams and rating.
// Database calls, the logged-in user, location and photo picking are replaced with fakes.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { acceptTask, askForVolunteers, closeTeamRecruiting, getMyTasks, getTeam, offerLead, rateVolunteer, removeTeamMember, submitResolution } from '../lib/api'
import type { Issue, Profile, UploadedMedia } from '../lib/types'
import { uploadMedia } from '../lib/media'
import { issueFixture, renderWithQuery } from '../test/utils'
import { VolunteerPanel } from './VolunteerPanel'

vi.mock('../lib/api', () => ({
  acceptLead: vi.fn(), acceptTask: vi.fn(), checkIn: vi.fn(), getIssueMedia: vi.fn(async () => []), getMyTasks: vi.fn(),
  getTeam: vi.fn(), joinTeam: vi.fn(), leaveTeam: vi.fn(), offerLead: vi.fn(), postProgress: vi.fn(), rateVolunteer: vi.fn(),
  askForVolunteers: vi.fn(), closeTeamRecruiting: vi.fn(), releaseTask: vi.fn(), removeTeamMember: vi.fn(), reviewResolution: vi.fn(), submitResolution: vi.fn(),
}))
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../hooks/useData', () => ({ useAppSettings: () => ({ data: { max_active_tasks: 2, team_lead_min_tasks: 3, lock_hours: 72 } }) }))
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }))
vi.mock('../lib/supabase', () => ({ mediaUrl: (path: string) => `/media/${path}` }))
const here = { current: null as null | { lat: number; lng: number; accuracy: number } }
vi.mock('./IssueDialogs', () => ({
  useInvalidateIssue: () => vi.fn(),
  useOnSiteLocation: () => ({ pos: here.current, distance: here.current ? 5 : null, locating: false, error: null, locate: vi.fn() }),
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

// Normal (gallery) uploads, used by City Corporation officials' fixes.
vi.mock('../lib/media', async (original) => ({
  ...(await original<typeof import('../lib/media')>()),
  uploadMedia: vi.fn(async () => [{ path: 'u/office.jpg', type: 'image' }]),
}))
// The in-app camera: one button "takes" a live photo with its one-time code.
vi.mock('./LiveCamera', () => ({
  LiveCamera: ({ media, onChange }: { media: UploadedMedia[]; onChange: (m: UploadedMedia[]) => void }) => (
    <div>
      <span>{media.length} live</span>
      <button type="button" onClick={() => onChange([...media, { path: 'u/after.jpg', type: 'image', token: 'tok-1' }])}>Take live photo</button>
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
  here.current = null
  signedIn()
  myTasks.mockResolvedValue([])
  vi.mocked(acceptTask).mockResolvedValue(undefined)
  vi.mocked(getTeam).mockResolvedValue([])
})

describe('taking a task', () => {
  it('accepts a validated task', async () => {
    renderPanel(issueFixture())
    await userEvent.click(await screen.findByRole('button', { name: /Accept this task/ }))
    expect(acceptTask).toHaveBeenCalledWith('iss-1')
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

  it('has no team size to pick; it says help can be asked for after accepting', () => {
    renderPanel(issueFixture())
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText(/After accepting, tap "Ask for more volunteers"/)).toBeInTheDocument()
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

  it('Cancel forgets the note and files, and a fix takes its photo with the live camera, not the gallery', async () => {
    renderPanel(mineIssue(600))
    await userEvent.click(screen.getByRole('button', { name: /Post progress/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Progress update' }), 'Gathered gloves')
    await userEvent.click(screen.getByRole('button', { name: 'Add video' }))
    expect(screen.getByText('1 files')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: /Submit fix/ }))
    expect(screen.getByText('0 live')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add video' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'What was fixed' })).toHaveValue('')
  })

  it('sends the fix with the live photo and its one-time code', async () => {
    here.current = { lat: 23.8, lng: 90.4, accuracy: 8 }
    vi.mocked(submitResolution).mockResolvedValue(undefined)
    renderPanel(mineIssue(600))
    await userEvent.click(screen.getByRole('button', { name: /Submit fix/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'What was fixed' }), 'Filled the hole')
    const send = screen.getAllByRole('button', { name: /Submit fix/ }).at(-1)!
    expect(send).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Take live photo' }))
    await userEvent.click(send)
    expect(submitResolution).toHaveBeenCalledWith('iss-1', 'Filled the hole', 23.8, 90.4, 8,
      [{ path: 'u/after.jpg', type: 'image', token: 'tok-1' }])
  })

  const officialTask = () => issueFixture({
    status: 'in_progress', route: 'authority', volunteer_id: 'me', assignee_role: 'official', authority_id: 'a1',
    authority_short_name: 'DNCC', lock_expires_at: null,
  } as Partial<Issue>)

  it("an official's fix uses a normal photo and no location, not the live camera", async () => {
    here.current = null  // in the office
    vi.mocked(submitResolution).mockResolvedValue(undefined)
    renderPanel(officialTask())
    await userEvent.click(screen.getByRole('button', { name: /Submit fix/ }))
    expect(screen.queryByRole('button', { name: 'Take live photo' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'What was fixed' }), 'Crew repaired it')
    await userEvent.click(screen.getByRole('button', { name: 'Add video' }))  // the normal picker (stand-in)
    await userEvent.click(screen.getAllByRole('button', { name: /Submit fix/ }).at(-1)!)
    expect(uploadMedia).toHaveBeenCalled()
    expect(submitResolution).toHaveBeenCalledWith('iss-1', 'Crew repaired it', null, null, null, [{ path: 'u/office.jpg', type: 'image' }])
  })

  it("an official's photo is optional: a note is enough", async () => {
    here.current = null
    vi.mocked(uploadMedia).mockClear()
    vi.mocked(submitResolution).mockResolvedValue(undefined)
    renderPanel(officialTask())
    await userEvent.click(screen.getByRole('button', { name: /Submit fix/ }))
    expect(screen.getByText(/An "after" photo is optional/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'What was fixed' }), 'Crew repaired it')
    await userEvent.click(screen.getAllByRole('button', { name: /Submit fix/ }).at(-1)!)
    expect(uploadMedia).not.toHaveBeenCalled()
    expect(submitResolution).toHaveBeenCalledWith('iss-1', 'Crew repaired it', null, null, null, [])
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

  it('can remove a member who never came, after asking; not one who checked in', async () => {
    vi.mocked(getTeam).mockResolvedValue([
      { user_id: 'me', username: 'me', full_name: 'Me', avatar_url: null, is_leader: true, checked_in_at: null, joined_at: '2026-10-01T00:00:00Z' },
      { user_id: 'u2', username: 'nadia', full_name: 'Nadia', avatar_url: null, is_leader: false, checked_in_at: null, joined_at: '2026-10-02T00:00:00Z' },
      { user_id: 'u3', username: 'rafi', full_name: 'Rafi', avatar_url: null, is_leader: false, checked_in_at: '2026-10-03T00:00:00Z', joined_at: '2026-10-02T00:00:00Z' },
    ] as never)
    vi.mocked(removeTeamMember).mockResolvedValue(undefined)
    renderPanel(issueFixture({ status: 'assigned', volunteer_id: 'me', team_size: 3, team_count: 2, lock_expires_at: new Date(Date.now() + 3_600_000).toISOString() }))
    // only Nadia (not checked in) can be removed
    const remove = await screen.findAllByRole('button', { name: 'Remove' })
    expect(remove).toHaveLength(1)
    await userEvent.click(remove[0])
    expect(screen.getByText('Remove from the team?')).toBeInTheDocument()
    expect(removeTeamMember).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(removeTeamMember).toHaveBeenCalledWith('iss-1', 'u2')
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

describe('asking for more volunteers on your own task', () => {
  const myTask = (over: Partial<Issue> = {}) =>
    issueFixture({ status: 'assigned', volunteer_id: 'me', assignee_role: 'volunteer', team_size: 1, team_count: 0, ...over })

  it('asks nearby volunteers with one tap, even on a first task', async () => {
    signedIn({ tasks_completed: 0 })
    vi.mocked(askForVolunteers).mockResolvedValue(4)
    renderPanel(myTask())
    await userEvent.click(screen.getByRole('button', { name: /Too big alone\? Ask for more volunteers/ }))
    expect(askForVolunteers).toHaveBeenCalledWith('iss-1')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Asked 4 nearby volunteers to join your team.'))
  })

  it('says so when nobody lives nearby', async () => {
    vi.mocked(askForVolunteers).mockResolvedValue(0)
    renderPanel(myTask())
    await userEvent.click(screen.getByRole('button', { name: /Ask for more volunteers/ }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/no volunteer lives nearby yet/)))
  })

  it('while the team is open, offers "We have enough people" instead', async () => {
    vi.mocked(closeTeamRecruiting).mockResolvedValue(undefined)
    renderPanel(myTask({ team_size: 10, team_count: 2 }))
    expect(screen.getByText(/3 of up to 10 so far/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ask for more volunteers/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /We have enough people/ }))
    expect(closeTeamRecruiting).toHaveBeenCalledWith('iss-1')
  })

  it("is not offered on someone else's task", () => {
    renderPanel(myTask({ volunteer_id: 'someone' }))
    expect(screen.queryByRole('button', { name: /Ask for more volunteers/ })).not.toBeInTheDocument()
  })
})
