import { supabase } from '@/core/supabase'

import { AppError } from '@/core/api/AppError'

export { AppError }
const toAppError = AppError.from

import { emergencyService } from '@/features/emergency/services/emergency.service'
export const { getActiveAlerts, getAlert, getEmergencyContactsAt, createEmergencyAlert, getIssueAlert, respondEmergency, getEmergencyReviews, reviewEmergency, getLiveAlerts, postAlertUpdate, officialEndAlert, adminHideAlert, officialLogDamage } = emergencyService

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

// ---------- "Is this still there?" ----------

// ---------- v2: emergencies ----------

/** Opens a live capture: a one-time code to stamp on a photo taken right now, here. */
export async function startLiveCapture(lat: number, lng: number, accuracy: number) {
  const rows = await rpc<{ token: string; code: string; expires_at: string }[]>(
    'start_live_capture', { p_lat: lat, p_lng: lng, p_accuracy: accuracy })
  return rows[0]
}
