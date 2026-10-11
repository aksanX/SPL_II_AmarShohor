import type { ReactNode } from 'react'
import { ActiveAlerts } from '@/app/layout/ActiveAlerts'
import { LeftSidebar } from '@/app/layout/LeftSidebar'
import { RightSidebar } from '@/app/layout/RightSidebar'

export function FeedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-7xl gap-6 px-2 py-4 sm:px-4">
      <LeftSidebar />
      <main className="mx-auto w-full min-w-0 max-w-[680px] flex-1">
        <ActiveAlerts />
        {children}
      </main>
      <RightSidebar />
    </div>
  )
}
