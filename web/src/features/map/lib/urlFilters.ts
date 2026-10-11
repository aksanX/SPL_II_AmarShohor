// The map's filters as they are kept in the link: which pin types and which time range.

export type PinLayer = 'active' | 'unverified' | 'resolved'

export const PIN_LAYERS: readonly PinLayer[] = ['active', 'unverified', 'resolved']

/** ?pins= value → ticked pin types. No ?pins means the default (validated only); ?pins= with nothing ticked stays empty. */
export function parsePinLayers(param: string | null): PinLayer[] {
  if (param === null) return ['active']
  const parts = param.split(',')
  return PIN_LAYERS.filter((l) => parts.includes(l))
}

/** Ticked pin types → ?pins= value, or null for the default so plain links stay clean. Order and repeats don't matter. */
export function pinLayersParam(layers: readonly PinLayer[]): string | null {
  const ordered = PIN_LAYERS.filter((l) => layers.includes(l))
  return ordered.length === 1 && ordered[0] === 'active' ? null : ordered.join(',')
}

/** Time choices in the Filters panel. days = only issues reported in the last N days; null = all time. */
export const TIME_RANGES = [
  { days: null, label: 'All time' },
  { days: 30, label: 'Last 30 days' },
  { days: 7, label: 'Last 7 days' },
] as const

export type TimeRange = (typeof TIME_RANGES)[number]['days']

/** ?days= value → a time choice. Anything else (missing, typo, an edited link) means all time. */
export function parseDays(param: string | null): TimeRange {
  return TIME_RANGES.find((t) => t.days !== null && String(t.days) === param)?.days ?? null
}
