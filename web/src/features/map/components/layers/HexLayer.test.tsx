// @vitest-environment jsdom
// The hexagon layer on a real Leaflet map inside jsdom: hover text and updates in place.
import { hexCell, renderWithQuery } from '@/test/utils'
import { MapContainer } from 'react-leaflet'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HexCell } from '@/models'
import { HexLayer } from '@/features/map/components/layers/HexLayer'
import L from '@/features/map/lib/leaflet'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HexLayer', () => {
  const hexes = (cells: HexCell[]) => (
    <MapContainer center={[23.8, 90.4]} zoom={14} maxZoom={19} style={{ width: 400, height: 400 }}>
      <HexLayer cells={cells} selected={null} onSelect={vi.fn()} />
    </MapContainer>
  )
  const shapes: L.Polygon[] = []
  beforeEach(() => {
    shapes.length = 0
    const addLayer = L.FeatureGroup.prototype.addLayer
    vi.spyOn(L.FeatureGroup.prototype, 'addLayer').mockImplementation(function (this: L.FeatureGroup, layer: L.Layer) {
      if (layer instanceof L.Polygon) shapes.push(layer)
      return addLayer.call(this, layer)
    })
  })
  const tip = (s: L.Polygon) => String(s.getTooltip()?.getContent())

  it('shows how many issues a hexagon holds on hover', () => {
    renderWithQuery(hexes([hexCell({ issue_count: 4, weight: 12.34 })]))
    expect(tip(shapes[0])).toBe('4 active issues · heat 12.3')
  })

  it('updates the hover text when the same hexagon comes back with new numbers', () => {
    const { rerender } = renderWithQuery(hexes([hexCell({ issue_count: 4 })]))
    rerender(hexes([hexCell({ issue_count: 1, weight: 2 })]))
    expect(shapes).toHaveLength(1)
    expect(tip(shapes[0])).toBe('1 active issue · heat 2.0')
  })
})
