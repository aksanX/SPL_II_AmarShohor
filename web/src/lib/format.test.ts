import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compact, displayName, dueText, hoursLeft, timeAgo, timeLeft } from './format'

const NOW = new Date('2026-10-07T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const fromNow = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('timeAgo', () => {
  it('says "just now" for the first minute', () => {
    expect(timeAgo(ago(0))).toBe('just now')
    expect(timeAgo(ago(59_000))).toBe('just now')
  })

  it('counts minutes, hours and days after that', () => {
    expect(timeAgo(ago(MIN))).toBe('1 minute ago')
    expect(timeAgo(ago(3 * HOUR))).toBe('3 hours ago')
    expect(timeAgo(ago(2 * DAY))).toBe('2 days ago')
  })
})

describe('timeLeft', () => {
  it('is empty when there is no deadline', () => {
    expect(timeLeft(null)).toBe('')
  })

  it('says how long is left', () => {
    expect(timeLeft(fromNow(5 * HOUR))).toBe('5 hours left')
    expect(timeLeft(fromNow(3 * DAY))).toBe('3 days left')
  })

  it('says "expired" once the deadline has passed, including the exact moment', () => {
    expect(timeLeft(ago(MIN))).toBe('expired')
    expect(timeLeft(ago(0))).toBe('expired')
  })
})

describe('hoursLeft', () => {
  it('is unlimited without a deadline, so no "running out" warning shows', () => {
    expect(hoursLeft(null)).toBe(Infinity)
  })

  it('is the hours until the deadline, and negative after it', () => {
    expect(hoursLeft(fromNow(30 * HOUR))).toBe(30)
    expect(hoursLeft(fromNow(90 * MIN))).toBe(1.5)
    expect(hoursLeft(ago(2 * HOUR))).toBe(-2)
  })
})

describe('dueText', () => {
  it('is empty when the City Corporation has no target time', () => {
    expect(dueText(null)).toBe('')
  })

  it('says when it is due, or how late it is', () => {
    expect(dueText(fromNow(3 * DAY))).toBe('due in 3 days')
    expect(dueText(ago(5 * DAY))).toBe('overdue by 5 days')
  })
})

describe('displayName', () => {
  it('uses the full name when there is one', () => {
    expect(displayName('Rahim Uddin', 'rahim_mirpur')).toBe('Rahim Uddin')
  })

  it('trims spaces around the full name', () => {
    expect(displayName('  Rahim  ', 'rahim_mirpur')).toBe('Rahim')
  })

  it('falls back to the username when the full name is empty or only spaces', () => {
    expect(displayName('', 'rahim_mirpur')).toBe('rahim_mirpur')
    expect(displayName('   ', 'rahim_mirpur')).toBe('rahim_mirpur')
    expect(displayName(null, 'rahim_mirpur')).toBe('rahim_mirpur')
  })

  it('says "Someone" when there is no name at all', () => {
    expect(displayName(null, null)).toBe('Someone')
    expect(displayName(undefined, '')).toBe('Someone')
  })
})

describe('compact', () => {
  it('shows small numbers as they are', () => {
    expect(compact(0)).toBe('0')
    expect(compact(999)).toBe('999')
  })

  it('shortens thousands with one decimal below 10k', () => {
    expect(compact(1000)).toBe('1.0k')
    expect(compact(1540)).toBe('1.5k')
  })

  it('drops the decimal from 10k', () => {
    expect(compact(10_000)).toBe('10k')
    expect(compact(12_345)).toBe('12k')
  })
})
