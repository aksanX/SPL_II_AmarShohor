import { useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { buildCategoryTree, categoriesForSelection } from '../lib/categories'
import { useCategories, useCategoryGroups } from './useData'

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : [])

/**
 * The "View reported issues" filter, kept in the URL of /issues (?groups=roads,utilities&subs=roads_surface)
 * so the sidebar (main groups) and the top of the feed (subcategories) share it.
 */
export function useCategoryFilter() {
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const onIssues = pathname === '/issues'

  const categoriesQuery = useCategories()
  const categories = categoriesQuery.data
  const groupsQuery = useCategoryGroups()
  const tree = useMemo(() => buildCategoryTree(groupsQuery.data ?? [], categories ?? []), [groupsQuery.data, categories])
  const loaded = groupsQuery.isSuccess && categoriesQuery.isSuccess

  // Once loaded, slugs in the URL that are not (or no longer) a group with categories are ignored.
  const groups = onIssues
    ? list(params.get('groups')).filter((g) => !loaded || tree.some((n) => n.group.slug === g))
    : []
  const subs = onIssues ? list(params.get('subs')) : []

  /** Changes the picked groups and subcategories, opening /issues first when needed. */
  function setPicked(g: string[], s: string[]) {
    const next = new URLSearchParams(onIssues ? params : undefined)
    for (const [key, value] of [['groups', g], ['subs', s]] as const) {
      if (value.length) next.set(key, value.join(','))
      else next.delete(key)
    }
    const search = next.toString()
    navigate({ pathname: '/issues', search: search ? `?${search}` : '' }, { replace: onIssues })
  }

  return {
    tree,
    groups,
    subs,
    setPicked,
    onIssues,
    /** Picked groups only turn into categories once the groups and categories have loaded. */
    ready: groups.length === 0 || loaded,
    /** The categories to show, or null for all of them. */
    categories: categoriesForSelection(tree, groups, subs),
  }
}
