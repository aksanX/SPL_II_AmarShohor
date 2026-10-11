import {
  Bike, Biohazard, Bug, Building2, Bus, Cable, Car, CircleHelp, Construction, Dog, Droplet, Droplets, Factory, Fence,
  Flame, Footprints, HardHat, House, Lamp, PackageX, ShieldAlert, Signpost, Siren, SprayCan, Store, TrafficCone, Trash2,
  TreePine, Trees, TriangleAlert, Volume2, Waves, Wind, Zap,
  type LucideIcon,
} from 'lucide-react'

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
