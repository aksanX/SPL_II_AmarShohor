import { BaseService } from '@/core/api/BaseService'
import type { EmergencyAlert, EmergencyContact, EmergencyKind, EmergencyReview, LiveAlert, UploadedMedia } from '@/models'

/** Emergency alerts: raising one, responding on site, reviews, and officials' updates. */
export class EmergencyService extends BaseService {
  getActiveAlerts = (lat: number | null = null, lng: number | null = null, radiusM = 25000) =>
    this.rpc<EmergencyAlert[]>('get_active_alerts', { p_lat: lat, p_lng: lng, p_radius_m: radiusM })

  getAlert = async (id: string): Promise<EmergencyAlert | null> => {
    const rows = await this.rpc<EmergencyAlert[]>('get_alert', { p_alert: id })
    return rows[0] ?? null
  }

  getEmergencyContactsAt = async (lat: number, lng: number) => {
    const rows = await this.rpc<{ authority_short_name: string; emergency_contacts: EmergencyContact[] }[]>(
      'emergency_contacts_at', { p_lat: lat, p_lng: lng })
    return rows[0] ?? null
  }

  createEmergencyAlert = (
    kind: EmergencyKind, note: string, lat: number, lng: number, address: string, media: UploadedMedia[], issueId: string | null = null,
  ) =>
    this.rpc<string>('create_emergency_alert', {
      p_kind: kind, p_note: note, p_lat: lat, p_lng: lng, p_address: address, p_media: this.mediaJson(media), p_issue: issueId,
    })

  /** The issue's active emergency alert, else the one that verified it as an emergency. */
  getIssueAlert = async (issueId: string) => {
    const rows = await this.rpc<{
      id: string; kind: EmergencyKind; status: EmergencyAlert['status']; confirm_count: number; created_at: string
      verified_at: string | null; issue_verified_at: string | null
    }[]>(
      'get_issue_alert', { p_issue: issueId })
    return rows[0] ?? null
  }

  respondEmergency = (
    id: string, response: 'confirm' | 'deny' | 'over',
    pos?: { lat: number; lng: number; accuracy: number } | null, media: UploadedMedia[] = [], seen: EmergencyKind | null = null,
  ) =>
    this.rpc<string>('respond_emergency', {
      p_alert: id, p_response: response, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null,
      p_accuracy: pos?.accuracy ?? null, p_media: this.mediaJson(media), p_seen: seen,
    })

  /** Verified emergencies waiting for this admin's or official's look at the evidence. */
  getEmergencyReviews = () => this.rpc<EmergencyReview[]>('get_emergency_reviews')

  reviewEmergency = (id: string, keep: boolean, note: string) =>
    this.rpc<void>('review_emergency', { p_alert: id, p_keep: keep, p_note: note })

  /** Admins: every live alert. Officials: the live alerts of their area. */
  getLiveAlerts = () => this.rpc<LiveAlert[]>('get_live_alerts')

  postAlertUpdate = (id: string, note: string) => this.rpc<void>('post_alert_update', { p_alert: id, p_note: note })

  officialEndAlert = (id: string, note: string) => this.rpc<void>('official_end_alert', { p_alert: id, p_note: note })

  adminHideAlert = (id: string, reason: string) => this.rpc<void>('admin_hide_alert', { p_alert: id, p_reason: reason })

  officialLogDamage = (
    id: string, d: { title: string; category: string; description: string; size: 'small' | 'medium' | 'large' | null }, media: UploadedMedia[],
  ) =>
    this.rpc<string>('official_log_damage', {
      p_alert: id, p_title: d.title, p_category: d.category, p_description: d.description,
      p_media: this.mediaJson(media), p_size: d.size,
    })
}

export const emergencyService = new EmergencyService()
