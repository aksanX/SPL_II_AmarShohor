import { supabase } from './supabase'
import type {
  AdminLogRow, AppSettings, Authority, AuthorityRecord, Category, Comment,
  DuplicateCandidate, EmergencyAlert, EmergencyContact, EmergencyKind, FeedScope, FeedSort, FlagReason, HeatPoint,
  HexCell, Issue, IssueEvent, LeaderboardRow, MapIssue, MediaItem, MyRoleRequest, MySettings, Notification,
  Profile, Rating, ReleaseKind, ReviewItem, RoleRequest, Route, Severity, TeamMember, UploadedMedia, UserRole,
  WrongType,
} from './types'

/** Error raised by the database. `code` is the HINT set in the SQL (e.g. DUPLICATE_FOUND). */
export class AppError extends Error {
  code: string | null
  constructor(message: string, code: string | null) {
    super(message)
    this.code = code
  }
}

type PgError = { message: string; hint?: string | null; code?: string }

function toAppError(error: PgError): AppError {
  if (error.message?.includes('Failed to fetch')) {
    return new AppError('Network problem — check your connection and try again.', 'NETWORK')
  }
  return new AppError(error.message, error.hint ?? null)
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw toAppError(error)
  return data as T
}

async function select<T>(query: PromiseLike<{ data: unknown; error: PgError | null }>): Promise<T> {
  const { data, error } = await query
  if (error) throw toAppError(error)
  return data as T
}

const mediaJson = (media: UploadedMedia[]) => media.map((m) => ({ path: m.path, type: m.type }))

// ---------- reference data ----------
export const getCategories = () =>
  select<Category[]>(supabase.from('categories').select('*').order('sort_order'))

export const getAppSettings = () =>
  select<AppSettings>(supabase.from('app_settings').select('*').single())

export const getPlatformStats = () =>
  rpc<{ reported: number; validated: number; in_progress: number; resolved: number; volunteers: number }>('platform_stats')

// ---------- feed & issues ----------
export interface FeedParams {
  sort: FeedSort
  scope: FeedScope
  category?: string | null
  lat?: number | null
  lng?: number | null
  radiusM?: number
  search?: string | null
  limit?: number
  offset?: number
}

export const getFeed = (p: FeedParams) =>
  rpc<Issue[]>('get_feed', {
    p_sort: p.sort,
    p_scope: p.scope,
    p_category: p.category ?? null,
    p_lat: p.lat ?? null,
    p_lng: p.lng ?? null,
    p_radius_m: p.radiusM ?? 5000,
    p_search: p.search ?? null,
    p_limit: p.limit ?? 20,
    p_offset: p.offset ?? 0,
  })

export async function getIssue(id: string): Promise<Issue | null> {
  const rows = await rpc<Issue[]>('get_issue', { p_issue: id })
  return rows[0] ?? null
}

export const getUserIssues = (username: string, offset = 0) =>
  rpc<Issue[]>('get_user_issues', { p_username: username, p_limit: 20, p_offset: offset })

export const getIssueMedia = (issueId: string) =>
  select<(MediaItem & { storage_path: string; event_id: number | null; created_at: string })[]>(
    supabase.from('issue_media_v').select('*').eq('issue_id', issueId).order('created_at'),
  )

export const getIssueEvents = (issueId: string) =>
  select<IssueEvent[]>(supabase.from('issue_events_v').select('*').eq('issue_id', issueId).order('created_at'))

export const findDuplicates = (lat: number, lng: number, category: string | null) =>
  rpc<DuplicateCandidate[]>('find_nearby_duplicates', { p_lat: lat, p_lng: lng, p_category: category })

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

export const createIssue = (i: NewIssueInput) =>
  rpc<string>('create_issue', {
    p_title: i.title,
    p_description: i.description,
    p_category: i.category,
    p_lat: i.lat,
    p_lng: i.lng,
    p_accuracy_m: i.accuracyM,
    p_location_source: i.locationSource,
    p_address: i.address,
    p_is_anonymous: i.isAnonymous,
    p_media: mediaJson(i.media),
    p_skip_duplicate_check: i.skipDuplicateCheck,
    p_size: i.size,
  })

export const updateIssue = (id: string, title: string, description: string, category: string | null, address: string) =>
  rpc<void>('update_issue', { p_issue: id, p_title: title, p_description: description, p_category: category, p_address: address })

