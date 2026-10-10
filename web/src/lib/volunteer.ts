// Volunteer rules and wording, kept apart from React so they can be unit tested on their own.
import { formatDistanceToNowStrict, isAfter } from 'date-fns'
import type { Issue } from './types'

/** "1 completed task", "3 completed tasks". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "1 star", "4 stars": what a screen reader says for each rating button. */
export const starLabel = (n: number) => plural(n, 'star')

/** Has this lock run out? The 15-minute clean-up job may not have released the task yet, so the page must say it. */
export const lockExpired = (iso: string | null, now = new Date()) => Boolean(iso) && !isAfter(new Date(iso!), now)

/** What other people see on a task someone holds. */
export function lockNote(iso: string | null, now = new Date()): string {
  if (!iso) return ''
  return lockExpired(iso, now)
    ? 'Their lock has run out, so the task goes back to the pool soon unless they post progress.'
    : `Their lock runs out in ${formatDistanceToNowStrict(new Date(iso))} unless they post progress.`
}

/** The banner on your own task. */
export function myLockText(iso: string | null, now = new Date()): string {
  if (!iso) return 'This is your task'
  if (lockExpired(iso, now)) return 'Your lock has run out. Post progress now to keep this task.'
  return `This is your task · ${formatDistanceToNowStrict(new Date(iso!))} left on your lock`
}

/** The line under a task in "My tasks". */
export function taskLockLine(iso: string | null, now = new Date()): string {
  if (!iso) return ''
  if (lockExpired(iso, now)) return 'Lock ran out. Post progress now to keep it'
  return `${formatDistanceToNowStrict(new Date(iso!))} left. Post an update to keep it`
}

/** Tasks still in your hands (not closed). Turning volunteer mode off is refused while there are any. */
export const activeTasks = (tasks: Issue[]) => tasks.filter((t) => t.status !== 'closed')

/**
 * Tasks you lead that count against the limit (max_active_tasks): until a task is closed its assignment stays
 * active, so a submitted fix waiting for confirmation still counts. Teams you only joined don't.
 */
export const ledTaskCount = (tasks: Issue[], userId: string) =>
  tasks.filter((t) => t.volunteer_id === userId && t.status !== 'closed').length

/** Open teams, narrowed to the category chosen above them (the server list has no category filter). */
export const teamsInCategory = (teams: Issue[], category: string | null) =>
  category ? teams.filter((t) => t.category === category) : teams

/** What to try when no open task matches. The radius only helps once the page knows where you are. */
export const noTasksHint = (knowsLocation: boolean) =>
  knowsLocation
    ? 'Validated issues appear here. Try a bigger radius or another category.'
    : 'Validated issues appear here. Try another category, or use your location to see tasks near you.'
