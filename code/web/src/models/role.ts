// Admin, city admin and official roles, and what the admins review.
import type { Issue } from './issue'
import type { MediaItem } from './media'

/** admin = super admin (everywhere); city_admin = moderates one City Corporation's area (0045). */
export type AppRole = 'admin' | 'city_admin' | 'official'

/** A person a super admin found by username or name, to appoint (0077). */
export interface PersonMatch {
  username: string
  full_name: string
  avatar_url: string | null
  area_name: string
  /** Roles they already have, comma-separated (e.g. "official"), or null. */
  roles: string | null
  /** Signed up as an official and not approved (waiting or rejected). */
  pending_official: boolean
}

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
  /** When the super admins were asked to decide it: nobody in the area may (no City Corporation, no area admin, or their own case). */
  passed_up_at: string | null
  /** No area admin may take it: it is for the super admins. */
  needs_super_admin: boolean
  /** The area's name for display, e.g. "Dhaka North". */
  city_area: string | null
  /**
   * Why it is with the super admins (0048); null while it is with the area admin. 'waited' (left too long)
   * comes only from a database without 0078, which keeps those cases with the area admin.
   */
  super_reason: 'no_city_corporation' | 'no_admin' | 'own_report' | 'waited' | null
  /** When the area admin's clock started on it (opened, handed to a newly appointed admin, or restarted after a miss). */
  clock_from: string
  /** How often it passed city_admin_hours undecided; it stays with the area admin (0078). */
  missed_count: number
}

/** One area's row in the super admin's overview of the area admins (0047). area_id null: outside every City Corporation. */
export interface AreaOverviewRow {
  area_id: string | null
  area: string
  short_name: string | null
  admins: { username: string; full_name: string }[]
  open_cases: number
  /** Open cases that already missed a deadline (0078). */
  overdue_cases: number
  /** Verified emergencies waiting for an evidence check. */
  pending_emergencies: number
  /** Cases this area's admins decided in the last 30 days, and their average time to decide. */
  decided_30d: number
  avg_hours_to_decide: number | null
  last_action_at: string | null
  /** Deadlines this area's admin missed in the last 30 days (0078). */
  missed_30d: number
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
