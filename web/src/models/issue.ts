// Reported issues, their history and the feed's sort and filter choices.
import type { MediaItem, MediaType } from './media'

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

export type FeedSort = 'hot' | 'new' | 'top' | 'near'

export type FeedScope = 'all' | 'unverified' | 'validated' | 'resolved' | 'mine' | 'following'

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
