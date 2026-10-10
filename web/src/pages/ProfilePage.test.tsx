// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { getFeed, getProfileByUsername, getRatingsFor, getRolesOf, getUserIssues } from '../lib/api'
import type { Issue, Profile, Rating, UserRole } from '../lib/types'
import { renderWithQuery } from '../test/utils'
import { ProfilePage } from './ProfilePage'

vi.mock('../lib/api', () => ({
  getProfileByUsername: vi.fn(), getUserIssues: vi.fn(), getRatingsFor: vi.fn(), getRolesOf: vi.fn(), getFeed: vi.fn(),
}))
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }))
// The real card has its own voting and comments; here it only needs to show which issues were listed.
vi.mock('../components/IssueCard', () => ({ IssueCard: ({ issue }: { issue: Issue }) => <article>{issue.title}</article> }))

const PROFILE: Profile = {
  id: 'u1', username: 'rahim_mirpur', full_name: 'Rahim Uddin', avatar_url: null, bio: 'I fix drains on weekends.',
  area_name: 'Mirpur 10', is_volunteer: true, volunteer_since: '2026-09-01T00:00:00Z', reputation: 120,
  tasks_completed: 5, tasks_expired: 0, tasks_reopened: 0, rating_sum: 9, rating_count: 2, reports_count: 8,
  created_at: '2026-09-01T00:00:00Z',
}
const report = (id: string, title = `Report ${id}`) => ({ id, title }) as Issue
const RATING: Rating = {
  id: 1, issue_id: 'iss-1', issue_title: 'Blocked drain on Road 3', volunteer_id: 'u1', stars: 4,
  review: 'Quick and tidy work', created_at: '2026-10-05T00:00:00Z', rater_id: null, rater_username: null,
}

const auth = vi.mocked(useAuth)
const api = {
  profile: vi.mocked(getProfileByUsername), issues: vi.mocked(getUserIssues), ratings: vi.mocked(getRatingsFor),
  roles: vi.mocked(getRolesOf), feed: vi.mocked(getFeed),
}

function signedInAs(id: string | null) {
  auth.mockReturnValue({ user: id ? { id } : null } as unknown as ReturnType<typeof useAuth>)
}

