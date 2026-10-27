import { useQuery } from '@tanstack/react-query'
import { ClipboardList } from 'lucide-react'
import { Empty, PageSpinner } from '@/shared/ui'
import { moderationService } from '@/features/admin/services/moderation.service'
import { ReviewCard } from '@/features/admin/tabs/review-queue/ReviewCard'
import { SuperAdminQueue } from '@/features/admin/tabs/review-queue/SuperAdminQueue'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { EmergencyReviews } from '@/features/emergency/components/EmergencyReviews'
import { LiveEmergencies } from '@/features/emergency/components/LiveEmergencies'

export function ReviewQueue() {
  const { isAdmin, cityAdminOf } = useAuth()
  const q = useQuery({ queryKey: ['review_queue'], queryFn: moderationService.getReviewQueue })
  if (q.isLoading) return <PageSpinner />
  if (q.error) return <Empty title="Couldn't load the queue">{(q.error as Error).message}</Empty>
  const items = q.data ?? []

  return (
    <div className="space-y-3">
      <LiveEmergencies title={isAdmin ? 'Live emergencies' : `Live emergencies in ${cityAdminOf?.area}`} />
      <EmergencyReviews />
      {isAdmin ? <SuperAdminQueue items={items} /> : items.length
        ? items.map((r) => <ReviewCard key={r.id} item={r} />)
        : (
          <Empty icon={<ClipboardList className="size-8" />} title="Nothing to decide">
            New cases in {cityAdminOf?.area} appear here when a volunteer, official or resident asks for a decision.
          </Empty>
        )}
    </div>
  )
}
