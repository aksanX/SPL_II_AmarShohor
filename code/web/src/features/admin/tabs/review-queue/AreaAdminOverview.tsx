import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { PageSpinner } from '@/shared/ui'
import { moderationService } from '@/features/admin/services/moderation.service'
import { AreaRow } from '@/features/admin/tabs/review-queue/AreaRow'
import { ReviewCard } from '@/features/admin/tabs/review-queue/ReviewCard'

/**
 * Super admins: how one area's admin keeps up (open and late cases, missed deadlines, "Consider replacing").
 * Opened with the Overview button beside the area admin on Officials & admins. Opening the row shows its cases.
 */
export function AreaAdminOverview({ areaId }: { areaId: string }) {
  const overview = useQuery({ queryKey: ['area_overview'], queryFn: moderationService.getAreaOverview })
  const items = useQuery({ queryKey: ['review_queue'], queryFn: moderationService.getReviewQueue }).data ?? []
  const [showCases, setShowCases] = useState(false)
  if (overview.isLoading) return <PageSpinner />
  if (overview.error) return <p className="p-3 text-sm text-danger">Couldn't load the overview: {(overview.error as Error).message}</p>
  const row = overview.data?.find((r) => r.area_id === areaId)
  if (!row) return null
  const cases = items.filter((r) => r.city_id === areaId)

  return (
    <div className="rounded-lg border border-line">
      <AreaRow row={row} open={showCases} onToggle={() => setShowCases(!showCases)} />
      {showCases && (
        <div className="space-y-2 bg-bg p-2">
          {cases.length
            ? cases.map((r) => <ReviewCard key={r.id} item={r} />)
            : <p className="p-2 text-sm text-muted">No open cases in {row.area}.</p>}
        </div>
      )}
    </div>
  )
}
