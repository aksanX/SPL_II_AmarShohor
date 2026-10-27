import { ClipboardList } from 'lucide-react'
import type { ReviewItem } from '@/models'
import { Empty } from '@/shared/ui'
import { ReviewCard } from '@/features/admin/tabs/review-queue/ReviewCard'

/**
 * The super admin doesn't work through every case: each area's admin does. The queue shows only what the super
 * admin has to take ("Needs you"); how each area admin keeps up is on Officials & admins (AreaAdminsOverview).
 */
export function SuperAdminQueue({ items }: { items: ReviewItem[] }) {
  const needsMe = items.filter((r) => r.needs_super_admin)
  if (!needsMe.length) return <Empty icon={<ClipboardList className="size-8" />} title="Nothing needs you" />

  return (
    <section className="space-y-2">
      <h2 className="px-1 font-bold">Needs you ({needsMe.length})</h2>
      {needsMe.map((r) => <ReviewCard key={r.id} item={r} />)}
    </section>
  )
}
