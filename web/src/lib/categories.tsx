import {
  Bug, Building2, CircleHelp, Construction, Droplets, Lamp, PackageX, Trash2, TriangleAlert, Waves,
  type LucideIcon,
} from 'lucide-react'

// Icon names come from categories.icon in the database.
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
  'circle-help': CircleHelp,
}

export function CategoryIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = ICONS[icon] ?? CircleHelp
  return <Icon className={className} aria-hidden />
}
