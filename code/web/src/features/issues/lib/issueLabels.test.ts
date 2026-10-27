import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dueText } from '@/features/issues/lib/issueLabels'

const NOW = new Date('2026-10-07T12:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const fromNow = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
const DAY = 24 * 60 * 60_000

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => {
  vi.useRealTimers()
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
