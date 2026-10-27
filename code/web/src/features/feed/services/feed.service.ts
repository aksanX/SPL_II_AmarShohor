import { BaseService } from '@/core/api/BaseService'
import type { FeedScope, FeedSort, Issue } from '@/models'

export interface FeedParams {
  sort: FeedSort
  scope: FeedScope
  category?: string | null
  /** Issues in any of these categories; null = no filter. */
  categories?: string[] | null
  lat?: number | null
  lng?: number | null
  radiusM?: number
  search?: string | null
  limit?: number
  offset?: number
}

/** The issue feed: sorted and filtered pages of issues, and one person's reports. */
export class FeedService extends BaseService {
  getFeed = (p: FeedParams) =>
    this.rpc<Issue[]>('get_feed', {
      p_sort: p.sort,
      p_scope: p.scope,
      p_category: p.category ?? null,
      p_lat: p.lat ?? null,
      p_lng: p.lng ?? null,
      p_radius_m: p.radiusM ?? 5000,
      p_search: p.search ?? null,
      p_limit: p.limit ?? 20,
      p_offset: p.offset ?? 0,
      p_categories: p.categories ?? null,
    })

  getUserIssues = (username: string, offset = 0) =>
    this.rpc<Issue[]>('get_user_issues', { p_username: username, p_limit: 20, p_offset: offset })
}

export const feedService = new FeedService()
