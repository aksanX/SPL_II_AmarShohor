import { useQuery } from '@tanstack/react-query'
import { useInvalidateIssue } from '@/features/issues/hooks/useInvalidateIssue'
import { useAppSettings } from '@/shared/settings/useAppSettings'
import { useToast } from '@/shared/hooks/useToast'
import { issueService } from '@/features/issues/services/issue.service'
import type { Issue } from '@/models'

/** What people who saw it say it really is. Hidden when nobody disagrees with the category. */
export function CategoryVotes({ issue }: { issue: Issue }) {
  const settings = useAppSettings().data
  const invalidate = useInvalidateIssue()
  const toast = useToast()
  const votes = useQuery({ queryKey: ['category_votes', issue.id], queryFn: () => issueService.getCategoryVotes(issue.id) })
  const list = votes.data ?? []
  if (!list.length) return null

  async function withdraw() {
    try {
      await issueService.withdrawCategorySuggestion(issue.id)
      votes.refetch()
      invalidate(issue.id)
    } catch (e) {
      toast.error(e)
    }
  }

  return (
    <section className="card space-y-2 p-4">
      <h2 className="font-bold">Is the category right?</h2>
      <p className="text-sm text-muted">
        Listed as <strong className="text-ink">{issue.category_name ?? 'no category'}</strong>, but people say it may be:
      </p>
      <ul className="space-y-1 text-sm">
        {list.map((v) => (
          <li key={v.category} className="flex items-center justify-between gap-2">
            <span>{v.name}</span>
            <span className="text-xs text-muted">{v.votes} {v.votes === 1 ? 'person' : 'people'}{v.on_site > 0 && `, ${v.on_site} on site`}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">
        It changes when {settings?.recategorize_confirms ?? 2} people on site, or {settings?.recategorize_votes ?? 3} in total,
        agree. Disagreements go to an admin.
      </p>
      {list.some((v) => v.mine) && (
        <button className="btn-ghost px-2 py-1 text-xs" onClick={withdraw}>Withdraw my suggestion</button>
      )}
    </section>
  )
}
