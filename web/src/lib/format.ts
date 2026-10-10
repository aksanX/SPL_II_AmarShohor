import { formatDistanceToNowStrict, isAfter } from 'date-fns'
import type { EmergencyKind, IssueStatus, Severity } from './types'

/**
 * An area's name for city admins: "Dhaka North City Corporation" → "Dhaka North". City admins are labelled by
 * the area they look after, not as City Corporation staff. Same as area_label() in the database (0045).
 */
export const areaLabel = (name: string) => name.replace(/\s*city\s+corporation\s*$/i, '').trim() || name

export function timeAgo(iso: string) {
  const d = new Date(iso)
  const secs = (Date.now() - d.getTime()) / 1000
  if (secs < 60) return 'just now'
  return formatDistanceToNowStrict(d, { addSuffix: true })
}

export function timeLeft(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (!isAfter(d, new Date())) return 'expired'
  return `${formatDistanceToNowStrict(d)} left`
}

export function hoursLeft(iso: string | null) {
  if (!iso) return Infinity
  return (new Date(iso).getTime() - Date.now()) / 3_600_000
}

export const STATUS_META: Record<IssueStatus, { label: string; tone: string; help: string }> = {
  community_review: {
    label: 'Needs validation',
    tone: 'bg-warn-soft text-warn',
    help: 'Waiting for the community to verify it with upvotes and on-site confirmations.',
  },
  validated: {
    label: 'Validated · needs volunteer',
    tone: 'bg-info-soft text-info',
    help: 'The community confirmed this issue. Any volunteer can take it on.',
  },
  escalated: {
    label: 'With City Corporation',
    tone: 'bg-warn-soft text-warn',
    help: 'Validated and sent to the City Corporation that covers this area.',
  },
  under_review: {
    label: 'Admin reviewing',
    tone: 'bg-card-hover text-muted',
    help: 'A volunteer or official asked for a decision (send it to the City Corporation or to volunteers, or the report is wrong). An admin decides.',
  },
  assigned: { label: 'Someone is on it', tone: 'bg-brand-soft text-brand', help: 'A volunteer or official accepted this task.' },
  in_progress: { label: 'In progress', tone: 'bg-brand-soft text-brand', help: 'Work is under way.' },
  resolution_submitted: {
    label: 'Fix submitted · confirm?',
    tone: 'bg-info-soft text-info',
    help: 'Someone says it is fixed. The reporter or nearby citizens confirm.',
  },
  closed: { label: 'Resolved', tone: 'bg-brand text-brand-ink', help: 'Fixed and confirmed by the community.' },
  hidden: {
    label: 'Hidden (flagged)',
    tone: 'bg-danger-soft text-danger',
    help: 'Hidden because more people flagged it as fake than supported it.',
  },
  expired: { label: 'Expired', tone: 'bg-card-hover text-muted', help: 'Did not get enough community support in time.' },
}

export const SEVERITY_META: Record<Severity, { label: string; tone: string }> = {
  low: { label: 'Low', tone: 'bg-card-hover text-muted' },
  medium: { label: 'Medium', tone: 'bg-info-soft text-info' },
  high: { label: 'High', tone: 'bg-warn-soft text-warn' },
  critical: { label: 'Critical', tone: 'bg-danger-soft text-danger' },
}

export const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical']

export function displayName(fullName: string | null | undefined, username: string | null | undefined) {
  return (fullName && fullName.trim()) || username || 'Someone'
}

/** "due in 3 days" / "overdue by 5 days" for City Corporation target times. */
export function dueText(dueAt: string | null) {
  if (!dueAt) return ''
  const d = new Date(dueAt)
  return isAfter(d, new Date())
    ? `due in ${formatDistanceToNowStrict(d)}`
    : `overdue by ${formatDistanceToNowStrict(d)}`
}

export const ROUTE_LABEL = {
  community: 'Volunteers',
  authority: 'City Corporation',
  pending: 'Admin deciding',
} as const

export function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
}

export const EMERGENCY_LABEL: Record<EmergencyKind, string> = {
  fire: 'Fire', gas_leak: 'Gas leak', building_collapse: 'Building collapse', live_wire: 'Live electric wire',
  flood_rescue: 'People trapped by flooding', toxic_release: 'Chemical spill or toxic smoke', other: 'Emergency',
}

/** 1536 → "2 KB", 5_000_000 → "4.8 MB". */
export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
