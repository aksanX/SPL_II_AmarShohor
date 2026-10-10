// The map's calls to the database: the time filter is sent only when it is set, so the app also works on a
// database without migration 0034. supabase.rpc is replaced, so nothing is really called.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAreaSummary, getHeatmapHex, getHeatmapPoints, getHexIssues, getMapIssues } from './api'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({ supabase: { rpc: vi.fn() } }))
const rpc = vi.mocked(supabase.rpc)
const BOX = { minLng: 90.3, minLat: 23.7, maxLng: 90.5, maxLat: 23.9 }
const HEX: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[90.4, 23.8], [90.41, 23.8], [90.4, 23.81], [90.4, 23.8]]] }
const argsOf = () => rpc.mock.calls[0][1] as Record<string, unknown>

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: [], error: null } as never)
})

describe('time filter in map calls', () => {
  it('sends no p_days for all time, exactly as before 0034', async () => {
    await getHeatmapHex(BOX, 400, null)
    expect(rpc).toHaveBeenCalledWith('heatmap_hex', {
      p_min_lng: 90.3, p_min_lat: 23.7, p_max_lng: 90.5, p_max_lat: 23.9, p_cell_m: 400, p_category: null,
    })
  })

  it('sends p_days for "last 7 days"', async () => {
    await getHeatmapHex(BOX, 400, 'roads', 7)
    expect(argsOf()).toMatchObject({ p_category: 'roads', p_days: 7 })
  })

  it('is passed by every map call', async () => {
    await getMapIssues(BOX, null, ['active'], 30)
    await getHeatmapPoints(BOX, null, 30)
    await getHexIssues(HEX, 400, null, 20, 30)
    await getAreaSummary(23.8, 90.4, 1000, null, 30)
    expect(rpc.mock.calls.map(([fn, args]) => [fn, (args as Record<string, unknown>).p_days])).toEqual([
      ['map_issues', 30], ['heatmap_points', 30], ['hex_issues', 30], ['area_heat_summary', 30],
    ])
  })

  it('leaves it out of every call when there is no time filter', async () => {
    await getMapIssues(BOX, null, ['active'])
    await getHeatmapPoints(BOX, null, null)
    await getHexIssues(HEX, 400, null)
    await getAreaSummary(23.8, 90.4, 1000, null)
    expect(rpc.mock.calls.every(([, args]) => !('p_days' in (args as object)))).toBe(true)
  })
})

describe('database errors', () => {
  it('turns a database error into an error the page can show', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function heatmap_hex does not exist', code: '42883' } } as never)
    await expect(getHeatmapHex(BOX, 400, null, 7)).rejects.toThrow()
  })
})
