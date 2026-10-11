// Shapes returned by the database views / functions (supabase/migrations/0003).
// Being moved into src/models/, one file per domain; this file re-exports them meanwhile.
export type * from '@/models'
import type { EmergencyContact, UploadedMedia } from '@/models'

// ---------- v2 ----------















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
