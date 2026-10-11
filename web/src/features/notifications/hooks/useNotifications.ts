import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '@/core/supabase'
import { useAuth } from '@/features/auth/hooks/useAuth'
import { getNotifications } from '@/lib/api'

/** Notifications, kept live with Supabase Realtime. */
export function useNotifications() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: getNotifications,
    enabled: Boolean(user),
    refetchInterval: 120_000, // safety net if the realtime socket drops
  })

  useEffect(() => {
    if (!user) return
    const channel = supabase
      // Unique per hook instance: the top bar and the notifications page both subscribe, and
      // supabase.channel() returns an existing same-named channel, which throws on .on() after subscribe().
      .channel(`notifications:${user.id}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['notifications', user.id] })
          qc.invalidateQueries({ queryKey: ['profile', user.id] })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, qc])

  const unread = (query.data ?? []).filter((n) => !n.read_at).length
  return { ...query, unread }
}
