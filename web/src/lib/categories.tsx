import {
  Bike, Biohazard, Bug, Building2, Bus, Cable, Car, CircleHelp, Construction, Dog, Droplet, Droplets, Factory, Fence,
  Flame, Footprints, HardHat, House, Lamp, PackageX, ShieldAlert, Signpost, Siren, SprayCan, Store, TrafficCone, Trash2,
  TreePine, Trees, TriangleAlert, Volume2, Waves, Wind, Zap,
  type LucideIcon,
} from 'lucide-react'
import type { Category, CategoryGroup, EmergencyKind } from './types'

// Categories whose worst case is a known emergency kind, with the question that tells them apart.
// Any other issue can still become an emergency ("other").
export const EMERGENCY_VERSION: Record<string, { kind: EmergencyKind; question: string }> = {
  downed_power_line: { kind: 'live_wire', question: 'Is the wire sparking, live, or touching water or people?' },
  exposed_wiring: { kind: 'live_wire', question: 'Is the wire sparking, live, or touching water or people?' },
  unsafe_structure: { kind: 'building_collapse', question: 'Is it collapsing right now, or is anyone trapped?' },
  chemical_spill: { kind: 'toxic_release', question: 'Is it giving off fumes or smoke, or on fire?' },
  fire_hazard: { kind: 'fire', question: 'Is something already burning?' },
}

// Icon names come from categories.icon / category_groups.icon in the database. The admin picks one of these.
const ICONS: Record<string, LucideIcon> = {
  construction: Construction,
  waves: Waves,
  droplets: Droplets,
  droplet: Droplet,
  'trash-2': Trash2,
  'package-x': PackageX,
  bug: Bug,
  lamp: Lamp,
  'triangle-alert': TriangleAlert,
  'building-2': Building2,
  'tree-pine': TreePine,
  trees: Trees,
  zap: Zap,
  cable: Cable,
  'traffic-cone': TrafficCone,
  signpost: Signpost,
  bike: Bike,
  bus: Bus,
  car: Car,
  footprints: Footprints,
  fence: Fence,
  'hard-hat': HardHat,
  house: House,
  store: Store,
  'spray-can': SprayCan,
  factory: Factory,
  wind: Wind,
  biohazard: Biohazard,
  'volume-2': Volume2,
  dog: Dog,
  flame: Flame,
  siren: Siren,
  'shield-alert': ShieldAlert,
  'circle-help': CircleHelp,
}

export const ICON_NAMES = Object.keys(ICONS)

export function CategoryIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = ICONS[icon] ?? CircleHelp
  return <Icon className={className} aria-hidden />
}

// ---------- Groups: group → subgroup → category ----------

export interface SubgroupNode { group: CategoryGroup; categories: Category[] }
export interface GroupNode { group: CategoryGroup; subgroups: SubgroupNode[] }

/** Nests the categories under their subgroups and groups. Subgroups and groups left empty are dropped. */
export function buildCategoryTree(groups: CategoryGroup[], categories: Category[]): GroupNode[] {
  return groups
    .filter((g) => !g.parent_slug)
    .map((g) => ({
      group: g,
      subgroups: groups
        .filter((s) => s.parent_slug === g.slug)
        .map((s) => ({ group: s, categories: categories.filter((c) => c.group_slug === s.slug) }))
        .filter((s) => s.categories.length > 0),
    }))
    .filter((g) => g.subgroups.length > 0)
}

/**
 * The categories to show for the picked groups and subgroups, or null for "everything".
 * Inside a group, no subgroup picked means all of its subgroups.
 */
export function categoriesForSelection(tree: GroupNode[], groupSlugs: string[], subSlugs: string[]): string[] | null {
  if (groupSlugs.length === 0) return null
  const slugs: string[] = []
  for (const node of tree) {
    if (!groupSlugs.includes(node.group.slug)) continue
    const picked = node.subgroups.filter((s) => subSlugs.includes(s.group.slug))
    for (const sub of picked.length ? picked : node.subgroups) slugs.push(...sub.categories.map((c) => c.slug))
  }
  return slugs
}

/** The main group (e.g. "Roads, Mobility & Transportation") a category belongs to, if any. */
export function mainGroupOf(slug: string, categories: Category[], groups: CategoryGroup[]): CategoryGroup | undefined {
  const sub = groups.find((g) => g.slug === categories.find((c) => c.slug === slug)?.group_slug)
  return sub && (sub.parent_slug ? groups.find((g) => g.slug === sub.parent_slug) : sub)
}
