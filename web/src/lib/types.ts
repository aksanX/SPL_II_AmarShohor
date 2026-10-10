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
  /** The viewer is an official of this issue's City Corporation, or of the area it is in (0031). */
  my_authority_covers: boolean
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
  /** Most people in a team, leader included (0066). */
  team_max_size: number
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
  emergency_verify_confirms: number
  emergency_verify_radius_m: number
  live_capture_seconds: number
  live_issue_evidence: boolean
  max_reports_per_day: number
  max_flags_per_day: number
  rep_false_confirm: number
  /** Hours a city admin has before an open case is passed up to the super admins. */
  city_admin_hours: number
  /** How many hours before that the area admins get a reminder (0049). */
  city_admin_reminder_hours: number
  recategorize_confirms: number
  recategorize_votes: number
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
  author_is_admin: boolean
  author_city_admin_of: string | null
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
  actor_city_admin_of: string | null
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

/** One of the top issues behind a hexagon (hex_issues), with the hexagon's exact total. */
export interface HexIssue extends MapIssue {
  total: number
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
  /** Issues merged into this point (0027). Missing on a database without 0027. */
  issue_count?: number
}

export interface UploadedMedia {
  path: string
  type: MediaType
  /** Live capture code from the in-app camera (sent to the server, which checks and uses it up). */
  token?: string
  /** Set by the server on checked live evidence. */
  live?: boolean
  code?: string
  taken_at?: string
}

export type FeedSort = 'hot' | 'new' | 'top' | 'near'
export type FeedScope = 'all' | 'unverified' | 'validated' | 'resolved' | 'mine' | 'following'

// ---------- v2 ----------

/** admin = super admin (everywhere); city_admin = moderates one City Corporation's area (0045). */
export type AppRole = 'admin' | 'city_admin' | 'official'

export interface UserRole {
  user_id: string
  username: string
  full_name: string
  avatar_url: string | null
  role: AppRole
  authority_id: string | null
  authority_short_name: string | null
  granted_at: string
  /** City admins: the area they look after, e.g. "Dhaka North" (0045). */
  authority_area: string | null
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
  /** Officials sign up with an email at this domain, e.g. dncc.gov.bd. Empty: no official sign-ups (0061). */
  email_domain: string
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
  /** Switched off: no new issues, kept in the record while it still has some (0033). */
  is_active: boolean
}

export type ReviewKind =
  | 'escalation_request' | 'wrong_issue' | 'stuck' | 'no_authority' | 'send_back' | 'category_mismatch' | 'appeal'

export interface ReviewItem {
  id: number
  kind: ReviewKind
  note: string | null
  data: {
    wrong_type?: string
    /** category_mismatch: what people say it is, and how many confirmed it as is. */
    suggestions?: { category: string; votes: number; on_site: number }[]
    confirmed_as_is?: number
  }
  created_at: string
  requester_username: string | null
  requester_full_name: string | null
  issue: Issue
  evidence: MediaItem[]
  /** The City Corporation whose area contains the issue; null when none covers it. */
  city_id: string | null
  city_short_name: string | null
  /** When the super admins were asked to decide it (at once, or after the city admin left it too long). */
  passed_up_at: string | null
  /** No city admin can take it (none there, or left too long): it is for the super admins now. */
  needs_super_admin: boolean
  /** The area's name for display, e.g. "Dhaka North". */
  city_area: string | null
  /** Why it is with the super admins (0048); null while it is with the area admin. */
  super_reason: 'no_city_corporation' | 'no_admin' | 'own_report' | 'waited' | null
  /** When the area admin's clock started on it (opened, or handed to a newly appointed admin). */
  clock_from: string
}

/** One area's row in the super admin's overview of the area admins (0047). area_id null: outside every City Corporation. */
export interface AreaOverviewRow {
  area_id: string | null
  area: string
  short_name: string | null
  admins: { username: string; full_name: string }[]
  open_cases: number
  /** Open longer than city_admin_hours. */
  overdue_cases: number
  /** Verified emergencies waiting for an evidence check. */
  pending_emergencies: number
  /** Cases this area's admins decided in the last 30 days, and their average time to decide. */
  decided_30d: number
  avg_hours_to_decide: number | null
  last_action_at: string | null
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
  email: string
  /** The email is at the City Corporation's official domain. */
  official_email: boolean
  /** Made on the City Corporation sign-up page, not from Settings (0061). */
  via_signup: boolean
}

export interface MyRoleRequest {
  id: number
  authority_short_name: string
  designation: string
  status: 'pending' | 'approved' | 'rejected'
  decision_note: string | null
  created_at: string
  via_signup: boolean
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
  /** Set when the admin who acted is a city admin: their area, e.g. "Dhaka North". */
  admin_city: string | null
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

export type ReleaseKind = 'busy' | 'needs_authority' | 'wrong_issue' | 'send_back'
export type WrongType = 'already_fixed' | 'fake' | 'wrong_location'

export type EmergencyKind = 'fire' | 'gas_leak' | 'building_collapse' | 'live_wire' | 'flood_rescue' | 'toxic_release' | 'other'

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
  /** The issue this alert was raised from, when an existing problem got dangerous. */
  issue_id?: string | null
  issue_title?: string | null
  /** Set once enough people on site confirmed it with live evidence. */
  verified_at?: string | null
  live_evidence?: boolean
  on_site_confirms?: number
  /** Live photos sent with "I see it too". */
  witness_media?: UploadedMedia[]
  /** What I said I see, when I confirmed. */
  my_seen?: EmergencyKind | null
  /** After verification, an admin or the area's officials look at the evidence. */
  review_status?: 'pending' | 'kept' | 'rejected' | null
  review_note?: string | null
  can_review?: boolean
  /** Public notes: City Corporation updates, an official ending it, an admin removing it (0032). */
  updates?: AlertUpdate[]
  /** The viewer is an official of the area: post updates, end the alert, log the damage. */
  can_update?: boolean
  can_end?: boolean
  can_log_damage?: boolean
  /** The viewer is an admin and the alert is still unverified: remove it as fake. */
  can_hide?: boolean
  /** The issue an official logged for the damage left behind. */
  followup_issue_id?: string | null
  followup_issue_title?: string | null
}

export interface AlertUpdate {
  kind: 'update' | 'ended' | 'removed' | 'damage'
  note: string
  created_at: string
  authority: string | null
  by_admin: boolean
}

/** An alert on the admin's or an official's live list. */
export interface LiveAlert {
  id: string
  kind: EmergencyKind
  address: string
  lat: number
  lng: number
  status: EmergencyAlert['status']
  created_at: string
  ended_at: string | null
  verified_at: string | null
  review_status: 'pending' | 'kept' | 'rejected' | null
  confirm_count: number
  deny_count: number
  on_site_confirms: number
  issue_id: string | null
  issue_title: string | null
  authority_short_name: string | null
  last_update: string | null
  last_update_at: string | null
  followup_issue_id: string | null
}

export interface EmergencyReview {
  id: string
  kind: EmergencyKind
  address: string
  lat: number
  lng: number
  verified_at: string
  status: EmergencyAlert['status']
  on_site_confirms: number
  live_items: number
  issue_id: string | null
  issue_title: string | null
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

/** An upload nobody uses any more (admin_unused_uploads). */
export interface UnusedUpload {
  path: string
  size_bytes: number
  uploaded_at: string
}
