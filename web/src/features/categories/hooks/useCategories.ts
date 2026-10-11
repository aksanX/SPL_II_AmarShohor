import { useQuery } from '@tanstack/react-query'
import { getCategories, getCategoryGroups } from '@/lib/api'

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: getCategories, staleTime: Infinity })
}

export function useCategoryGroups() {
  return useQuery({ queryKey: ['category_groups'], queryFn: getCategoryGroups, staleTime: Infinity })
}
