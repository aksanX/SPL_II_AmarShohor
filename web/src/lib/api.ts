import { supabase } from '@/core/supabase'
import type {
  EmergencyAlert, EmergencyContact, EmergencyKind, EmergencyReview, LiveAlert, UploadedMedia,
} from '@/models'

import { AppError } from '@/core/api/AppError'

export { AppError }
const toAppError = AppError.from

import { moderationService } from '@/features/admin/services/moderation.service'
export const { getReviewQueue, getAreaOverview, getAdminLog, adminSetRoute, adminDecideEscalation, adminDecideWrongReport, adminDecideAppeal, adminDecideCategory, adminDismissReview, adminRemoveAssignee, adminRequestHelp, adminReferIssue, canAdminIssue, getUnusedUploads } = moderationService

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
/** Settle a category dispute; category null = keep the current one. */
// ---------- spam & appeals ----------

// ---------- "Is this still there?" ----------

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
