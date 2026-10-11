import { BaseService } from '@/core/api/BaseService'
import type { AdminLogRow, AreaOverviewRow, ReviewItem, Route, UnusedUpload } from '@/models'

/** The admins' review queue and the decisions they make on issues. */
export class ModerationService extends BaseService {
  getReviewQueue = () => this.rpc<ReviewItem[]>('get_review_queue')

  /** Super admins: how each area admin is keeping up (0047). */
  getAreaOverview = () => this.rpc<AreaOverviewRow[]>('get_area_overview')

  /** who (super admins): null = everyone, 'super' = super admins, or an area's name = that area's admins (0051). */
  getAdminLog = (limit = 100, who: string | null = null) =>
    this.rpc<AdminLogRow[]>('get_admin_log', { p_limit: limit, p_who: who })

  adminSetRoute = (id: string, route: Exclude<Route, 'pending'>, reason: string, category: string | null = null) =>
    this.rpc<void>('admin_set_route', { p_issue: id, p_route: route, p_reason: reason, p_category: category })

  adminDecideEscalation = (id: string, approve: boolean, reason: string) =>
    this.rpc<void>('admin_decide_escalation', { p_issue: id, p_approve: approve, p_reason: reason })

  adminDecideWrongReport = (id: string, outcome: 'close' | 'hide' | 'lie', reason: string) =>
    this.rpc<void>('admin_decide_wrong_report', { p_issue: id, p_outcome: outcome, p_reason: reason })

  adminDecideAppeal = (id: string, restore: boolean, reason: string) =>
    this.rpc<void>('admin_decide_appeal', { p_issue: id, p_restore: restore, p_reason: reason })

  adminDecideCategory = (id: string, category: string | null, reason: string) =>
    this.rpc<void>('admin_decide_category', { p_issue: id, p_category: category, p_reason: reason })

  adminDismissReview = (reviewId: number, reason: string) =>
    this.rpc<void>('admin_dismiss_review', { p_review: reviewId, p_reason: reason })

  adminRemoveAssignee = (id: string, reason: string) =>
    this.rpc<void>('admin_remove_assignee', { p_issue: id, p_reason: reason })

  adminRequestHelp = (id: string) => this.rpc<number>('admin_request_help', { p_issue: id })

  adminReferIssue = (id: string, authorityId: string, reason: string) =>
    this.rpc<void>('admin_refer_issue', { p_issue: id, p_authority: authorityId, p_reason: reason })

  /** May the viewer use the admin tools on this issue? (super admin, or city admin of its area) */
  canAdminIssue = (id: string) => this.rpc<boolean>('can_admin_issue', { p_issue: id })

  /** Uploads older than a day that nothing uses (admins only). */
  getUnusedUploads = (limit = 200) => this.rpc<UnusedUpload[]>('admin_unused_uploads', { p_limit: limit })
}

export const moderationService = new ModerationService()
