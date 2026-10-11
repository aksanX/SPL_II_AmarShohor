import { useQueryClient } from '@tanstack/react-query'

export function useInvalidateIssue() {
  const qc = useQueryClient()
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: ['feed'] })
    qc.invalidateQueries({ queryKey: ['tasks'] })
    qc.invalidateQueries({ queryKey: ['map'] })
    if (id) {
      qc.invalidateQueries({ queryKey: ['issue', id] })
      qc.invalidateQueries({ queryKey: ['events', id] })
      qc.invalidateQueries({ queryKey: ['media', id] })
      qc.invalidateQueries({ queryKey: ['team', id] })
      qc.invalidateQueries({ queryKey: ['category_votes', id] })
    }
    qc.invalidateQueries({ queryKey: ['review_queue'] })
    qc.invalidateQueries({ queryKey: ['area_overview'] })
    qc.invalidateQueries({ queryKey: ['authority_tasks'] })
  }
}
