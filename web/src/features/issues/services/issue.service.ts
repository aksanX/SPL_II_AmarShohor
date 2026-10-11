import { BaseService } from '@/core/api/BaseService'
import type { DuplicateCandidate, FlagReason, Issue, IssueEvent, MediaItem, Severity, StillThereState, UploadedMedia } from '@/models'

export interface NewIssueInput {
  title: string
  description: string
  category: string
  lat: number
  lng: number
  accuracyM: number | null
  locationSource: 'gps' | 'manual'
  address: string
  isAnonymous: boolean
  media: UploadedMedia[]
  skipDuplicateCheck: boolean
  size: 'small' | 'medium' | 'large' | null
}

/** One issue and everything people do with it: report, edit, vote, confirm, flag, follow, appeal. */
export class IssueService extends BaseService {
  getIssue = async (id: string): Promise<Issue | null> => {
    const rows = await this.rpc<Issue[]>('get_issue', { p_issue: id })
    return rows[0] ?? null
  }

  getIssueMedia = (issueId: string) =>
    this.select<(MediaItem & { storage_path: string; event_id: number | null; created_at: string })[]>(
      this.db.from('issue_media_v').select('*').eq('issue_id', issueId).order('created_at'),
    )

  getIssueEvents = (issueId: string) =>
    this.select<IssueEvent[]>(this.db.from('issue_events_v').select('*').eq('issue_id', issueId).order('created_at'))

  findDuplicates = (lat: number, lng: number, category: string | null) =>
    this.rpc<DuplicateCandidate[]>('find_nearby_duplicates', { p_lat: lat, p_lng: lng, p_category: category })

  createIssue = (i: NewIssueInput) =>
    this.rpc<string>('create_issue', {
      p_title: i.title,
      p_description: i.description,
      p_category: i.category,
      p_lat: i.lat,
      p_lng: i.lng,
      p_accuracy_m: i.accuracyM,
      p_location_source: i.locationSource,
      p_address: i.address,
      p_is_anonymous: i.isAnonymous,
      p_media: this.mediaJson(i.media),
      p_skip_duplicate_check: i.skipDuplicateCheck,
      p_size: i.size,
    })

  updateIssue = (id: string, title: string, description: string, category: string | null, address: string) =>
    this.rpc<void>('update_issue', { p_issue: id, p_title: title, p_description: description, p_category: category, p_address: address })

  deleteIssue = (id: string) => this.rpc<string[]>('delete_issue', { p_issue: id })

  toggleVote = (id: string, lat?: number | null, lng?: number | null) =>
    this.rpc<{ voted: boolean }>('toggle_vote', { p_issue: id, p_lat: lat ?? null, p_lng: lng ?? null })

  /** category: null = "yes, it's this category"; another slug = "no, it's actually …". */
  confirmIssue = (
    id: string, lat: number, lng: number, accuracyM: number | null, note: string, media: UploadedMedia[], category: string | null = null,
  ) =>
    this.rpc<void>('confirm_issue', {
      p_issue: id, p_lat: lat, p_lng: lng, p_accuracy_m: accuracyM, p_note: note, p_media: this.mediaJson(media), p_category: category,
    })

  /** "Wrong category / photo doesn't match": what the issue really is. */
  suggestCategory = (id: string, category: string, note: string) =>
    this.rpc<void>('suggest_category', { p_issue: id, p_category: category, p_note: note })

  withdrawCategorySuggestion = (id: string) => this.rpc<void>('withdraw_category_suggestion', { p_issue: id })

  getCategoryVotes = (id: string) =>
    this.rpc<{ category: string; name: string; votes: number; on_site: number; mine: boolean }[]>('get_category_votes', { p_issue: id })

  flagIssue = (id: string, reason: FlagReason, details: string) =>
    this.rpc<void>('flag_issue', { p_issue: id, p_reason: reason, p_details: details })

  unflagIssue = (id: string) => this.rpc<void>('unflag_issue', { p_issue: id })

  voteSeverity = (id: string, severity: Severity) =>
    this.rpc<void>('vote_severity', { p_issue: id, p_severity: severity })

  toggleFollow = (id: string) => this.rpc<boolean>('toggle_follow', { p_issue: id })

  getStillThere = (id: string) => this.rpc<StillThereState | null>('get_still_there', { p_issue: id })

  answerStillThere = (id: string, stillThere: boolean, lat?: number | null, lng?: number | null) =>
    this.rpc<'still_there' | 'recorded' | 'closed'>('answer_still_there', {
      p_issue: id, p_still_there: stillThere, p_lat: lat ?? null, p_lng: lng ?? null,
    })

  /** When this user may post again after repeated hidden reports, or null. */
  getMyPostingPause = () => this.rpc<string | null>('get_my_posting_pause')

  appealHiddenIssue = (id: string, note: string) =>
    this.rpc<void>('appeal_hidden_issue', { p_issue: id, p_note: note })
}

export const issueService = new IssueService()
