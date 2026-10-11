import { supabase } from '@/core/supabase'
import type {
  AdminLogRow, AreaOverviewRow, EmergencyAlert, EmergencyContact, EmergencyKind, EmergencyReview, LiveAlert, ReviewItem, Route, UploadedMedia, UnusedUpload,
} from '@/models'

import { AppError } from '@/core/api/AppError'

export { AppError }
const toAppError = AppError.from

import { roleService } from '@/features/admin/services/role.service'
export const { getRoles, getRolesOf, getMyRoleRequest, getRoleRequests, adminDecideRoleRequest, adminGrantAdmin, adminRevokeRole, adminDeleteAccount, adminGrantCityAdmin } = roleService

import { authorityService } from '@/features/city-corp/services/authority.service'
export const { getAuthorities, getAuthorityRecords, getAuthorityTasks, requestSendBack, adminSaveAuthority, mergeAreas } = authorityService
export type { AuthorityInput } from '@/features/city-corp/services/authority.service'

import { notificationService } from '@/features/notifications/services/notification.service'
export const { getNotifications, markNotificationsRead } = notificationService

import { accountService } from '@/features/settings/services/account.service'
export const { getMySettings, updateMySettings, deleteMyAccount } = accountService

import { profileService } from '@/features/profile/services/profile.service'
export const { isUsernameTaken, getProfileByUsername, getProfileById, updateMyProfile } = profileService

import { mapService } from '@/features/map/services/map.service'
export const { getMapIssues, getHeatmapHex, getHexIssues, getHeatmapPoints, getAreaSummary } = mapService

import { leaderboardService } from '@/features/leaderboard/services/leaderboard.service'
export const { getLeaderboard } = leaderboardService

import { teamService } from '@/features/volunteer/services/team.service'
export const { getTeam, joinTeam, leaveTeam, checkIn, offerLead, acceptLead, getOpenTeams } = teamService

import { volunteerService } from '@/features/volunteer/services/volunteer.service'
export const { setVolunteerMode, acceptTask, askForVolunteers, closeTeamRecruiting, removeTeamMember, getHelpRequests, postProgress, releaseTask, submitResolution, reviewResolution, rateVolunteer, getOpenTasks, getMyTasks, getRatingsFor } = volunteerService

import { commentService } from '@/features/comments/services/comment.service'
export const { getComments, addComment, editComment, deleteComment, flagComment } = commentService

import { issueService } from '@/features/issues/services/issue.service'
export const { getIssue, getIssueMedia, getIssueEvents, findDuplicates, createIssue, updateIssue, deleteIssue, toggleVote, confirmIssue, suggestCategory, withdrawCategorySuggestion, getCategoryVotes, flagIssue, unflagIssue, voteSeverity, toggleFollow, getStillThere, answerStillThere, getMyPostingPause, appealHiddenIssue } = issueService
export type { NewIssueInput } from '@/features/issues/services/issue.service'

import { feedService } from '@/features/feed/services/feed.service'
export const { getFeed, getUserIssues } = feedService
export type { FeedParams } from '@/features/feed/services/feed.service'

import { appSettingsService } from '@/shared/settings/appSettings.service'
export const { getAppSettings, adminUpdateSettings, getPlatformStats } = appSettingsService

import { categoryService } from '@/features/categories/services/category.service'
export const { getCategories, getCategoryGroups, getAllCategories, adminSaveCategory } = categoryService

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw toAppError(error)
  return data as T
}

const mediaJson = (media: UploadedMedia[]) =>
  media.map((m) => (m.token ? { path: m.path, type: m.type, token: m.token } : { path: m.path, type: m.type }))

// ---------- reference data ----------

// ---------- feed & issues ----------

// ---------- community signals ----------

// ---------- comments ----------

// ---------- volunteers ----------

// ---------- map ----------

// ---------- profile & settings ----------

// ---------- notifications ----------

// ---------- v2: teams ----------

// ---------- v2: City Corporation ----------

// ---------- v2: roles ----------

// ---------- v2: admin ----------
export const getReviewQueue = () => rpc<ReviewItem[]>('get_review_queue')
/** Super admins: how each area admin is keeping up (0047). */
export const getAreaOverview = () => rpc<AreaOverviewRow[]>('get_area_overview')
/** who (super admins): null = everyone, 'super' = super admins, or an area's name = that area's admins (0051). */
export const getAdminLog = (limit = 100, who: string | null = null) =>
  rpc<AdminLogRow[]>('get_admin_log', { p_limit: limit, p_who: who })
export const adminSetRoute = (id: string, route: Exclude<Route, 'pending'>, reason: string, category: string | null = null) =>
  rpc<void>('admin_set_route', { p_issue: id, p_route: route, p_reason: reason, p_category: category })
export const adminDecideEscalation = (id: string, approve: boolean, reason: string) =>
  rpc<void>('admin_decide_escalation', { p_issue: id, p_approve: approve, p_reason: reason })
export const adminDecideWrongReport = (id: string, outcome: 'close' | 'hide' | 'lie', reason: string) =>
  rpc<void>('admin_decide_wrong_report', { p_issue: id, p_outcome: outcome, p_reason: reason })
