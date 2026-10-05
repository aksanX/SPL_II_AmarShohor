// Shapes returned by the database views / functions (supabase/migrations/0003).

export type IssueStatus =
  | 'community_review'
  | 'validated'
  | 'assigned'
  | 'in_progress'
  | 'resolution_submitted'
  | 'closed'
  | 'hidden'
  | 'expired'

export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type FlagReason = 'fake_or_scam' | 'wrong_location' | 'duplicate' | 'spam' | 'inappropriate' | 'already_fixed'
export type MediaKind = 'report' | 'confirmation' | 'progress' | 'resolution'
export type MediaType = 'image' | 'video'

export interface MediaItem {
  id: string
  kind: MediaKind
  media_type: MediaType
  path: string
}

export interface Category {
  slug: string
  name: string
  name_bn: string
  icon: string
  color: string
  resolver: 'community' | 'authority'
  default_severity: Severity
  sort_order: number
}

export interface Issue {
  id: string
  title: string
  description: string
  category: string
  category_name: string
  category_name_bn: string
  category_icon: string
  category_color: string
  resolver: 'community' | 'authority'
  severity: Severity
  lat: number
  lng: number
  location_accuracy_m: number | null
  location_source: 'gps' | 'manual'
  address: string
  status: IssueStatus
  is_anonymous: boolean
  reporter_id: string | null
  reporter_username: string | null
  reporter_full_name: string | null
  reporter_avatar_url: string | null
  is_mine: boolean
  upvote_count: number
  confirmation_count: number
  comment_count: number
  follower_count: number
  flag_count: number
  validation_score: number
  validation_threshold: number
  volunteer_id: string | null
  volunteer_username: string | null
  volunteer_full_name: string | null
  volunteer_avatar_url: string | null
  assigned_at: string | null
  lock_expires_at: string | null
  resolution_note: string | null
  resolution_submitted_at: string | null
  validated_at: string | null
  closed_at: string | null
  created_at: string
  updated_at: string
  last_activity_at: string
  my_vote: boolean
  my_confirmed: boolean
  my_flagged: boolean
  my_following: boolean
  my_severity_vote: Severity | null
  my_resolution_review: boolean | null
  is_rated: boolean
  media: MediaItem[]
}

export interface Profile {
  id: string
  username: string
  full_name: string
  avatar_url: string | null
  bio: string
  area_name: string
  is_volunteer: boolean
  volunteer_since: string | null
  reputation: number
  tasks_completed: number
  tasks_expired: number
  tasks_reopened: number
  rating_sum: number
  rating_count: number
  reports_count: number
  created_at: string
}

export interface MySettings {
  user_id: string
  home_lat: number | null
  home_lng: number | null
  default_anonymous: boolean
  show_on_leaderboard: boolean
}

export interface AppSettings {
  threshold_critical: number
  threshold_high: number
  threshold_medium: number
  threshold_low: number
  min_supporters: number
  confirm_radius_m: number
  duplicate_radius_m: number
  max_gps_accuracy_m: number
  lock_hours: number
  resolution_radius_m: number
  resolution_quorum: number
  reviewer_radius_m: number
  auto_close_days: number
  hide_min_flags: number
  review_expiry_days: number
  volunteer_min_account_hours: number
  max_active_tasks: number
  heat_half_life_days: number
  rep_task_completed: number
  rep_task_expired: number
  rep_task_reopened: number
  rep_per_star: number
  min_lat: number
  max_lat: number
  min_lng: number
  max_lng: number
}

export interface Comment {
  id: string
  issue_id: string
  parent_id: string | null
  author_id: string
  author_username: string
  author_full_name: string
  author_avatar_url: string | null
  body: string | null
  is_deleted: boolean
  is_hidden: boolean
  is_update: boolean
  edited_at: string | null
  created_at: string
  is_volunteer: boolean
  is_reporter: boolean
  my_flagged: boolean
}

export interface IssueEvent {
  id: number
  issue_id: string
  type: string
  note: string | null
  data: Record<string, unknown>
  created_at: string
  actor_id: string | null
  actor_username: string | null
  actor_full_name: string | null
  actor_avatar_url: string | null
  media: MediaItem[]
}

export interface Notification {
  id: number
  type: string
  issue_id: string | null
  message: string
  read_at: string | null
  created_at: string
  actor_id: string | null
  actor_username: string | null
  actor_full_name: string | null
  actor_avatar_url: string | null
}

export interface LeaderboardRow {
  id: string
  username: string
  full_name: string
  avatar_url: string | null
  area_name: string
  reputation: number
  tasks_completed: number
  tasks_expired: number
  tasks_reopened: number
  rating_count: number
  avg_rating: number | null
  rank: number
}

export interface Rating {
  id: number
  issue_id: string
  issue_title: string
  volunteer_id: string
  stars: number
  review: string
  created_at: string
  rater_id: string | null
  rater_username: string | null
}

export interface DuplicateCandidate {
  id: string
  title: string
  status: IssueStatus
  distance_m: number
  upvote_count: number
  confirmation_count: number
  created_at: string
  thumb_path: string | null
  thumb_type: MediaType | null
}

export interface MapIssue {
  id: string
  title: string
  category: string
  category_color: string
  category_icon: string
  severity: Severity
  status: IssueStatus
  lat: number
  lng: number
  upvote_count: number
  confirmation_count: number
  validation_score: number
  validation_threshold: number
  created_at: string
  thumb_path: string | null
  thumb_type: MediaType | null
}

export interface HexCell {
  hex: GeoJSON.Polygon
  weight: number
  issue_count: number
  top_category: string
}

export interface HeatPoint {
  lat: number
  lng: number
  weight: number
}

export interface UploadedMedia {
  path: string
  type: MediaType
}

export type FeedSort = 'hot' | 'new' | 'top' | 'near'
export type FeedScope = 'all' | 'unverified' | 'validated' | 'resolved' | 'mine' | 'following'

export interface AreaSummary {
  radius_m: number
  active: number
  unverified: number
  resolved: number
  heat: number
  heat_per_km2: number
  categories: { category: string; count: number; heat: number }[]
  hottest: { id: string; title: string; category: string; status: IssueStatus; heat: number; distance_m: number }[]
}