function renderProfile(username = 'rahim_mirpur') {
  return renderWithQuery(
    <MemoryRouter initialEntries={[`/u/${username}`]}>
      <Routes><Route path='/u/:username' element={<ProfilePage />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  signedInAs('someone-else')
  api.profile.mockResolvedValue(PROFILE)
  api.issues.mockResolvedValue([report('a'), report('b')])
  api.ratings.mockResolvedValue([RATING])
  api.roles.mockResolvedValue([])
})

describe('profile header', () => {
  it('shows the name, username, bio, area and stats', async () => {
    renderProfile()
    expect(await screen.findByRole('heading', { name: /Rahim Uddin/ })).toBeInTheDocument()
    expect(screen.getByText('@rahim_mirpur')).toBeInTheDocument()
    expect(screen.getByText('I fix drains on weekends.')).toBeInTheDocument()
    expect(screen.getByText('Mirpur 10')).toBeInTheDocument()
    expect(screen.getByText(/^Joined /)).toBeInTheDocument()
    expect(screen.getByText('Reputation').previousSibling).toHaveTextContent('120')
    expect(screen.getByText('Reports', { selector: 'dt' }).previousSibling).toHaveTextContent('8') // also a tab name
    expect(screen.getByText('Fixed').previousSibling).toHaveTextContent('5')
    expect(screen.getByText('Rating').previousSibling).toHaveTextContent('4.5★')
  })

  it('loads the profile from the username in the link', async () => {
    renderProfile('karim_uttara')
    await screen.findByRole('heading')
    expect(api.profile).toHaveBeenCalledWith('karim_uttara')
  })

  it('shows a dash instead of a rating before the first one', async () => {
    api.profile.mockResolvedValue({ ...PROFILE, rating_sum: 0, rating_count: 0 })
    renderProfile()
    await screen.findByRole('heading')
    expect(screen.getByText('Rating').previousSibling).toHaveTextContent('—')
  })

  it('falls back to the username when there is no full name', async () => {
    api.profile.mockResolvedValue({ ...PROFILE, full_name: '' })
    renderProfile()
    expect(await screen.findByRole('heading', { name: /rahim_mirpur/ })).toBeInTheDocument()
  })

  it('leaves out an empty bio and area', async () => {
    api.profile.mockResolvedValue({ ...PROFILE, bio: '', area_name: '' })
    renderProfile()
    await screen.findByRole('heading')
    expect(screen.queryByText('Mirpur 10')).not.toBeInTheDocument()
    expect(screen.queryByText('I fix drains on weekends.')).not.toBeInTheDocument()
  })

  it('puts the name in the browser tab', async () => {
    renderProfile()
    await waitFor(() => expect(document.title).toBe('Rahim Uddin · AmarShohor'))
  })

  it('says so when the user does not exist', async () => {
    api.profile.mockResolvedValue(null)
    renderProfile('nobody')
    expect(await screen.findByText('User not found')).toBeInTheDocument()
  })
})

describe('badges and roles', () => {
  it('marks volunteers', async () => {
    renderProfile()
    expect(await screen.findByText('Volunteer')).toBeInTheDocument()
  })

  it('has no volunteer badge for others', async () => {
    api.profile.mockResolvedValue({ ...PROFILE, is_volunteer: false })
    renderProfile()
    await screen.findByRole('heading')
    expect(screen.queryByText('Volunteer')).not.toBeInTheDocument()
  })

  it('shows admin and verified official roles', async () => {
    api.roles.mockResolvedValue([
      { role: 'admin', authority_short_name: null },
      { role: 'official', authority_short_name: 'DNCC' },
    ] as UserRole[])
    renderProfile()
    expect(await screen.findByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('DNCC Official ✓')).toHaveAttribute('title', 'Verified by an admin')
  })
})

describe('own profile', () => {
  it('offers Edit profile and the download only on your own profile', async () => {
    signedInAs('u1')
    renderProfile()
    expect(await screen.findByRole('link', { name: /Edit profile/ })).toHaveAttribute('href', '/settings')
    expect(screen.getByTitle('Download my reports (CSV)')).toBeInTheDocument()
  })

  it('hides them on someone else\'s profile and when logged out', async () => {
    renderProfile()
    await screen.findByRole('heading')
    expect(screen.queryByRole('link', { name: /Edit profile/ })).not.toBeInTheDocument()
    expect(screen.queryByTitle('Download my reports (CSV)')).not.toBeInTheDocument()
  })
})

describe('reports tab', () => {
  it('lists the user\'s public reports', async () => {
    renderProfile()
    expect(await screen.findByText('Report a')).toBeInTheDocument()
    expect(screen.getByText('Report b')).toBeInTheDocument()
    expect(api.issues).toHaveBeenCalledWith('rahim_mirpur', 0)
  })

  it('loads 20 more when a full page came back', async () => {
    api.issues.mockImplementation(async (_u, offset = 0) =>
      offset === 0 ? Array.from({ length: 20 }, (_, i) => report(`p${i}`)) : [report('last', 'The 21st report')])
    renderProfile()
    await userEvent.click(await screen.findByRole('button', { name: /Load more/ }))
    expect(await screen.findByText('The 21st report')).toBeInTheDocument()
    expect(api.issues).toHaveBeenLastCalledWith('rahim_mirpur', 20)
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument()
  })

  it('has no Load more button when everything fit on one page', async () => {
    renderProfile()
    await screen.findByText('Report a')
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument()
  })

  it('explains an empty list, and reminds you where your anonymous reports are', async () => {
    api.issues.mockResolvedValue([])
    signedInAs('u1')
    renderProfile()
    expect(await screen.findByText('No public reports')).toBeInTheDocument()
    expect(screen.getByText(/anonymous reports are only visible to you/)).toBeInTheDocument()
  })

  it('does not mention anonymous reports on someone else\'s empty profile', async () => {
    api.issues.mockResolvedValue([])
    renderProfile()
    await screen.findByText('No public reports')
    expect(screen.queryByText(/anonymous reports/)).not.toBeInTheDocument()
  })
})

describe('ratings tab', () => {
  it('shows how many ratings there are and loads them only when opened', async () => {
    renderProfile()
    const tab = await screen.findByRole('button', { name: 'Ratings received (2)' })
    expect(api.ratings).not.toHaveBeenCalled()
    await userEvent.click(tab)
    expect(await screen.findByText('Blocked drain on Road 3')).toBeInTheDocument()
    expect(api.ratings).toHaveBeenCalledWith('u1')
  })

  it('shows the review, a link to the issue and keeps an anonymous rater anonymous', async () => {
    renderProfile()
    await userEvent.click(await screen.findByRole('button', { name: /Ratings received/ }))
    expect(await screen.findByRole('link', { name: 'Blocked drain on Road 3' })).toHaveAttribute('href', '/issue/iss-1')
    expect(screen.getByText('Quick and tidy work')).toBeInTheDocument()
    expect(screen.getByText(/by an anonymous reporter/)).toBeInTheDocument()
  })

  it('fills as many stars as the rating', async () => {
    const { container } = renderProfile()
    await userEvent.click(await screen.findByRole('button', { name: /Ratings received/ }))
    await screen.findByText('Quick and tidy work')
    expect(container.querySelectorAll('svg.fill-warn')).toHaveLength(4)
  })

  it('names a rater who was not anonymous', async () => {
    api.ratings.mockResolvedValue([{ ...RATING, rater_id: 'u9', rater_username: 'karim_uttara' }])
    renderProfile()
    await userEvent.click(await screen.findByRole('button', { name: /Ratings received/ }))
    expect(await screen.findByText(/by @karim_uttara/)).toBeInTheDocument()
  })

  it('says when there are no ratings yet', async () => {
    api.ratings.mockResolvedValue([])
    renderProfile()
    await userEvent.click(await screen.findByRole('button', { name: /Ratings received/ }))
    expect(await screen.findByText('No ratings yet.')).toBeInTheDocument()
  })

  it('goes back to the reports', async () => {
    renderProfile()
    await userEvent.click(await screen.findByRole('button', { name: /Ratings received/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Reports' }))
    expect(await screen.findByText('Report a')).toBeInTheDocument()
  })
})

describe('download my reports', () => {
  let saved: { name: string; blob: Blob } | null
  beforeEach(() => {
    saved = null
    signedInAs('u1')
    let blob: Blob
    URL.createObjectURL = vi.fn((b: Blob) => { blob = b; return 'blob:test' })
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved = { name: this.download, blob }
    })
  })

  it('downloads every one of my reports, including anonymous ones, as a CSV file', async () => {
    api.feed.mockImplementation(async ({ offset = 0 }) =>
      offset === 0 ? Array.from({ length: 50 }, () => ({ ...report('x'), status: 'validated' } as Issue)) : [{ ...report('y'), status: 'closed' } as Issue])
    renderProfile()
    await userEvent.click(await screen.findByTitle('Download my reports (CSV)'))
    await waitFor(() => expect(saved).not.toBeNull())
    expect(api.feed.mock.calls.map(([q]) => q)).toEqual([
      { sort: 'new', scope: 'mine', limit: 50, offset: 0 },
      { sort: 'new', scope: 'mine', limit: 50, offset: 50 },
    ])
    expect(saved!.name).toMatch(/^amarshohor-my-reports-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(saved!.blob.type).toBe('text/csv;charset=utf-8')
    expect((await saved!.blob.text()).trim().split('\n')).toHaveLength(52) // header + 51 reports
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })

  it('shows an error and downloads nothing when loading fails', async () => {
    api.feed.mockRejectedValue(new Error('offline'))
    renderProfile()
    await userEvent.click(await screen.findByTitle('Download my reports (CSV)'))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(saved).toBeNull()
  })
})