/** Settle a category dispute; category null = keep the current one. */
// ---------- spam & appeals ----------
export const adminDecideAppeal = (id: string, restore: boolean, reason: string) =>
  rpc<void>('admin_decide_appeal', { p_issue: id, p_restore: restore, p_reason: reason })

export const adminDecideCategory = (id: string, category: string | null, reason: string) =>
  rpc<void>('admin_decide_category', { p_issue: id, p_category: category, p_reason: reason })
export const adminDismissReview = (reviewId: number, reason: string) =>
  rpc<void>('admin_dismiss_review', { p_review: reviewId, p_reason: reason })
export const adminRemoveAssignee = (id: string, reason: string) =>
  rpc<void>('admin_remove_assignee', { p_issue: id, p_reason: reason })
export const adminRequestHelp = (id: string) => rpc<number>('admin_request_help', { p_issue: id })
/** May the viewer use the admin tools on this issue? (super admin, or city admin of its area) */
export const canAdminIssue = (id: string) => rpc<boolean>('can_admin_issue', { p_issue: id })

export const adminReferIssue = (id: string, authorityId: string, reason: string) =>
  rpc<void>('admin_refer_issue', { p_issue: id, p_authority: authorityId, p_reason: reason })

// ---------- "Is this still there?" ----------

/** Uploads older than a day that nothing uses (admins only). */
export const getUnusedUploads = (limit = 200) => rpc<UnusedUpload[]>('admin_unused_uploads', { p_limit: limit })

// ---------- v2: emergencies ----------
export const getActiveAlerts = (lat: number | null = null, lng: number | null = null, radiusM = 25000) =>
  rpc<EmergencyAlert[]>('get_active_alerts', { p_lat: lat, p_lng: lng, p_radius_m: radiusM })
export async function getAlert(id: string): Promise<EmergencyAlert | null> {
  const rows = await rpc<EmergencyAlert[]>('get_alert', { p_alert: id })
  return rows[0] ?? null
}
export async function getEmergencyContactsAt(lat: number, lng: number) {
  const rows = await rpc<{ authority_short_name: string; emergency_contacts: EmergencyContact[] }[]>(
    'emergency_contacts_at', { p_lat: lat, p_lng: lng })
  return rows[0] ?? null
}
export const createEmergencyAlert = (
  kind: EmergencyKind, note: string, lat: number, lng: number, address: string, media: UploadedMedia[], issueId: string | null = null,
) =>
  rpc<string>('create_emergency_alert', {
    p_kind: kind, p_note: note, p_lat: lat, p_lng: lng, p_address: address, p_media: mediaJson(media), p_issue: issueId,
  })
/** The issue's active emergency alert, else the one that verified it as an emergency. */
export async function getIssueAlert(issueId: string) {
  const rows = await rpc<{
    id: string; kind: EmergencyKind; status: EmergencyAlert['status']; confirm_count: number; created_at: string
    verified_at: string | null; issue_verified_at: string | null
  }[]>(
    'get_issue_alert', { p_issue: issueId })
  return rows[0] ?? null
}
export const respondEmergency = (
  id: string, response: 'confirm' | 'deny' | 'over',
  pos?: { lat: number; lng: number; accuracy: number } | null, media: UploadedMedia[] = [], seen: EmergencyKind | null = null,
) =>
  rpc<string>('respond_emergency', {
    p_alert: id, p_response: response, p_lat: pos?.lat ?? null, p_lng: pos?.lng ?? null,
    p_accuracy: pos?.accuracy ?? null, p_media: mediaJson(media), p_seen: seen,
  })
/** Verified emergencies waiting for this admin's or official's look at the evidence. */
export const getEmergencyReviews = () => rpc<EmergencyReview[]>('get_emergency_reviews')
export const reviewEmergency = (id: string, keep: boolean, note: string) =>
  rpc<void>('review_emergency', { p_alert: id, p_keep: keep, p_note: note })

/** Admins: every live alert. Officials: the live alerts of their area. */
export const getLiveAlerts = () => rpc<LiveAlert[]>('get_live_alerts')
export const postAlertUpdate = (id: string, note: string) => rpc<void>('post_alert_update', { p_alert: id, p_note: note })
export const officialEndAlert = (id: string, note: string) => rpc<void>('official_end_alert', { p_alert: id, p_note: note })
export const adminHideAlert = (id: string, reason: string) => rpc<void>('admin_hide_alert', { p_alert: id, p_reason: reason })
export const officialLogDamage = (
  id: string, d: { title: string; category: string; description: string; size: 'small' | 'medium' | 'large' | null }, media: UploadedMedia[],
) =>
  rpc<string>('official_log_damage', {
    p_alert: id, p_title: d.title, p_category: d.category, p_description: d.description,
    p_media: mediaJson(media), p_size: d.size,
  })
/** Opens a live capture: a one-time code to stamp on a photo taken right now, here. */
export async function startLiveCapture(lat: number, lng: number, accuracy: number) {
  const rows = await rpc<{ token: string; code: string; expires_at: string }[]>(
    'start_live_capture', { p_lat: lat, p_lng: lng, p_accuracy: accuracy })
  return rows[0]
}
