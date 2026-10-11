import { useEffect, useRef } from 'react'
import { Polygon, useMap } from 'react-leaflet'
import L from '@/features/map/lib/leaflet'
import { hexBreaks, hexColor, hexKey } from '@/features/map/lib/hexGrid'
import type { HexCell } from '@/models'

/** Hover text for a hexagon, so its number can be read without clicking it. */
const hexTooltip = (c: HexCell) =>
  `${c.issue_count} active issue${c.issue_count === 1 ? '' : 's'} · heat ${Number(c.weight).toFixed(1)}`

/**
 * Hexagon grid: every validated open issue counted once in the hexagon that contains it.
 * Hexagons that stay in view are only recoloured; new ones fade in and ones that left the view are removed,
 * so the grid doesn't pop on every pan.
 */
export function HexLayer({ cells, selected, onSelect }: {
  cells: HexCell[]
  /** The hexagon whose issues are listed, outlined on the map. */
  selected: HexCell | null
  onSelect: (cell: HexCell) => void
}) {
  const map = useMap()
  const groupRef = useRef<L.FeatureGroup | null>(null)
  const shapesRef = useRef(new Map<string, { shape: L.Polygon; cell: HexCell }>())
  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])

  useEffect(() => {
    const group = L.featureGroup().addTo(map)
    const shapes = shapesRef.current
    groupRef.current = group
    return () => {
      group.remove()
      groupRef.current = null
      shapes.clear()
    }
  }, [map])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    const shapes = shapesRef.current
    const breaks = hexBreaks(cells)
    const seen = new Set<string>()
    for (const cell of cells) {
      const key = hexKey(cell)
      seen.add(key)
      const style = { color: '#7f1d1d', weight: 0.6, fillColor: hexColor(Number(cell.weight), breaks), fillOpacity: 0.62 }
      const tip = hexTooltip(cell)
      const old = shapes.get(key)
      if (old) {
        old.cell = cell
        old.shape.setStyle(style)
        old.shape.setTooltipContent(tip)
        continue
      }
      const shape = L.polygon(
        cell.hex.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number]),
        { ...style, className: 'hex-cell-new' },
      )
      shape.bindTooltip(tip, { sticky: true, direction: 'top' })
      const entry = { shape, cell }
      shape.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        onSelectRef.current(entry.cell)
      })
      shapes.set(key, entry)
      group.addLayer(shape)
    }
    for (const [key, { shape }] of shapes) {
      if (!seen.has(key)) {
        group.removeLayer(shape)
        shapes.delete(key)
      }
    }
  }, [cells])

  return selected && (
    <Polygon
      positions={selected.hex.coordinates[0].map(([lng, lat]) => [lat, lng] as [number, number])}
      interactive={false}
      pathOptions={{ color: '#1a6fd1', weight: 3, fill: false }}
    />
  )
}
