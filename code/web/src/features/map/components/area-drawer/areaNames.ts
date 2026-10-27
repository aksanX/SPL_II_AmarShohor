// Matching what an admin types to a City Corporation area in the bundled thana and ward files.
import { areaLabel } from '@/features/city-corp/lib/areaLabel'

/** Other spellings and short names people use for an area. */
const AREA_ALIASES: Record<string, string[]> = {
  Chattogram: ['chittagong', 'ctg'], Barishal: ['barisal'], 'Dhaka North': ['dncc'], 'Dhaka South': ['dscc'],
}

/** An area's name and its aliases, lower case. */
export const areaKeys = (a: string) => [a.toLowerCase(), ...(AREA_ALIASES[a] ?? [])]

/**
 * The areas a search could mean: "DNCC" or "Dhaka North City Corporation" -> Dhaka North, and the start of a name
 * ("Dhaka", "Chitta") -> every area it starts.
 */
export function matchAreas(query: string, areas: string[]): string[] {
  const n = areaLabel(query.trim()).toLowerCase()
  if (n.length < 2) return []
  return areas.filter((a) => areaKeys(a).some((k) => n.includes(k) || (n.length >= 3 && k.startsWith(n))))
}
