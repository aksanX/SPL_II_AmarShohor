// Login and sign-up rules, kept apart from React so they can be unit tested on their own.

/** Same rule as the database (profiles.username): 3–24 lowercase letters, digits or _. */
export const USERNAME_RE = /^[a-z0-9_]{3,24}$/

/** What the username box keeps while typing: lowercase, only letters, digits and _. */
export const cleanUsername = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9_]/g, '')

/** Why a username can't be used, or null when it is fine. */
export function usernameProblem(username: string): string | null {
  if (username.length < 3) return 'Username: at least 3 characters.'
  if (!USERNAME_RE.test(username)) return 'Username: 3–24 lowercase letters, numbers or _.'
  return null
}

/** Supabase's English error codes in plain words, with what to do next. Unknown errors keep their own text. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Wrong email or password.'
  if (m.includes('email not confirmed')) return 'Confirm your email first: open the link we sent you (check spam too).'
  if (m.includes('user already registered')) return 'An account with this email already exists. Log in instead.'
  if (m.includes('rate limit') || m.includes('too many') || m.includes('only request this after'))
    return 'Too many tries. Wait a minute and try again.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Network problem: check your connection and try again.'
  return message
}

/** True when Supabase hid that the email is already registered (email confirmation on: no error, no identity). */
export function isExistingAccount(user: { identities?: unknown[] } | null | undefined): boolean {
  return Boolean(user && Array.isArray(user.identities) && user.identities.length === 0)
}

/** The page to return to after logging in: its path and its ?query (e.g. /new?lat=…&lng=…), not just the path. */
export const returnPath = (location: { pathname: string; search: string }) => location.pathname + location.search

/** Why a new password can't be used, or null when it is fine. */
export function newPasswordProblem(password: string, again: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.'
  if (password !== again) return 'The two passwords are different.'
  return null
}
