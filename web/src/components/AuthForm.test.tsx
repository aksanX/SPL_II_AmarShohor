// @vitest-environment jsdom
// The log in / create account card, with Supabase Auth replaced so nothing is really sent.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthorities, isUsernameTaken } from '../lib/api'
import { supabase } from '../lib/supabase'
import { renderWithQuery } from '../test/utils'
import { AuthForm, type AuthMode } from './AuthForm'

vi.mock('../lib/api', () => ({ isUsernameTaken: vi.fn(), getAuthorities: vi.fn().mockResolvedValue([]) }))
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), resetPasswordForEmail: vi.fn(), resend: vi.fn() } },
}))
const auth = vi.mocked(supabase.auth)
const taken = vi.mocked(isUsernameTaken)

function Card({ start }: { start: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(start)
  return <AuthForm mode={mode} onModeChange={setMode} redirectTo='/new?lat=23.8' />
}

function renderForm(start: AuthMode = 'login') {
  renderWithQuery(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path='/login' element={<Card start={start} />} />
        <Route path='/new' element={<p>Report form</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const type = async (label: string, text: string) => userEvent.type(screen.getByLabelText(label), text)
const submit = (name: 'Log in' | 'Create account') => userEvent.click(screen.getAllByRole('button', { name }).at(-1)!)

beforeEach(() => {
  vi.clearAllMocks()
  taken.mockResolvedValue(false)
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: null } as never)
  auth.signUp.mockResolvedValue({ data: { user: { identities: [{}] }, session: { access_token: 'x' } }, error: null } as never)
  auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null } as never)
  auth.resend.mockResolvedValue({ data: {}, error: null } as never)
})

describe('log in', () => {
  it('logs in and returns to the page that asked for it, with its query', async () => {
    renderForm()
    await type('Email address', '  rahim@example.com ')
    await type('Password', 'secret123')
    await submit('Log in')
    expect(await screen.findByText('Report form')).toBeInTheDocument()
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'rahim@example.com', password: 'secret123' })
  })

  it('says "Wrong email or password." instead of the raw error', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: new Error('Invalid login credentials') } as never)
    renderForm()
    await type('Email address', 'rahim@example.com')
    await type('Password', 'wrongpass1')
    await submit('Log in')
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.')
  })

  it('offers to resend the confirmation email when the email is not confirmed yet', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: new Error('Email not confirmed') } as never)
    renderForm()
    await type('Email address', 'rahim@example.com')
    await type('Password', 'secret123')
    await submit('Log in')
    await userEvent.click(await screen.findByRole('button', { name: 'Send the confirmation email again' }))
    expect(auth.resend).toHaveBeenCalledWith(expect.objectContaining({ type: 'signup', email: 'rahim@example.com' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Confirmation link sent again')
  })
})

describe('forgot password', () => {
  it('asks for the email first', async () => {
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your email first')
    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('sends the reset link to the typed email', async () => {
    renderForm()
    await type('Email address', 'rahim@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Password reset link sent')
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('rahim@example.com', expect.anything())
  })

  it('explains a rate limit in plain words', async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: new Error('Email rate limit exceeded') } as never)
    renderForm()
    await type('Email address', 'rahim@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries')
  })
})

describe('create account', () => {
  async function fillSignUp(username = 'rahim_mirpur') {
    await type('Full name', '  Rahim Uddin  ')
    await type('Username', username)
    await type('Email address', 'rahim@example.com')
    await type('Password', 'secret123')
  }

  it('cleans the username while typing', async () => {
    renderForm('register')
    await type('Username', 'Rahim.Mirpur-10')
    expect(screen.getByLabelText('Username')).toHaveValue('rahimmirpur10')
  })

  it('creates the account with the trimmed name and goes on', async () => {
    renderForm('register')
    await fillSignUp()
    await submit('Create account')
    expect(await screen.findByText('Report form')).toBeInTheDocument()
    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: 'rahim@example.com', options: expect.objectContaining({ data: { username: 'rahim_mirpur', full_name: 'Rahim Uddin' } }),
    }))
  })

  it('sends a City Corporation official email to the official sign-up instead of making a citizen account', async () => {
    vi.mocked(getAuthorities).mockResolvedValueOnce([
      { id: 'ccc', name: 'Chittagong City Corporation', short_name: 'CCC', kind: 'city_corporation', is_active: true, email_domain: 'ccc.gov.bd' },
    ] as never)
    renderForm('register')
    await type('Full name', 'CCC Staff')
    await type('Username', 'ccc_staff')
    await type('Email address', 'staff@zone1.ccc.gov.bd')
    await type('Password', 'secret123')
    await submit('Create account')
    expect(await screen.findByRole('alert')).toHaveTextContent('This is a CCC official email.')
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('says a username is taken instead of quietly giving another one', async () => {
    taken.mockResolvedValue(true)
    renderForm('register')
    await fillSignUp()
    await submit('Create account')
    expect(await screen.findByRole('alert')).toHaveTextContent('@rahim_mirpur is taken. Try another username.')
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('says when the email already has an account, instead of "check your email"', async () => {
    auth.signUp.mockResolvedValue({ data: { user: { identities: [] }, session: null }, error: null } as never)
    renderForm('register')
    await fillSignUp()
    await submit('Create account')
    expect(await screen.findByRole('alert')).toHaveTextContent('An account with this email already exists. Log in instead.')
    expect(screen.queryByText(/Check your email/)).not.toBeInTheDocument()
  })

  it('asks to confirm the email when the project requires it', async () => {
    auth.signUp.mockResolvedValue({ data: { user: { identities: [{}] }, session: null }, error: null } as never)
    renderForm('register')
    await fillSignUp()
    await submit('Create account')
    expect(await screen.findByRole('status')).toHaveTextContent('Check your email to confirm your account')
  })

  it('switches between log in and create account, clearing old messages', async () => {
    taken.mockResolvedValue(true)
    renderForm('register')
    await fillSignUp()
    await submit('Create account')
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('tab', { name: 'Log in' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
  })
})
