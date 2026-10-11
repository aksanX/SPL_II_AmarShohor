import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { getMySettings } from '@/lib/api'

export function useMySettings() {
  const { user } = useAuth()
  return useQuery({ queryKey: ['my_settings', user?.id], queryFn: getMySettings, enabled: Boolean(user) })
}
