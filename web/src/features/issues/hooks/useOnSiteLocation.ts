import { useState } from 'react'
import type { Position } from '@/models'
import { distanceM } from '@/shared/geo/distance'
import { locationService } from '@/shared/geo/location.service'

/** Gets a GPS fix and shows how far the user is from the issue. */
export function useOnSiteLocation(target: { lat: number; lng: number }) {
  const [pos, setPos] = useState<Position | null>(null)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locate = async () => {
    setLocating(true)
    setError(null)
    try {
      setPos(await locationService.getCurrentPosition())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLocating(false)
    }
  }
  const distance = pos ? distanceM(pos, target) : null
  return { pos, locating, error, locate, distance }
}
