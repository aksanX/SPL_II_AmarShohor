import { useQuery } from '@tanstack/react-query'
import { appSettingsService } from '@/shared/settings/appSettings.service'

export function useAppSettings() {
  return useQuery({ queryKey: ['app_settings'], queryFn: appSettingsService.getAppSettings, staleTime: 10 * 60_000 })
}
