import { BaseService } from '@/core/api/BaseService'
import type { AreaSummary, BBox, HeatPoint, HexCell, HexIssue, MapIssue } from '@/models'

// `days` (7, 30, …) keeps only issues reported in the last N days (migration 0034). It is sent only when set,
// so with no time filter these calls also work on a database that doesn't have 0034 yet.
const daysArg = (days: number | null) => (days ? { p_days: days } : {})

/** What the map shows: pins, hexagons and heat points for the view, a hexagon's issues and a dropped pin's area summary. */
export class MapService extends BaseService {
  getMapIssues = (b: BBox, category: string | null, layers: string[], days: number | null = null) =>
    this.rpc<MapIssue[]>('map_issues', {
      p_min_lng: b.minLng, p_min_lat: b.minLat, p_max_lng: b.maxLng, p_max_lat: b.maxLat,
      p_category: category, p_layers: layers, ...daysArg(days),
    })

  getHeatmapHex = (b: BBox, cellM: number, category: string | null, days: number | null = null) =>
    this.rpc<HexCell[]>('heatmap_hex', {
      p_min_lng: b.minLng, p_min_lat: b.minLat, p_max_lng: b.maxLng, p_max_lat: b.maxLat,
      p_cell_m: cellM, p_category: category, ...daysArg(days),
    })

  /** The most serious issues inside one hexagon, plus its exact total. cellM must be the size it was drawn at. */
  getHexIssues = (hex: GeoJSON.Polygon, cellM: number, category: string | null, limit = 20, days: number | null = null) =>
    this.rpc<HexIssue[]>('hex_issues', { p_hex: hex, p_cell_m: cellM, p_category: category, p_limit: limit, ...daysArg(days) })

  getHeatmapPoints = (b: BBox, category: string | null, days: number | null = null) =>
    this.rpc<HeatPoint[]>('heatmap_points', {
      p_min_lng: b.minLng, p_min_lat: b.minLat, p_max_lng: b.maxLng, p_max_lat: b.maxLat, p_category: category,
      ...daysArg(days),
    })

  getAreaSummary = (lat: number, lng: number, radiusM: number, category: string | null, days: number | null = null) =>
    this.rpc<AreaSummary>('area_heat_summary', { p_lat: lat, p_lng: lng, p_radius_m: radiusM, p_category: category, ...daysArg(days) })
}

export const mapService = new MapService()
