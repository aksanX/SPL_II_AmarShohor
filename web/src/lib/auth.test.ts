import { describe, expect, it } from 'vitest'
import { cleanUsername, friendlyAuthError, isExistingAccount, newPasswordProblem, returnPath, usernameProblem } from './auth'

describe('cleanUsername', () => {
  it('keeps lowercase letters, digits and _', () => {
    expect(cleanUsername('Rahim_Mirpur10')).toBe('rahim_mirpur10')
  })

  it('drops spaces, dots, dashes and other characters', () => {
    expect(cleanUsername('rahim.mirpur-10 !')).toBe('rahimmirpur10')
    expect(cleanUsername('রহিম')).toBe('')
  })
})

describe('usernameProblem', () => {
  it('accepts 3 to 24 allowed characters', () => {
    expect(usernameProblem('abc')).toBeNull()
    expect(usernameProblem('a'.repeat(24))).toBeNull()
    expect(usernameProblem('dhanmondi_volunteer22')).toBeNull()
  })

  it('asks for at least 3 characters', () => {
    expect(usernameProblem('ab')).toBe('Username: at least 3 characters.')
    expect(usernameProblem('')).toBe('Username: at least 3 characters.')
  })

  it('rejects more than 24 or characters the database does not allow', () => {
    expect(usernameProblem('a'.repeat(25))).toMatch(/3–24/)
    expect(usernameProblem('Rahim')).toMatch(/lowercase/)
  })
})

describe('friendlyAuthError', () => {
  it('says plainly what went wrong when logging in', () => {
    expect(friendlyAuthError('Invalid login credentials')).toBe('Wrong email or password.')
    expect(friendlyAuthError('Email not confirmed')).toMatch(/Confirm your email first/)
  })

  it('points an existing account to Log in', () => {
    expect(friendlyAuthError('User already registered')).toBe('An account with this email already exists. Log in instead.')
  })

  it('explains rate limits and network problems', () => {
    expect(friendlyAuthError('Email rate limit exceeded')).toBe('Too many tries. Wait a minute and try again.')
    expect(friendlyAuthError('For security purposes, you can only request this after 42 seconds.')).toMatch(/Too many tries/)
    expect(friendlyAuthError('Failed to fetch')).toMatch(/Network problem/)
  })

  it('keeps any other message as it is', () => {
    expect(friendlyAuthError('@rahim is taken. Try another username.')).toBe('@rahim is taken. Try another username.')
  })
})

describe('isExistingAccount', () => {
  it('spots the hidden "already registered" answer: a user with no identities', () => {
    expect(isExistingAccount({ identities: [] })).toBe(true)
  })

  it('is false for a real new sign-up or no user', () => {
    expect(isExistingAccount({ identities: [{ provider: 'email' }] })).toBe(false)
    expect(isExistingAccount({})).toBe(false)
    expect(isExistingAccount(null)).toBe(false)
  })
})

describe('returnPath', () => {
  it('keeps the query, so logging in returns to the same filled-in page', () => {
    expect(returnPath({ pathname: '/new', search: '?lat=23.8&lng=90.4' })).toBe('/new?lat=23.8&lng=90.4')
    expect(returnPath({ pathname: '/admin', search: '' })).toBe('/admin')
  })
})

describe('newPasswordProblem', () => {
  it('needs at least 8 characters', () => {
    expect(newPasswordProblem('short', 'short')).toBe('Use at least 8 characters.')
  })

  it('needs both boxes to match', () => {
    expect(newPasswordProblem('longenough1', 'longenough2')).toBe('The two passwords are different.')
  })

  it('accepts a long enough password typed twice', () => {
    expect(newPasswordProblem('longenough1', 'longenough1')).toBeNull()
  })
})
