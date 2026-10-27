import { useQuery } from '@tanstack/react-query'
import type { MediaItem } from '@/models'
import { PageSpinner } from '@/shared/ui'
import { issueService } from '@/features/issues/services/issue.service'
import { MediaGallery } from '@/features/media/components/MediaGallery'

export function Evidence({ issueId }: { issueId: string }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['media', issueId], queryFn: () => issueService.getIssueMedia(issueId) })
  if (isLoading) return <PageSpinner />
  const groups: { kind: MediaItem['kind']; title: string }[] = [
    { kind: 'report', title: 'Original report' },
    { kind: 'confirmation', title: 'On-site confirmations' },
    { kind: 'progress', title: 'Progress' },
    { kind: 'resolution', title: 'After the fix' },
  ]
  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const items: MediaItem[] = data
          .filter((m) => m.kind === g.kind)
          .map((m) => ({ id: m.id, kind: m.kind, media_type: m.media_type, path: m.storage_path }))
        if (!items.length) return null
        return (
          <section key={g.kind}>
            <h3 className="mb-2 text-sm font-semibold">{g.title} ({items.length})</h3>
            <div className="overflow-hidden rounded-lg"><MediaGallery items={items} /></div>
          </section>
        )
      })}
    </div>
  )
}
