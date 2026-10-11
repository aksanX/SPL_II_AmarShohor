// Pins and counting: how many issues are in view, the pin limit, cluster labels and when a pin must be redrawn.
import type { HeatPoint, HexCell, MapIssue } from '@/models'

export type MapResult =
  | { kind: 'pins'; data: MapIssue[] }
  | { kind: 'hex'; data: HexCell[] }
  | { kind: 'heat'; data: HeatPoint[] }

/** "N issues in view". Hexagons and heat points each merge several issues, so their counts are added up. */
export function countInView(result: MapResult | undefined) {
  if (!result) return 0
  if (result.kind === 'hex') return result.data.reduce((s, c) => s + c.issue_count, 0)
  // A database without 0027 sends no issue_count: count each point as one issue, as before.
  if (result.kind === 'heat') return result.data.reduce((s, p) => s + (p.issue_count ?? 1), 0)
  return result.data.length
}

/** The most pins map_issues returns for one view (its `limit`, migration 0013). */
export const MAX_PINS = 2000

/** True when Pins mode got as many pins as the database sends, so some may be missing. */
export const pinsCapped = (result: MapResult | undefined) => result?.kind === 'pins' && result.data.length >= MAX_PINS

/** Text in a cluster bubble: up to 999 as is, then "1.2k" / "12k" so the number fits the circle. */
export function clusterLabel(n: number) {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '')}k`
}

/** Everything a pin's icon and popup show: a pin is only rebuilt when one of these changes. */
export const pinSignature = (i: MapIssue) =>
  [i.lat, i.lng, i.status, i.title, i.category_color, i.upvote_count, i.confirmation_count, i.thumb_path, i.thumb_type].join('|')
