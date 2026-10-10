// @vitest-environment jsdom
// The log in card with the CAPTCHA switched on. The CAPTCHA widget is replaced by a button that hands
// over a token, and Supabase Auth is replaced, so nothing is really sent.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from '../lib/supabase'
import { renderWithQuery } from '../test/utils'
import { AuthForm } from './AuthForm'

vi.mock('../lib/api', () => ({ isUsernameTaken: vi.fn().mockResolvedValue(false), getAuthorities: vi.fn().mockResolvedValue([]) }))
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), resetPasswordForEmail: vi.fn(), resend: vi.fn() } },
}))
vi.mock('../lib/captcha', () => ({ captchaEnabled: true }))
let rounds: number[] = []
vi.mock('./Captcha', () => ({
  Captcha: ({ onToken, round }: { onToken: (t: string | null) => void; round: number }) => {
    rounds.push(round)
    return <button type="button" onClick={() => onToken('token-' + round)}>I'm not a robot</button>
  },
}))
const auth = vi.mocked(supabase.auth)

function renderLogin() {
  renderWithQuery(<MemoryRouter><AuthForm mode="login" onModeChange={() => undefined} /></MemoryRouter>)
}
const fill = async () => {
  await userEvent.type(screen.getByLabelText('Email address'), 'rahim@example.com')
  await userEvent.type(screen.getByLabelText('Password'), 'secret-pass')
}
const logIn = () => userEvent.click(screen.getByRole('button', { name: 'Log in' }))

beforeEach(() => {
  vi.clearAllMocks()
  rounds = []
  auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Invalid login credentials' } } as never)
  auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null } as never)
})

describe('with the CAPTCHA on', () => {
  it('asks for the check before sending anything', async () => {
    renderLogin()
    await fill()
    await logIn()
    expect(screen.getByRole('alert')).toHaveTextContent("I'm not a robot")
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it('sends the token with the login, then starts a new check', async () => {
    renderLogin()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: "I'm not a robot" }))
    await logIn()
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'rahim@example.com', password: 'secret-pass', options: { captchaToken: 'token-0' },
    })
    // a token works once: after the attempt the widget is reset
    await waitFor(() => expect(rounds.at(-1)).toBe(1))
  })

  it('sends the token with a password reset', async () => {
    renderLogin()
    await userEvent.type(screen.getByLabelText('Email address'), 'rahim@example.com')
    await userEvent.click(screen.getByRole('button', { name: "I'm not a robot" }))
    await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('rahim@example.com', expect.objectContaining({ captchaToken: 'token-0' }))
  })
})
