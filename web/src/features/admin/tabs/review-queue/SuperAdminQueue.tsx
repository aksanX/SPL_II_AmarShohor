import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Empty, PageSpinner } from '@/shared/ui'
import { moderationService } from '@/features/admin/services/moderation.service'
import type { ReviewItem } from '@/models'
import { ReviewCard } from '@/features/admin/tabs/review-queue/ReviewCard'
import { AreaRow } from '@/features/admin/tabs/review-queue/AreaRow'

/**
 * The super admin doesn't work through every case: each area's admin does. They see what only they can take
 * ("Needs you"), and an overview of how each area admin is keeping up. Opening an area shows its cases.
 */
export function SuperAdminQueue({ items }: { items: ReviewItem[] }) {
  const overview = useQuery({ queryKey: ['area_overview'], queryFn: moderationService.getAreaOverview })
  const [openArea, setOpenArea] = useState<string | null>(null)
  const needsMe = items.filter((r) => r.needs_super_admin)

  return (
    <>
      {needsMe.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 font-bold">Needs you ({needsMe.length})</h2>
          <p className="px-1 text-xs text-muted">Places with no City Corporation or no area admin, and cases an area admin left too long.</p>
          {needsMe.map((r) => <ReviewCard key={r.id} item={r} />)}
        </section>
      )}
      <section className="space-y-2">
        <h2 className="px-1 font-bold">Area admins</h2>
        <p className="px-1 text-xs text-muted">
          Each area's admin decides its cases. Check here that they keep up; open an area to see its cases and step in if needed.
          Their decisions are in the Activity log.
        </p>
        {overview.isLoading && <PageSpinner />}
        {overview.error && <Empty title="Couldn't load the overview">{(overview.error as Error).message}</Empty>}
        <div className="card divide-y divide-line">
          {(overview.data ?? []).map((row) => {
            const key = row.area_id ?? 'outside'
            const cases = items.filter((r) => r.city_id === row.area_id)
            return (
              <div key={key}>
                <AreaRow row={row} open={openArea === key} onToggle={() => setOpenArea(openArea === key ? null : key)} />
                {openArea === key && (
                  <div className="space-y-2 bg-bg p-2">
                    {cases.length
                      ? cases.map((r) => <ReviewCard key={r.id} item={r} />)
                      : <p className="p-2 text-sm text-muted">No open cases in {row.area}.</p>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}
