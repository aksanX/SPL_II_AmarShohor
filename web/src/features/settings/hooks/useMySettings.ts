import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { accountService } from '@/features/settings/services/account.service'

export function useMySettings() {
  const { user } = useAuth()
  return useQuery({ queryKey: ['my_settings', user?.id], queryFn: accountService.getMySettings, enabled: Boolean(user) })
}
