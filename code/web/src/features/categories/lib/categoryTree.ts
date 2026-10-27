// Categories as a tree: main group → subgroup → category, and finding a category's main group.
import type { Category, CategoryGroup } from '@/models'

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
