import { BaseService } from '@/core/api/BaseService'
import type { Comment } from '@/models'

/** Comments under an issue. */
export class CommentService extends BaseService {
  getComments = (issueId: string) =>
    this.select<Comment[]>(this.db.from('comments_v').select('*').eq('issue_id', issueId).order('created_at'))

  addComment = (issueId: string, body: string, parentId: string | null, isUpdate: boolean) =>
    this.rpc<string>('add_comment', { p_issue: issueId, p_body: body, p_parent: parentId, p_is_update: isUpdate })

  editComment = (id: string, body: string) => this.rpc<void>('edit_comment', { p_comment: id, p_body: body })

  deleteComment = (id: string) => this.rpc<void>('delete_comment', { p_comment: id })

  flagComment = (id: string) => this.rpc<void>('flag_comment', { p_comment: id })
}

export const commentService = new CommentService()