export const deleteIssue = (id: string) => rpc<string[]>('delete_issue', { p_issue: id })

// ---------- community signals ----------
export const toggleVote = (id: string, lat?: number | null, lng?: number | null) =>
  rpc<{ voted: boolean }>('toggle_vote', { p_issue: id, p_lat: lat ?? null, p_lng: lng ?? null })

export const confirmIssue = (id: string, lat: number, lng: number, accuracyM: number | null, note: string, media: UploadedMedia[]) =>
  rpc<void>('confirm_issue', { p_issue: id, p_lat: lat, p_lng: lng, p_accuracy_m: accuracyM, p_note: note, p_media: mediaJson(media) })

export const flagIssue = (id: string, reason: FlagReason, details: string) =>
  rpc<void>('flag_issue', { p_issue: id, p_reason: reason, p_details: details })

export const unflagIssue = (id: string) => rpc<void>('unflag_issue', { p_issue: id })

export const voteSeverity = (id: string, severity: Severity) =>
  rpc<void>('vote_severity', { p_issue: id, p_severity: severity })

export const toggleFollow = (id: string) => rpc<boolean>('toggle_follow', { p_issue: id })

// ---------- comments ----------
export const getComments = (issueId: string) =>
  select<Comment[]>(supabase.from('comments_v').select('*').eq('issue_id', issueId).order('created_at'))

export const addComment = (issueId: string, body: string, parentId: string | null, isUpdate: boolean) =>
  rpc<string>('add_comment', { p_issue: issueId, p_body: body, p_parent: parentId, p_is_update: isUpdate })

export const editComment = (id: string, body: string) => rpc<void>('edit_comment', { p_comment: id, p_body: body })
export const deleteComment = (id: string) => rpc<void>('delete_comment', { p_comment: id })
export const flagComment = (id: string) => rpc<void>('flag_comment', { p_comment: id })

// ---------- volunteers ----------
export const setVolunteerMode = (on: boolean) => rpc<void>('set_volunteer_mode', { p_on: on })
export const acceptTask = (id: string, teamSize = 1) => rpc<void>('accept_task', { p_issue: id, p_team_size: teamSize })
export const postProgress = (id: string, note: string, media: UploadedMedia[]) =>
  rpc<void>('post_progress', { p_issue: id, p_note: note, p_media: mediaJson(media) })
export const releaseTask = (id: string, reason: string, kind: ReleaseKind = 'busy', media: UploadedMedia[] = [], wrongType: WrongType | null = null) =>
  rpc<void>('release_task', { p_issue: id, p_reason: reason, p_kind: kind, p_media: mediaJson(media), p_wrong_type: wrongType })
export const submitResolution = (id: string, note: string, lat: number, lng: number, accuracyM: number | null, media: UploadedMedia[]) =>
  rpc<void>('submit_resolution', { p_issue: id, p_note: note, p_lat: lat, p_lng: lng, p_accuracy_m: accuracyM, p_media: mediaJson(media) })
export const reviewResolution = (id: string, isFixed: boolean, lat?: number | null, lng?: number | null) =>
  rpc<string>('review_resolution', { p_issue: id, p_is_fixed: isFixed, p_lat: lat ?? null, p_lng: lng ?? null })
export const rateVolunteer = (id: string, stars: number, review: string) =>
  rpc<void>('rate_volunteer', { p_issue: id, p_stars: stars, p_review: review })

export const getOpenTasks = (lat: number | null, lng: number | null, radiusM: number, category: string | null) =>
  rpc<Issue[]>('get_open_tasks', { p_lat: lat, p_lng: lng, p_radius_m: radiusM, p_category: category })
export const getMyTasks = () => rpc<Issue[]>('get_my_tasks')

export const getLeaderboard = () =>
  select<LeaderboardRow[]>(supabase.from('leaderboard_v').select('*').order('rank').limit(100))

export const getRatingsFor = (volunteerId: string) =>
  select<Rating[]>(supabase.from('ratings_v').select('*').eq('volunteer_id', volunteerId).order('created_at', { ascending: false }).limit(20))

// ---------- map ----------
export interface BBox { minLng: number; minLat: number; maxLng: number; maxLat: number }

