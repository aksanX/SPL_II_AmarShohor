// What the map shows: pins, hexagons, heat points and the dropped-pin area summary.
import type { IssueStatus, Severity } from './issue'
import type { MediaType } from './media'

export interface MapIssue {
  id: string
  title: string
  category: string
  category_color: string
  category_icon: string
  severity: Severity
  status: IssueStatus
  lat: number
  lng: number
  upvote_count: number
  confirmation_count: number
  validation_score: number
  validation_threshold: number
  created_at: string
  thumb_path: string | null
  thumb_type: MediaType | null
}

/** One of the top issues behind a hexagon (hex_issues), with the hexagon's exact total. */
export interface HexIssue extends MapIssue {
  total: number
}

export interface HexCell {
  hex: GeoJSON.Polygon
  weight: number
  issue_count: number
  top_category: string
}

export interface HeatPoint {
  lat: number
  lng: number
  weight: number
  /** Issues merged into this point (0027). Missing on a database without 0027. */
  issue_count?: number
}

export interface AreaSummary {
  radius_m: number
  active: number
  unverified: number
  resolved: number
  heat: number
  heat_per_km2: number
  categories: { category: string; count: number; heat: number }[]
  hottest: { id: string; title: string; category: string; status: IssueStatus; heat: number; distance_m: number }[]
}

/** The part of the map in view, in degrees; what the map calls are asked about. */
export interface BBox { minLng: number; minLat: number; maxLng: number; maxLat: number }
