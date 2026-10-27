import { BaseService } from '@/core/api/BaseService'
import type { Issue, Rating, ReleaseKind, UploadedMedia, WrongType } from '@/models'

/** Volunteer tasks: taking one, progress, handing it back, the fix and its review, and ratings. */
export class VolunteerService extends BaseService {
  setVolunteerMode = (on: boolean) => this.rpc<void>('set_volunteer_mode', { p_on: on })

  acceptTask = (id: string, teamSize = 1) => this.rpc<void>('accept_task', { p_issue: id, p_team_size: teamSize })

  /** The volunteer leading a task opens it to a team and nearby volunteers are told (0066). Returns how many. */
  askForVolunteers = (id: string) => this.rpc<number>('ask_for_volunteers', { p_issue: id })

  /** "We have enough people": no more open team spots. */
  closeTeamRecruiting = (id: string) => this.rpc<void>('close_team_recruiting', { p_issue: id })

  /** The leader removes a member who hasn't checked in at the site (0067). */
  removeTeamMember = (id: string, userId: string) =>
    this.rpc<void>('remove_team_member', { p_issue: id, p_user: userId })

  /** Open tasks an admin asked nearby volunteers to help with. */
  getHelpRequests = () => this.rpc<{ issue_id: string; requested_at: string }[]>('get_help_requests')

  postProgress = (id: string, note: string, media: UploadedMedia[]) =>
    this.rpc<void>('post_progress', { p_issue: id, p_note: note, p_media: this.mediaJson(media) })

  releaseTask = (id: string, reason: string, kind: ReleaseKind = 'busy', media: UploadedMedia[] = [], wrongType: WrongType | null = null) =>
    this.rpc<void>('release_task', { p_issue: id, p_reason: reason, p_kind: kind, p_media: this.mediaJson(media), p_wrong_type: wrongType })

  submitResolution = (id: string, note: string, lat: number | null, lng: number | null, accuracyM: number | null, media: UploadedMedia[]) =>
    this.rpc<void>('submit_resolution', { p_issue: id, p_note: note, p_lat: lat, p_lng: lng, p_accuracy_m: accuracyM, p_media: this.mediaJson(media) })

  reviewResolution = (id: string, isFixed: boolean, lat?: number | null, lng?: number | null) =>
    this.rpc<string>('review_resolution', { p_issue: id, p_is_fixed: isFixed, p_lat: lat ?? null, p_lng: lng ?? null })

  rateVolunteer = (id: string, stars: number, review: string) =>
    this.rpc<void>('rate_volunteer', { p_issue: id, p_stars: stars, p_review: review })

  getOpenTasks = (lat: number | null, lng: number | null, radiusM: number, category: string | null) =>
    this.rpc<Issue[]>('get_open_tasks', { p_lat: lat, p_lng: lng, p_radius_m: radiusM, p_category: category })

  getMyTasks = () => this.rpc<Issue[]>('get_my_tasks')

  getRatingsFor = (volunteerId: string) =>
    this.select<Rating[]>(this.db.from('ratings_v').select('*').eq('volunteer_id', volunteerId).order('created_at', { ascending: false }).limit(20))
}

export const volunteerService = new VolunteerService()
