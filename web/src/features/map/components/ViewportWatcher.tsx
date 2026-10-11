import { useCallback, useEffect } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import { clampBBox } from '@/features/map/lib/viewport'
import type { BBox } from '@/models'

export interface Viewport { bbox: BBox; zoom: number }

export function ViewportWatcher({ onChange }: { onChange: (v: Viewport) => void }) {
  const map = useMap()
  const emit = useCallback(() => {
    const b = map.getBounds().pad(0.15)
    const r = (n: number) => Math.round(n * 1000) / 1000 // stable cache keys while nudging the map
    onChange({
      zoom: map.getZoom(),
      bbox: clampBBox({ minLng: r(b.getWest()), minLat: r(b.getSouth()), maxLng: r(b.getEast()), maxLat: r(b.getNorth()) }),
    })
  }, [map, onChange])
  useEffect(() => { emit() }, [emit])
  // moveend also fires after every zoom, so it is the only event needed.
  useMapEvents({ moveend: emit })
  return null
}