export const getMapIssues = (b: BBox, category: string | null, layers: string[]) =>
  rpc<MapIssue[]>('map_issues', {
    p_min_lng: b.minLng, p_min_lat: b.minLat, p_max_lng: b.maxLng, p_max_lat: b.maxLat,
    p_category: category, p_layers: layers,
  })

export const getHeatmapHex = (b: BBox, cellM: number, category: string | null) =>
  rpc<HexCell[]>('heatmap_hex', {
    p_min_lng: b.minLng, p_min_lat: b.minLat, p_max_lng: b.maxLng, p_max_lat: b.maxLat,
    p_cell_m: cellM, p_category: category,
  })

export const getHeatmapPoints = (b: BBox, category: string | null) =>
  rpc<HeatPoint[]>('heatmap_points', {
    p_min_lng: b.minLng, p_min_lat: b.minLat, p_max_lng: b.maxLng, p_max_lat: b.maxLat, p_category: category,
  })

// ---------- profile & settings ----------
export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const rows = await select<Profile[]>(supabase.from('profiles').select('*').eq('username', username).limit(1))
  return rows[0] ?? null
}

export async function getProfileById(id: string): Promise<Profile | null> {
  const rows = await select<Profile[]>(supabase.from('profiles').select('*').eq('id', id).limit(1))
  return rows[0] ?? null
}

export async function getMySettings(): Promise<MySettings | null> {
  const rows = await select<MySettings[]>(supabase.from('my_settings_v').select('*').limit(1))
  return rows[0] ?? null
}

export const updateMySettings = (homeLat: number | null, homeLng: number | null, defaultAnonymous: boolean, showOnLeaderboard: boolean) =>
  rpc<void>('update_my_settings', {
    p_home_lat: homeLat, p_home_lng: homeLng,
    p_default_anonymous: defaultAnonymous, p_show_on_leaderboard: showOnLeaderboard,
  })

export const updateMyProfile = (username: string, fullName: string, bio: string, areaName: string, avatarUrl: string | null) =>
  rpc<void>('update_my_profile', {
    p_username: username, p_full_name: fullName, p_bio: bio, p_area_name: areaName, p_avatar_url: avatarUrl,
  })

// ---------- notifications ----------
export const getNotifications = () =>
  select<Notification[]>(supabase.from('notifications_v').select('*').order('created_at', { ascending: false }).limit(50))

export const markNotificationsRead = (ids: number[] | null = null) =>
  rpc<void>('mark_notifications_read', { p_ids: ids })

// ---------- v2: teams ----------
export const getTeam = (id: string) => rpc<TeamMember[]>('get_team', { p_issue: id })
export const joinTeam = (id: string) => rpc<void>('join_team', { p_issue: id })
export const leaveTeam = (id: string) => rpc<void>('leave_team', { p_issue: id })
export const checkIn = (id: string, lat: number, lng: number, accuracyM: number | null) =>
  rpc<void>('check_in', { p_issue: id, p_lat: lat, p_lng: lng, p_accuracy_m: accuracyM })
export const offerLead = (id: string, memberId: string) => rpc<void>('offer_lead', { p_issue: id, p_member: memberId })
export const acceptLead = (id: string) => rpc<void>('accept_lead', { p_issue: id })
export const getOpenTeams = (lat: number | null, lng: number | null, radiusM: number) =>
  rpc<Issue[]>('get_open_teams', { p_lat: lat, p_lng: lng, p_radius_m: radiusM })

// ---------- v2: City Corporation ----------
export const getAuthorities = () =>
  select<Authority[]>(supabase.from('authorities_v').select('*').order('short_name'))
export const getAuthorityRecords = () =>
  select<AuthorityRecord[]>(supabase.from('authority_record_v').select('*').order('short_name'))
export const getAuthorityTasks = (tab: 'new' | 'active' | 'overdue' | 'done') =>
  rpc<Issue[]>('get_authority_tasks', { p_tab: tab })
export const setComplaintRef = (id: string, ref: string) => rpc<void>('set_complaint_ref', { p_issue: id, p_ref: ref })
export const requestSendBack = (id: string, note: string) => rpc<void>('request_send_back', { p_issue: id, p_note: note })

// ---------- v2: roles ----------
export const getRoles = () => select<UserRole[]>(supabase.from('roles_v').select('*').order('granted_at'))
export const getRolesOf = (userId: string) => select<UserRole[]>(supabase.from('roles_v').select('*').eq('user_id', userId))
export const requestOfficialRole = (authorityId: string, designation: string, office: string, message: string) =>
  rpc<void>('request_official_role', { p_authority: authorityId, p_designation: designation, p_office: office, p_message: message })
