import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { BottomNav } from '@/app/layout/BottomNav'
import { TopBar } from '@/app/layout/TopBar'

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
