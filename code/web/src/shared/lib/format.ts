import { formatDistanceToNowStrict, isAfter } from 'date-fns'

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

export function displayName(fullName: string | null | undefined, username: string | null | undefined) {
  return (fullName && fullName.trim()) || username || 'Someone'
}

export function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n)
}

/** 1536 → "2 KB", 5_000_000 → "4.8 MB". */
export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
