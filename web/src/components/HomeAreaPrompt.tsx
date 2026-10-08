import { useQueryClient } from '@tanstack/react-query'
import { House, LocateFixed, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useMySettings } from '../hooks/useData'
import { useToast } from '../hooks/useToast'
import { updateMySettings } from '../lib/api'
import { getCurrentPosition } from '../lib/geo'
import { Spinner } from './ui'

const DISMISS_KEY = 'amarshohor:home-prompt-dismissed'

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Asks people who haven't set a home area to set one. Votes and flags on issues within 3 km of home count
 * 1.5×, and the "Near me" feed and volunteer board work without GPS. Shown until set or dismissed.
 */
export function HomeAreaPrompt() {
  const { user } = useAuth()
  const settings = useMySettings()
  const qc = useQueryClient()
  const toast = useToast()
  const [dismissed, setDismissed] = useState(wasDismissed)
  const [busy, setBusy] = useState(false)

  const s = settings.data
  if (!user || !s || s.home_lat !== null || dismissed) return null

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* storage unavailable: hidden for this visit only */
    }
  }

  async function useMyLocation() {
    if (!s) return
    setBusy(true)
    try {
      const p = await getCurrentPosition()
      await updateMySettings(p.lat, p.lng, s.default_anonymous, s.show_on_leaderboard)
      await qc.invalidateQueries({ queryKey: ['my_settings'] })
      toast.success('Home area saved. Only you can see it.')
    } catch (e) {
      toast.error(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card flex flex-wrap items-center gap-3 border-brand/40 p-3">
      <House className="size-6 shrink-0 text-brand" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Set your home area</p>
        <p className="text-xs text-muted">
          Your votes count more for problems near home, because neighbours know their area best. Only you can see it.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={useMyLocation}>
          {busy ? <Spinner className="size-3.5 text-brand-ink" /> : <LocateFixed className="size-3.5" />} I'm home now
        </button>
        <Link to="/settings" className="btn-soft px-3 py-1.5 text-xs">Pick on map</Link>
        <button aria-label="Not now" className="rounded-full p-1 text-muted hover:bg-card-hover" onClick={dismiss}>
          <X className="size-4" />
        </button>
      </div>
    </section>
  )
}
