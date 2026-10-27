import { BaseService } from '@/core/api/BaseService'
import type { Authority, AuthorityRecord, EmergencyContact, Issue } from '@/models'

export interface AuthorityInput {
  id: string | null
  name: string
  shortName: string
  area: GeoJSON.Polygon | GeoJSON.MultiPolygon
  hotline: string
  complaintUrl: string
  emergencyContacts: EmergencyContact[]
  dueCritical: number
  dueHigh: number
  dueMedium: number
  dueLow: number
  isActive: boolean
  kind: Authority['kind']
  /** Official email domain for official sign-ups, e.g. dncc.gov.bd (0061). */
  emailDomain: string
}

/** City Corporations: their list and public record, officials' tasks, and the admins' editor for them. */
export class AuthorityService extends BaseService {
  getAuthorities = () =>
    this.select<Authority[]>(this.db.from('authorities_v').select('*').order('short_name'))

  getAuthorityRecords = () =>
    this.select<AuthorityRecord[]>(this.db.from('authority_record_v').select('*').order('short_name'))

  getAuthorityTasks = (tab: 'new' | 'active' | 'overdue' | 'done') =>
    this.rpc<Issue[]>('get_authority_tasks', { p_tab: tab })

  requestSendBack = (id: string, note: string) => this.rpc<void>('request_send_back', { p_issue: id, p_note: note })

  adminSaveAuthority = (a: AuthorityInput) =>
    this.rpc<string>('admin_save_authority', {
      p_id: a.id, p_name: a.name, p_short_name: a.shortName, p_area: a.area, p_hotline: a.hotline,
      p_complaint_url: a.complaintUrl, p_emergency_contacts: a.emergencyContacts,
      p_due_critical: a.dueCritical, p_due_high: a.dueHigh, p_due_medium: a.dueMedium, p_due_low: a.dueLow,
      p_is_active: a.isActive, p_kind: a.kind, p_email_domain: a.emailDomain,
    })

  /** Super admins: join picked areas (e.g. thanas) into one outline for a City Corporation (0046). */
  mergeAreas = (areas: (GeoJSON.Polygon | GeoJSON.MultiPolygon)[]) =>
    this.rpc<GeoJSON.Polygon>('merge_areas', { p_areas: areas })
}

export const authorityService = new AuthorityService()
