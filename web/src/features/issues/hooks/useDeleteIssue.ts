import { useNavigate } from 'react-router-dom'
import { useToast } from '@/shared/hooks/useToast'
import { issueService } from '@/features/issues/services/issue.service'
import { mediaService } from '@/features/media/services/media.service'
import type { Issue } from '@/models'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'

export function useDeleteIssue() {
  const toast = useToast()
  const invalidate = useInvalidateIssue()
  const navigate = useNavigate()
  return async (issue: Issue, goHome = false) => {
    if (!window.confirm('Delete this report? This cannot be undone.')) return
    try {
      const paths = await issueService.deleteIssue(issue.id)
      await mediaService.deleteFiles(paths).catch(() => undefined)
      toast.success('Report deleted')
      invalidate()
      if (goHome) navigate('/feed')
    } catch (e) {
      toast.error(e)
    }
  }
}
