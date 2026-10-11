import { useQuery } from '@tanstack/react-query'
import { categoryService } from '@/features/categories/services/category.service'

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: categoryService.getCategories, staleTime: Infinity })
}

export function useCategoryGroups() {
  return useQuery({ queryKey: ['category_groups'], queryFn: categoryService.getCategoryGroups, staleTime: Infinity })
}
