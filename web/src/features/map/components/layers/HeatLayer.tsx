import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from '@/features/map/lib/leaflet'
// The plugin expects the global L from lib/leaflet, so it is imported after it.
import 'leaflet.heat'
import { HEAT_GRADIENT, heatMax } from '@/features/map/lib/heat'
import type { HeatPoint } from '@/models'

const HEAT_OPTIONS = {
  radius: 22,
  blur: 18,
  maxZoom: 16,
  minOpacity: 0.25,
  gradient: HEAT_GRADIENT,
}

/**
 * Smooth kernel heat layer. Intensity is capped at the 95th percentile so one hotspot can't wash out the rest.
 * The same layer is kept and its points swapped in place, so the blur doesn't flash on every pan.
 */
export function HeatLayer({ points }: { points: HeatPoint[] }) {
  const map = useMap()
  const layerRef = useRef<L.HeatLayer | null>(null)

  useEffect(() => {
    const layer = L.heatLayer([], HEAT_OPTIONS)
    layerRef.current = layer
    map.addLayer(layer)
    return () => {
      map.removeLayer(layer)
      layerRef.current = null
    }
  }, [map])

  useEffect(() => {
    const layer = layerRef.current
    if (!layer) return
    layer.setOptions({ ...HEAT_OPTIONS, max: heatMax(points) })
    layer.setLatLngs(points.map((p) => [p.lat, p.lng, Number(p.weight)] as [number, number, number]))
  }, [points])

  return null
}
