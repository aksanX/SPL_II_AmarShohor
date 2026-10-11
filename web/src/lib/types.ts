// Shapes returned by the database views / functions (supabase/migrations/0003).
// Being moved into src/models/, one file per domain; this file re-exports them meanwhile.
export type * from '@/models'
import type { Issue, MediaItem, UploadedMedia } from '@/models'

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
