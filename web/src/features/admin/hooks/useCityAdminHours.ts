import { useAppSettings } from '@/shared/settings/useAppSettings'

/** Hours an area admin has to decide a case before it counts as a missed deadline (setting city_admin_hours). */
export function useCityAdminHours() {
  return useAppSettings().data?.city_admin_hours ?? 24
}
