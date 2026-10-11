import { useEffect, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { TopBar } from '@/app/layout/TopBar'
import { BottomNav } from '@/app/layout/BottomNav'
import { LeftSidebar } from '@/app/layout/LeftSidebar'
import { ActiveAlerts } from '@/app/layout/ActiveAlerts'
import { RightSidebar } from '@/app/layout/RightSidebar'

export function AppShell() {
  const { pathname } = useLocation()
  useEffect(() => {
    // Braces matter: newer Chrome returns a Promise from scrollTo, which React would treat as a cleanup function.
    window.scrollTo(0, 0)
  }, [pathname])
  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <TopBar />
      <Outlet />
      <BottomNav />
    </div>
  )
}

// ---------- Sidebars for feed-style pages ----------

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

