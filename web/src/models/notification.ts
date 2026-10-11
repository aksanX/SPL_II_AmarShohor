// In-app notifications.

export interface Notification {
  id: number
  type: string
  issue_id: string | null
  alert_id: string | null
  message: string
  read_at: string | null
  created_at: string
  actor_id: string | null
  actor_username: string | null
  actor_full_name: string | null
  actor_avatar_url: string | null
}
