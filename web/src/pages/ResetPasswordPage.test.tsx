// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { renderWithQuery } from '../test/utils'
import { ResetPasswordPage } from './ResetPasswordPage'

vi.mock('../lib/supabase', () => ({ supabase: { auth: { updateUser: vi.fn() } } }))
vi.mock('../hooks/useAuth', () => ({ useAuth: vi.fn() }))
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() }
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }))
const update = vi.mocked(supabase.auth.updateUser)
const auth = vi.mocked(useAuth)

function renderPage(user: { email: string } | null) {
  auth.mockReturnValue({ user, loading: false } as unknown as ReturnType<typeof useAuth>)
  renderWithQuery(
    <MemoryRouter initialEntries={['/reset-password']}>
      <Routes>
        <Route path='/reset-password' element={<ResetPasswordPage />} />
        <Route path='/' element={<p>Home</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function fill(password: string, again: string) {
  await userEvent.type(screen.getByLabelText('New password'), password)
  await userEvent.type(screen.getByLabelText('New password again'), again)
  await userEvent.click(screen.getByRole('button', { name: /Save new password/ }))
}

beforeEach(() => {
  vi.clearAllMocks()
  update.mockResolvedValue({ data: {}, error: null } as never)
})

describe('ResetPasswordPage', () => {
  it('saves the new password and goes home', async () => {
    renderPage({ email: 'rahim@example.com' })
    expect(screen.getByText('For rahim@example.com')).toBeInTheDocument()
    await fill('newpassword1', 'newpassword1')
    expect(update).toHaveBeenCalledWith({ password: 'newpassword1' })
    expect(await screen.findByText('Home')).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith('Password changed. You are logged in.')
  })

  it('stops when the two passwords differ', async () => {
    renderPage({ email: 'rahim@example.com' })
    await fill('newpassword1', 'newpassword2')
    expect(screen.getByRole('alert')).toHaveTextContent('The two passwords are different.')
    expect(update).not.toHaveBeenCalled()
  })

  it('shows the error when Supabase refuses the password', async () => {
    update.mockResolvedValue({ data: {}, error: new Error('New password should be different from the old password.') } as never)
    renderPage({ email: 'rahim@example.com' })
    await fill('samepassword', 'samepassword')
    expect(await screen.findByRole('alert')).toHaveTextContent('New password should be different from the old password.')
    expect(screen.queryByText('Home')).not.toBeInTheDocument()
  })

  it('explains an expired link when nobody is logged in', () => {
    renderPage(null)
    expect(screen.getByText('This link has expired')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Forgot password/ })).toHaveAttribute('href', '/login')
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })
})
