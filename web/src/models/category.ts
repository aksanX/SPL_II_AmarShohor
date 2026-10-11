// Issue categories and the groups they are listed under.
import type { Severity } from './issue'

export interface Category {
  slug: string
  name: string
  name_bn: string
  icon: string
  color: string
  resolver: 'community' | 'authority'
  default_severity: Severity
  sort_order: number
  is_active: boolean
  /** False for dangerous work: never shown to volunteers, always sent to an authority. */
  volunteer_allowed: boolean
  /** Categories in the same group count as the same problem in the duplicate check. */
  duplicate_group: string | null
  /** The subgroup (e.g. "1.1 Road & Sidewalk Conditions") this category belongs to; null = ungrouped. */
  group_slug: string | null
}

/** A top-level group (parent_slug null, e.g. "1. Roads, Mobility & Transportation") or one of its subgroups. */
export interface CategoryGroup {
  slug: string
  parent_slug: string | null
  code: string
  name: string
  name_bn: string
  description: string
  icon: string
  color: string
  sort_order: number
}
