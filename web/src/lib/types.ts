// Shapes returned by the database views / functions (supabase/migrations/0003).

export type IssueStatus =
  | 'community_review'
  | 'validated'
  | 'escalated'
  | 'under_review'
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
  is_active: boolean
  /** False for dangerous work: never shown to volunteers, always sent to an authority. */
  volunteer_allowed: boolean
  /** Categories in the same group count as the same problem in the duplicate check. */
  duplicate_group: string | null
  /** The subgroup (e.g. "1.1 Road & Sidewalk Conditions") this category belongs to; null = ungrouped. */
  group_slug: string | null
}

/** A top-level group (parent_slug null, e.g. "1. Roads, Mobility & Transportation") or one of its subgroups. */
export interface CategoryGroup {
  slug: string
  parent_slug: string | null
  code: string
  name: string
  name_bn: string
  description: string
  icon: string
  color: string
  sort_order: number
}

export type Route = 'community' | 'authority' | 'pending'

export interface Issue {
  id: string
  title: string
  description: string
  category: string | null
  category_name: string
  category_name_bn: string
  category_icon: string
  category_color: string
  resolver: 'community' | 'authority' | null
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
  // v2: routing
  size: 'small' | 'medium' | 'large' | null
  route: Route
  route_source: 'category' | 'admin' | null
  // v2: City Corporation
  authority_id: string | null
  authority_name: string | null
  authority_short_name: string | null
  authority_hotline: string | null
  authority_complaint_url: string | null
  escalated_at: string | null
  due_at: string | null
  is_overdue: boolean
  complaint_ref: string | null
  assignee_role: 'volunteer' | 'official'
  i_am_official_here: boolean
  // v2: teams
  team_size: number
  team_count: number
  my_team_member: boolean
  my_checked_in: boolean
  lead_offer_open: boolean
  lead_offer_to_me: boolean
  pending_review: boolean
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
  team_lock_hours: number
  team_lead_min_tasks: number
  escalation_retake_days: number
  escalation_abuse_rejections: number
  escalation_abuse_window_days: number
  rep_escalation_abuse: number
  rep_wrong_issue_lie: number
  stuck_release_count: number
  stuck_days: number
  request_help_radius_m: number
  emergency_radius_m: number
  emergency_new_account_radius_m: number
  emergency_hours: number
  emergency_max_per_day: number
  emergency_hide_denials: number
  emergency_end_votes: number
  emergency_respond_radius_m: number
  rep_false_emergency: number
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
  author_official_of: string | null
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
  actor_official_of: string | null
  actor_is_admin: boolean
}

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

// ---------- v2 ----------

export type AppRole = 'admin' | 'official'

export interface UserRole {
  user_id: string
  username: string
  full_name: string
  avatar_url: string | null
  role: AppRole
  authority_id: string | null
  authority_short_name: string | null
  granted_at: string
}

export interface EmergencyContact {
  label: string
  phone: string
}

export interface Authority {
  id: string
  name: string
  short_name: string
  area: GeoJSON.MultiPolygon
  hotline: string
  complaint_url: string
  emergency_contacts: EmergencyContact[]
  due_days_critical: number
  due_days_high: number
  due_days_medium: number
  due_days_low: number
  is_active: boolean
  /** city_corporation receives escalated issues by area; agency only by an admin's referral. */
  kind: 'city_corporation' | 'agency'
}

/** "Is this still there?" state for one issue (get_still_there). */
export interface StillThereState {
  checkable: boolean
  asked_at: string | null
  quiet_days: number
  gone: number
  still: number
  quorum: number
  my_answer: boolean | null
}

export interface AuthorityRecord {
  id: string
  name: string
  short_name: string
  hotline: string
  complaint_url: string
  escalated: number
  resolved: number
  open: number
  overdue: number
  avg_days_to_resolve: number | null
}

export type ReviewKind =
  | 'escalation_request' | 'wrong_issue' | 'stuck' | 'no_authority' | 'send_back'

export interface ReviewItem {
  id: number
  kind: ReviewKind
  note: string | null
  data: { wrong_type?: string }
  created_at: string
  requester_username: string | null
  requester_full_name: string | null
  issue: Issue
  evidence: MediaItem[]
}

export interface RoleRequest {
  id: number
  user_id: string
  username: string
  full_name: string
  account_created_at: string
  authority_short_name: string
  designation: string
  office: string
  message: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  decision_note: string | null
}

export interface MyRoleRequest {
  id: number
  authority_short_name: string
  designation: string
  status: 'pending' | 'approved' | 'rejected'
  decision_note: string | null
  created_at: string
}

export interface AdminLogRow {
  id: number
  admin_username: string | null
  action: string
  issue_id: string | null
  issue_title: string | null
  target_username: string | null
  reason: string
  data: Record<string, unknown>
  created_at: string
}

export interface TeamMember {
  user_id: string
  username: string
  full_name: string
  avatar_url: string | null
  is_leader: boolean
  joined_at: string
  checked_in_at: string | null
}

export type ReleaseKind = 'busy' | 'needs_authority' | 'wrong_issue'
export type WrongType = 'already_fixed' | 'fake' | 'wrong_location'

export type EmergencyKind = 'fire' | 'gas_leak' | 'building_collapse' | 'live_wire' | 'flood_rescue' | 'other'

export interface EmergencyAlert {
  id: string
  kind: EmergencyKind
  note: string
  lat: number
  lng: number
  address: string
  media: UploadedMedia[]
  status: 'active' | 'over' | 'hidden' | 'expired'
  confirm_count: number
  deny_count: number
  over_count: number
  created_at: string
  expires_at: string
  ended_at?: string | null
  distance_m?: number | null
  is_mine: boolean
  my_response: 'confirm' | 'deny' | 'over' | null
  emergency_contacts?: EmergencyContact[]
  authority_short_name?: string | null
}

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
