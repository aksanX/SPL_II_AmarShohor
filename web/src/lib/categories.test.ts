import { describe, expect, it } from 'vitest'
import { buildCategoryTree, categoriesForSelection, mainGroupOf } from './categories'
import type { Category, CategoryGroup } from './types'

function group(slug: string, parent: string | null = null): CategoryGroup {
  return { slug, parent_slug: parent, code: slug, name: slug, name_bn: '', description: '', icon: 'circle', color: '#000', sort_order: 0 }
}

function category(slug: string, groupSlug: string | null): Category {
  return {
    slug, name: slug, name_bn: '', icon: 'circle', color: '#000', resolver: 'community', default_severity: 'medium',
    sort_order: 0, is_active: true, volunteer_allowed: true, duplicate_group: null, group_slug: groupSlug,
  }
}

// Roads (surface: pothole, crack; lights: streetlight) · Waste (street: litter; an empty subgroup) · an empty main group
const GROUPS = [
  group('roads'), group('surface', 'roads'), group('lights', 'roads'),
  group('waste'), group('street-waste', 'waste'), group('empty-sub', 'waste'),
  group('empty-main'),
]
const CATEGORIES = [
  category('pothole', 'surface'), category('crack', 'surface'), category('streetlight', 'lights'),
  category('litter', 'street-waste'), category('ungrouped', null), category('waste-general', 'waste'),
]
const TREE = buildCategoryTree(GROUPS, CATEGORIES)

describe('buildCategoryTree', () => {
  it('nests categories under their subgroups and main groups', () => {
    expect(TREE.map((g) => g.group.slug)).toEqual(['roads', 'waste'])
    expect(TREE[0].subgroups.map((s) => [s.group.slug, s.categories.map((c) => c.slug)])).toEqual([
      ['surface', ['pothole', 'crack']],
      ['lights', ['streetlight']],
    ])
  })

  it('drops subgroups and main groups with nothing in them', () => {
    expect(TREE[1].subgroups.map((s) => s.group.slug)).toEqual(['street-waste'])
    expect(TREE.some((g) => g.group.slug === 'empty-main')).toBe(false)
  })

  it('is empty when there are no categories', () => {
    expect(buildCategoryTree(GROUPS, [])).toEqual([])
  })
})

describe('categoriesForSelection', () => {
  it('means "everything" when no group is picked', () => {
    expect(categoriesForSelection(TREE, [], [])).toBeNull()
    expect(categoriesForSelection(TREE, [], ['lights'])).toBeNull()
  })

  it('takes every subgroup of a group when none of its subgroups is picked', () => {
    expect(categoriesForSelection(TREE, ['roads'], [])).toEqual(['pothole', 'crack', 'streetlight'])
  })

  it('takes only the picked subgroups inside a group', () => {
    expect(categoriesForSelection(TREE, ['roads'], ['lights'])).toEqual(['streetlight'])
  })

  it('handles each picked group on its own', () => {
    // Lights narrows Roads; Waste has no picked subgroup, so all of Waste counts.
    expect(categoriesForSelection(TREE, ['roads', 'waste'], ['lights'])).toEqual(['streetlight', 'litter'])
  })

  it('finds nothing for a group that no longer exists (an old link)', () => {
    expect(categoriesForSelection(TREE, ['gone'], [])).toEqual([])
  })
})

describe('mainGroupOf', () => {
  it('finds the main group through the subgroup', () => {
    expect(mainGroupOf('pothole', CATEGORIES, GROUPS)?.slug).toBe('roads')
    expect(mainGroupOf('litter', CATEGORIES, GROUPS)?.slug).toBe('waste')
  })

  it('returns the group itself when a category sits directly in a main group', () => {
    expect(mainGroupOf('waste-general', CATEGORIES, GROUPS)?.slug).toBe('waste')
  })

  it('finds nothing for ungrouped or unknown categories', () => {
    expect(mainGroupOf('ungrouped', CATEGORIES, GROUPS)).toBeUndefined()
    expect(mainGroupOf('no-such-category', CATEGORIES, GROUPS)).toBeUndefined()
  })
})
