import { describe, expect, it } from 'vitest'
import type { Issue } from './types'
import {
  activeTasks, ledTaskCount, lockExpired, lockNote, myLockText, noTasksHint, plural, starLabel, taskLockLine, teamsInCategory,
} from './volunteer'

const NOW = new Date('2026-10-10T12:00:00Z')
const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()
const task = (over: Partial<Issue>) => ({ id: 'x', status: 'assigned', volunteer_id: 'me', category: 'drain', ...over }) as Issue

describe('plural and starLabel', () => {
  it('says one thing without an s and others with one', () => {
    expect(plural(1, 'completed task')).toBe('1 completed task')
    expect(plural(3, 'completed task')).toBe('3 completed tasks')
    expect(plural(0, 'task')).toBe('0 tasks')
  })

  it('reads stars correctly for screen readers', () => {
    expect(starLabel(1)).toBe('1 star')
    expect(starLabel(5)).toBe('5 stars')
  })
})

describe('locks', () => {
  it('knows when a lock has run out, including the exact moment', () => {
    expect(lockExpired(inHours(2), NOW)).toBe(false)
    expect(lockExpired(inHours(-1), NOW)).toBe(true)
    expect(lockExpired(NOW.toISOString(), NOW)).toBe(true)
    expect(lockExpired(null, NOW)).toBe(false)
  })

  it('never says "runs out in expired" to other people', () => {
    expect(lockNote(inHours(-1), NOW)).toBe('Their lock has run out, so the task goes back to the pool soon unless they post progress.')
    expect(lockNote(inHours(-1), NOW)).not.toContain('expired')
    expect(lockNote(null, NOW)).toBe('')
  })

  it('tells you plainly when your own lock has run out', () => {
    expect(myLockText(inHours(-1), NOW)).toBe('Your lock has run out. Post progress now to keep this task.')
    expect(myLockText(null, NOW)).toBe('This is your task')
  })

  it('says how long is left while the lock is running', () => {
    expect(lockNote(new Date(Date.now() + 5 * 3_600_000).toISOString())).toMatch(/^Their lock runs out in 5 hours/)
    expect(myLockText(new Date(Date.now() + 3 * 86_400_000).toISOString())).toBe('This is your task · 3 days left on your lock')
    expect(taskLockLine(new Date(Date.now() + 5 * 3_600_000).toISOString())).toBe('5 hours left. Post an update to keep it')
  })

  it('marks a run-out lock in the task list', () => {
    expect(taskLockLine(inHours(-2), NOW)).toBe('Lock ran out. Post progress now to keep it')
    expect(taskLockLine(null, NOW)).toBe('')
  })
})

describe('activeTasks and ledTaskCount', () => {
  const tasks = [
    task({ id: 'a', status: 'assigned' }),
    task({ id: 'b', status: 'resolution_submitted' }), // still counts until it is closed
    task({ id: 'c', status: 'closed' }),
    task({ id: 'd', status: 'in_progress', volunteer_id: 'leader2' }), // a team I only joined
  ]

  it('keeps every task that is not closed', () => {
    expect(activeTasks(tasks).map((t) => t.id)).toEqual(['a', 'b', 'd'])
  })

  it('counts only the tasks I lead, including fixes waiting for confirmation', () => {
    expect(ledTaskCount(tasks, 'me')).toBe(2)
    expect(ledTaskCount(tasks, 'leader2')).toBe(1)
    expect(ledTaskCount([], 'me')).toBe(0)
  })
})

describe('teamsInCategory', () => {
  const teams = [task({ id: 'a', category: 'drain' }), task({ id: 'b', category: 'garbage' })]

  it('keeps every team when no category is chosen', () => {
    expect(teamsInCategory(teams, null)).toHaveLength(2)
  })

  it('keeps only the chosen category, like the open tasks above', () => {
    expect(teamsInCategory(teams, 'garbage').map((t) => t.id)).toEqual(['b'])
    expect(teamsInCategory(teams, 'pothole')).toEqual([])
  })
})

describe('noTasksHint', () => {
  it('suggests a bigger radius only when the radius can be changed', () => {
    expect(noTasksHint(true)).toMatch(/bigger radius/)
    expect(noTasksHint(false)).not.toMatch(/radius/)
    expect(noTasksHint(false)).toMatch(/use your location/)
  })
})
