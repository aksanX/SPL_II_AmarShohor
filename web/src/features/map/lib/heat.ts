// Heat: the heat layer's colours and scale, and the plain-language heat level of an area.
import type { HeatPoint } from '@/models'
import { HEX_COLORS } from '@/features/map/lib/hexGrid'

/** Colour stops of the Heat layer (intensity 0–1 → colour), shared with its legend so the two always match. */
export const HEAT_GRADIENT: Record<number, string> = { 0.2: '#2c7bb6', 0.4: '#abd9e9', 0.6: '#ffffbf', 0.8: '#fdae61', 1: '#d7191c' }

/** The legend bar: the same colours, low to high. Sorted by stop, because JavaScript lists the key 1 before 0.2. */
export const HEAT_LEGEND_CSS = `linear-gradient(90deg,${Object.entries(HEAT_GRADIENT)
  .sort(([a], [b]) => Number(a) - Number(b)).map(([, c]) => c).join(',')})`

/** Heat intensity cap: twice the 95th percentile weight (at least 1), so one hotspot can't wash out the rest. */
export function heatMax(points: HeatPoint[]) {
  // Missing weights are left out: one NaN makes the sort order, and so the 95th percentile, meaningless.
  const weights = points.map((p) => Number(p.weight)).filter(Number.isFinite).sort((a, b) => a - b)
  const p95 = weights.length ? weights[Math.floor(weights.length * 0.95)] : 1
  return Math.max(p95 * 2, 1)
}

// Heat per km² → plain-language level. One typical validated issue (medium severity, a little evidence)
// is worth about 3 heat, so "moderate" ≈ a couple of active issues per km².
export const HEAT_LEVELS = [
  { max: 0, label: 'No active issues', color: '#9ca3af' },
  { max: 1.5, label: 'Low', color: HEX_COLORS[1] },
  { max: 5, label: 'Moderate', color: HEX_COLORS[2] },
  { max: 12, label: 'High', color: HEX_COLORS[3] },
  { max: Infinity, label: 'Severe', color: HEX_COLORS[4] },
]

/** Level for an area. Rounded heat per km² can be 0.00 for one small issue in a big circle, so the count decides "none". */
export function areaLevel(active: number, heatPerKm2: number) {
  if (active === 0) return HEAT_LEVELS[0]
  // A missing value (NaN) matches no level and used to crash the panel: treat it as the lowest heat.
  const perKm2 = Number.isFinite(heatPerKm2) ? Math.max(heatPerKm2, 0.01) : 0.01
  return HEAT_LEVELS.find((l) => perKm2 <= l.max)!
}
