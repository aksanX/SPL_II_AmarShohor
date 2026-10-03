import { supabase } from './supabase'
import type {
  AppSettings, Category, Comment, DuplicateCandidate, FeedScope, FeedSort, FlagReason, HeatPoint,
  HexCell, Issue, IssueEvent, LeaderboardRow, MapIssue, MediaItem, MySettings, Notification,
  Profile, Rating, Severity, UploadedMedia,
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

export const findDuplicates = (lat: number, lng: number, category: string) =>
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
  })

export const updateIssue = (id: string, title: string, description: string, category: string, address: string) =>
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
export const acceptTask = (id: string) => rpc<void>('accept_task', { p_issue: id })
export const postProgress = (id: string, note: string, media: UploadedMedia[]) =>
  rpc<void>('post_progress', { p_issue: id, p_note: note, p_media: mediaJson(media) })
export const releaseTask = (id: string, reason: string) => rpc<void>('release_task', { p_issue: id, p_reason: reason })
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
