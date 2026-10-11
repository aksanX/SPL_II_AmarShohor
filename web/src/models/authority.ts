// City Corporations (authorities), their public record and emergency numbers.

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

export interface EmergencyContact {
  label: string
  phone: string
}
