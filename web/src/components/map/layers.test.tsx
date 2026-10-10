// @vitest-environment jsdom
// The pin layer on a real Leaflet map inside jsdom: checks that a new result only touches the pins that changed.
// maxZoom is set by hand: the app gets it from the tile layer, which these tests leave out.
import { MapContainer } from 'react-leaflet'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import L from '../../lib/leaflet'
import type { MapIssue } from '../../lib/types'
import { mapIssue, renderWithQuery } from '../../test/utils'
import { ClusterLayer } from './layers'

vi.mock('../../lib/supabase', () => ({ mediaUrl: (path: string) => `/media/${path}` }))

const added: L.Layer[][] = []
const removed: L.Layer[][] = []
let groupsRemoved = 0

beforeEach(() => {
  added.length = 0
  removed.length = 0
  groupsRemoved = 0
  const proto = L.MarkerClusterGroup.prototype
  const addLayers = proto.addLayers
  const removeLayers = proto.removeLayers
  vi.spyOn(proto, 'addLayers').mockImplementation(function (this: L.MarkerClusterGroup, layers: L.Layer[]) {
    if (layers.length) added.push([...layers]) // the plugin also calls it with [] when it is added to the map
    return addLayers.call(this, layers)
  })
  vi.spyOn(proto, 'removeLayers').mockImplementation(function (this: L.MarkerClusterGroup, layers: L.Layer[]) {
    if (layers.length) removed.push([...layers])
    return removeLayers.call(this, layers)
  })
  const removeLayer = L.Map.prototype.removeLayer
  vi.spyOn(L.Map.prototype, 'removeLayer').mockImplementation(function (this: L.Map, layer: L.Layer) {
    if (layer instanceof L.MarkerClusterGroup) groupsRemoved++
    return removeLayer.call(this, layer)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

const onMap = (issues: MapIssue[], onOpen = vi.fn(), show = true) => (
  <MapContainer center={[23.8, 90.4]} zoom={14} maxZoom={19} style={{ width: 400, height: 400 }}>
    {show && <ClusterLayer issues={issues} onOpen={onOpen} />}
  </MapContainer>
)
const latLngs = (layers: L.Layer[]) => layers.map((m) => (m as L.Marker).getLatLng().lat)

const A = mapIssue({ id: 'a', lat: 23.801 })
const B = mapIssue({ id: 'b', lat: 23.802 })

describe('ClusterLayer', () => {
  it('adds one pin per issue', () => {
    renderWithQuery(onMap([A, B]))
    expect(added).toHaveLength(1)
    expect(latLngs(added[0])).toEqual([23.801, 23.802])
  })

  it('touches nothing when a new result has the same pins', () => {
    const { rerender } = renderWithQuery(onMap([A, B]))
    rerender(onMap([{ ...A }, { ...B }]))
    expect(added).toHaveLength(1)
    expect(removed).toHaveLength(0)
  })

  it('only replaces changed pins, removes gone ones and adds new ones', () => {
    const { rerender } = renderWithQuery(onMap([A, B]))
    const [markerA, markerB] = added[0]
    const C = mapIssue({ id: 'c', lat: 23.803 })
    rerender(onMap([{ ...A, upvote_count: 9 }, C]))
    expect(removed[0]).toEqual([markerA, markerB]) // A changed, B left the view
    expect(latLngs(added[1])).toEqual([23.801, 23.803]) // new A, and C
  })

  it('removes all its pins when it leaves the map (e.g. switching to Hexagons)', () => {
    const { rerender } = renderWithQuery(onMap([A, B]))
    rerender(onMap([A, B], vi.fn(), false))
    expect(groupsRemoved).toBe(1)
  })

  it('escapes the issue title in the popup, so a title cannot run code', () => {
    renderWithQuery(onMap([mapIssue({ id: 'x', title: '<img src=x onerror=alert(1)>' })]))
    const content = String((added[0][0] as L.Marker).getPopup()?.getContent())
    expect(content).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(content).not.toContain('<img src=x')
  })

  it('describes the popup photo for screen readers', () => {
    renderWithQuery(onMap([mapIssue({ id: 'p', title: 'Broken drain', thumb_path: 'u/1.jpg', thumb_type: 'image' })]))
    const content = String((added[0][0] as L.Marker).getPopup()?.getContent())
    expect(content).toContain('src="/media/u/1.jpg" alt="Photo: Broken drain"')
  })

  it('opens the issue from the popup link', () => {
    const onOpen = vi.fn()
    renderWithQuery(onMap([A], onOpen))
    const marker = added[0][0] as L.Marker
    const popup = marker.getPopup()!
    const el = document.createElement('div')
    el.innerHTML = String(popup.getContent())
    vi.spyOn(popup, 'getElement').mockReturnValue(el)
    marker.fire('popupopen', { popup })
    el.querySelector<HTMLAnchorElement>('[data-open]')!.click()
    expect(onOpen).toHaveBeenCalledWith('a')
  })
})
