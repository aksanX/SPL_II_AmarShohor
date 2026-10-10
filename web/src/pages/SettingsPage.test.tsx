// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { updateMyProfile } from '../lib/api'
import type { Profile } from '../lib/types'
import { renderWithQuery } from '../test/utils'
import { SettingsPage } from './SettingsPage'

vi.mock('../lib/api', () => ({
  getAuthorities: vi.fn(async () => []), getMyRoleRequest: vi.fn(async () => null), requestOfficialRole: vi.fn(),
  deleteMyAccount: vi.fn(), updateMyProfile: vi.fn(async () => undefined), updateMySettings: vi.fn(async () => undefined),
}))
vi.mock('../lib/supabase', () => ({ mediaUrl: (p: string) => `/media/${p}`, pathFromMediaUrl: () => null }))
vi.mock('../lib/media', () => ({ uploadMedia: vi.fn(), discardPaths: vi.fn() }))
vi.mock('../components/map/LocationPicker', () => ({ LocationPicker: () => <div>map</div> }))
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../hooks/useData', () => ({
  useMySettings: () => ({ data: { user_id: 'me', home_lat: null, home_lng: null, default_anonymous: false, show_on_leaderboard: true } }),
}))
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'me' }, loading: false, role: 'citizen', refreshProfile: vi.fn(async () => {}),
    profile: { id: 'me', username: 'rahim_mirpur', full_name: 'Rahim', bio: '', area_name: '', avatar_url: null } as unknown as Profile,
  } as unknown as ReturnType<typeof useAuth>)
})

// Settings links to the Terms and Privacy pages, so it needs a router.
const renderSettings = () => renderWithQuery(<MemoryRouter><SettingsPage /></MemoryRouter>)
const username = () => screen.getByLabelText('Username')
const save = () => userEvent.click(screen.getByRole('button', { name: /Save settings/ }))

describe('SettingsPage username', () => {
  it('cleans the username while typing, like sign-up', async () => {
    renderSettings()
    await userEvent.clear(username())
    await userEvent.type(username(), 'Rahim.Mirpur-10')
    expect(username()).toHaveValue('rahimmirpur10')
  })

  it('stops a too-short username with a plain message instead of a database error', async () => {
    renderSettings()
    await userEvent.clear(username())
    await userEvent.type(username(), 'ab')
    await save()
    expect(toast.error).toHaveBeenCalledWith(new Error('Username: at least 3 characters.'))
    expect(updateMyProfile).not.toHaveBeenCalled()
  })

  it('saves trimmed name, bio and area', async () => {
    renderSettings()
    await userEvent.clear(screen.getByLabelText('Full name'))
    await userEvent.type(screen.getByLabelText('Full name'), '  Rahim Uddin  ')
    await save()
    expect(updateMyProfile).toHaveBeenCalledWith('rahim_mirpur', 'Rahim Uddin', '', '', null)
  })
})

describe('SettingsPage account', () => {
  it('offers account deletion and links the Terms and Privacy Policy', () => {
    renderSettings()
    expect(screen.getByRole('button', { name: /Delete my account/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Terms of Use' })).toHaveAttribute('href', '/terms')
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
  })
})
