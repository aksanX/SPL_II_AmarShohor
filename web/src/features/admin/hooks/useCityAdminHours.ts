import { useAppSettings } from '@/shared/settings/useAppSettings'

/** Hours a city admin has before a case goes up to the super admins (setting city_admin_hours). */
export function useCityAdminHours() {
  return useAppSettings().data?.city_admin_hours ?? 24
}