export async function getMyRoleRequest(): Promise<MyRoleRequest | null> {
  const rows = await rpc<MyRoleRequest[]>('get_my_role_request')
  return rows[0] ?? null
}

// ---------- v2: admin ----------
export const getReviewQueue = () => rpc<ReviewItem[]>('get_review_queue')
export const getRoleRequests = (status: 'pending' | 'approved' | 'rejected' = 'pending') =>
  rpc<RoleRequest[]>('get_role_requests', { p_status: status })
export const getAdminLog = (limit = 100) => rpc<AdminLogRow[]>('get_admin_log', { p_limit: limit })
export const adminSetRoute = (id: string, route: Exclude<Route, 'pending'>, reason: string, category: string | null = null) =>
  rpc<void>('admin_set_route', { p_issue: id, p_route: route, p_reason: reason, p_category: category })
export const adminDecideEscalation = (id: string, approve: boolean, reason: string) =>
  rpc<void>('admin_decide_escalation', { p_issue: id, p_approve: approve, p_reason: reason })
export const adminDecideWrongReport = (id: string, outcome: 'close' | 'hide' | 'lie', reason: string) =>
  rpc<void>('admin_decide_wrong_report', { p_issue: id, p_outcome: outcome, p_reason: reason })
export const adminDismissReview = (reviewId: number, reason: string) =>
  rpc<void>('admin_dismiss_review', { p_review: reviewId, p_reason: reason })
export const adminRemoveAssignee = (id: string, reason: string) =>
  rpc<void>('admin_remove_assignee', { p_issue: id, p_reason: reason })
export const adminRequestHelp = (id: string) => rpc<number>('admin_request_help', { p_issue: id })
export const adminInviteVolunteer = (id: string, username: string) =>
  rpc<void>('admin_invite_volunteer', { p_issue: id, p_username: username })
export const adminDecideRoleRequest = (id: number, approve: boolean, reason: string) =>
  rpc<void>('admin_decide_role_request', { p_request: id, p_approve: approve, p_reason: reason })
export const adminGrantAdmin = (username: string, reason: string) =>
  rpc<void>('admin_grant_admin', { p_username: username, p_reason: reason })
export const adminRevokeRole = (username: string, role: 'admin' | 'official', reason: string) =>
  rpc<void>('admin_revoke_role', { p_username: username, p_role: role, p_reason: reason })

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
}
export const adminSaveAuthority = (a: AuthorityInput) =>
  rpc<string>('admin_save_authority', {
    p_id: a.id, p_name: a.name, p_short_name: a.shortName, p_area: a.area, p_hotline: a.hotline,
    p_complaint_url: a.complaintUrl, p_emergency_contacts: a.emergencyContacts,
    p_due_critical: a.dueCritical, p_due_high: a.dueHigh, p_due_medium: a.dueMedium, p_due_low: a.dueLow,
    p_is_active: a.isActive,
  })

export const getAllCategories = () =>
  select<Category[]>(supabase.from('categories').select('*').order('sort_order'))
export const adminSaveCategory = (c: Omit<Category, 'slug'> & { slug: string | null }) =>
  rpc<string>('admin_save_category', {
    p_slug: c.slug, p_name: c.name, p_name_bn: c.name_bn, p_icon: c.icon, p_color: c.color,
    p_resolver: c.resolver, p_default_severity: c.default_severity, p_sort_order: c.sort_order, p_is_active: c.is_active,
  })
export const adminUpdateSettings = (changes: Record<string, number>) =>
  rpc<void>('admin_update_settings', { p_changes: changes })

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
export const createEmergencyAlert = (kind: EmergencyKind, note: string, lat: number, lng: number, address: string, media: UploadedMedia[]) =>
  rpc<string>('create_emergency_alert', {
    p_kind: kind, p_note: note, p_lat: lat, p_lng: lng, p_address: address, p_media: mediaJson(media),
  })
export const respondEmergency = (id: string, response: 'confirm' | 'deny' | 'over', lat?: number | null, lng?: number | null) =>
  rpc<string>('respond_emergency', { p_alert: id, p_response: response, p_lat: lat ?? null, p_lng: lng ?? null })
