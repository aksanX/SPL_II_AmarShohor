import {
  Bug, Building2, CircleHelp, Construction, Dog, Droplets, Flame, Lamp, PackageX, TrafficCone, Trash2, TreePine,
  TriangleAlert, Volume2, Waves, Zap,
  type LucideIcon,
} from 'lucide-react'

// Icon names come from categories.icon in the database. The admin picks one of these.
const ICONS: Record<string, LucideIcon> = {
  construction: Construction,
  waves: Waves,
  droplets: Droplets,
  'trash-2': Trash2,
  'package-x': PackageX,
  bug: Bug,
  lamp: Lamp,
  'triangle-alert': TriangleAlert,
  'building-2': Building2,
  'tree-pine': TreePine,
  zap: Zap,
  'traffic-cone': TrafficCone,
  'volume-2': Volume2,
  dog: Dog,
  flame: Flame,
  'circle-help': CircleHelp,
}

export const ICON_NAMES = Object.keys(ICONS)

export function CategoryIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = ICONS[icon] ?? CircleHelp
  return <Icon className={className} aria-hidden />
}
