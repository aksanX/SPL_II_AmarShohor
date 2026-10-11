import { useQuery } from '@tanstack/react-query'
import { getAppSettings } from '@/lib/api'

export function useAppSettings() {
  return useQuery({ queryKey: ['app_settings'], queryFn: getAppSettings, staleTime: 10 * 60_000 })
}
