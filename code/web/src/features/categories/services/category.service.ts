import { BaseService } from '@/core/api/BaseService'
import type { Category, CategoryGroup } from '@/models'

/** Issue categories and their groups: reading them, and the admins' category editor. */
export class CategoryService extends BaseService {
  getCategories = () =>
    this.select<Category[]>(this.db.from('categories').select('*').order('sort_order'))

  getCategoryGroups = () =>
    this.select<CategoryGroup[]>(this.db.from('category_groups').select('*').order('sort_order'))

  getAllCategories = () =>
    this.select<Category[]>(this.db.from('categories').select('*').order('sort_order'))

  adminSaveCategory = (c: Omit<Category, 'slug'> & { slug: string | null }) =>
    this.rpc<string>('admin_save_category', {
      p_slug: c.slug, p_name: c.name, p_name_bn: c.name_bn, p_icon: c.icon, p_color: c.color,
      p_resolver: c.resolver, p_default_severity: c.default_severity, p_sort_order: c.sort_order, p_is_active: c.is_active,
      p_volunteer_allowed: c.volunteer_allowed, p_duplicate_group: c.duplicate_group, p_group_slug: c.group_slug,
    })
}

export const categoryService = new CategoryService()
