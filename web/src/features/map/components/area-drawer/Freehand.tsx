import { useEffect, useRef, useState } from 'react'
import { Polyline, useMap } from 'react-leaflet'
import { type LatLng, simplifyPath } from '@/features/map/lib/outline'

/**
 * Hold the mouse or a finger down and trace around the area, like with a pen. On release the line is smoothed
 * (corners closer than 3 px to the line are dropped) and closed into the outline. The map doesn't pan meanwhile.
 */
export function Freehand({ onDone }: { onDone: (ring: LatLng[]) => void }) {
  const map = useMap()
  const [stroke, setStroke] = useState<LatLng[]>([])
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone }, [onDone])

  useEffect(() => {
    const el = map.getContainer()
    map.dragging.disable()
    map.doubleClickZoom.disable()
    el.style.touchAction = 'none'
    el.style.cursor = 'crosshair'
    let path: { ll: LatLng; px: [number, number] }[] | null = null
    const at = (e: PointerEvent) => {
      const ll = map.mouseEventToLatLng(e)
      const px = map.mouseEventToContainerPoint(e)
      return { ll: [ll.lat, ll.lng] as LatLng, px: [px.x, px.y] as [number, number] }
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      el.setPointerCapture(e.pointerId)
      path = [at(e)]
      setStroke([path[0].ll])
    }
    const move = (e: PointerEvent) => {
      if (!path) return
      const p = at(e)
      const last = path[path.length - 1].px
      if (Math.hypot(p.px[0] - last[0], p.px[1] - last[1]) < 4) return
      path.push(p)
      setStroke(path.map((q) => q.ll))
    }
    const up = () => {
      if (!path) return
      const traced = path
      path = null
      setStroke([])
      const ring = simplifyPath(traced.map((q) => q.px), 3).map((i) => traced[i].ll)
      if (ring.length >= 3) done.current(ring)
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      map.dragging.enable()
      map.doubleClickZoom.enable()
      el.style.touchAction = ''
      el.style.cursor = ''
    }
  }, [map])

  return stroke.length > 1 ? <Polyline positions={stroke} pathOptions={{ color: '#b45309', weight: 3 }} /> : null
}
