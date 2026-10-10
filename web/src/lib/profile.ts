// The profile page's calculations, kept apart from React so they can be unit tested on their own.
import { STATUS_META } from './format'
import type { Issue, UserRole } from './types'

/** Reports shown per page on a profile. */
export const REPORTS_PAGE = 20

/** Average star rating with one decimal ("4.5"), or null before the first rating. */
export function averageRating(sum: number, count: number): string | null {
  return count > 0 ? (sum / count).toFixed(1) : null
}

/** Offset of the next page of reports, or undefined when the last page was not full (nothing more to load). */
export function nextReportsOffset(last: unknown[], all: unknown[][]): number | undefined {
  return last.length === REPORTS_PAGE ? all.length * REPORTS_PAGE : undefined
}

/** Chip text for a role: "Admin", or "DNCC Official ✓" for a verified City Corporation official. */
export function roleLabel(role: Pick<UserRole, 'role' | 'authority_short_name'>): string {
  return role.role === 'admin' ? 'Admin' : `${role.authority_short_name ?? 'City Corporation'} Official ✓`
}

/** Who gave a rating. Reporters who posted anonymously stay anonymous here too. */
export function raterText(username: string | null): string {
  return username ? `@${username}` : 'an anonymous reporter'
}

// ---------- "Download my reports" (CSV) ----------

export const EXPORT_COLUMNS = [
  'Title', 'Category', 'Severity', 'Status', 'Address', 'Latitude', 'Longitude', 'Upvotes',
  'On-site confirmations', 'Comments', 'Anonymous', 'Reported', 'Validated', 'Closed', 'Volunteer', 'Link',
]

/** One CSV cell: always quoted, inner quotes doubled, missing values empty. Commas and new lines stay inside the cell. */
export const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

/** The whole CSV file. Starts with a byte order mark so Excel reads Bangla text as UTF-8. */
export function reportsCsv(issues: Issue[], origin: string): string {
  const rows = issues.map((i) => [
    i.title, i.category_name, i.severity, STATUS_META[i.status].label, i.address, i.lat, i.lng, i.upvote_count,
    i.confirmation_count, i.comment_count, i.is_anonymous ? 'yes' : 'no', i.created_at, i.validated_at ?? '',
    i.closed_at ?? '', i.volunteer_username ?? '', `${origin}/issue/${i.id}`,
  ].map(csvCell).join(','))
  return '﻿' + [EXPORT_COLUMNS.map(csvCell).join(','), ...rows].join('\n')
}

/** Loads every page (pageSize at a time) until a page comes back short. */
export async function fetchAllPages<T>(getPage: (offset: number) => Promise<T[]>, pageSize = 50): Promise<T[]> {
  const all: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const page = await getPage(offset)
    all.push(...page)
    if (page.length < pageSize) return all
  }
}

/** File name with the day of the download: amarshohor-my-reports-2026-10-10.csv */
export const exportFileName = (date: Date) => `amarshohor-my-reports-${date.toISOString().slice(0, 10)}.csv`
