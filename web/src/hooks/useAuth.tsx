import type { Session, User } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getProfileById, getRolesOf } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  user: User | null
  profile: Profile | null
  isAdmin: boolean
  /** Which dashboard this user gets. An admin who is also an official counts as admin. */
  role: 'admin' | 'official' | 'citizen'
  /** The City Corporation this user is a verified official of. */
  officialOf: { id: string; shortName: string } | null
  loading: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const qc = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // Personalised fields (my_vote, my_following...) change with the user.
      qc.invalidateQueries()
    })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  const userId = session?.user.id
  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    queryFn: () => getProfileById(userId!),
    enabled: Boolean(userId),
  })

  const rolesQuery = useQuery({
    queryKey: ['roles', userId],
    queryFn: () => getRolesOf(userId!),
    enabled: Boolean(userId),
  })
  const roles = rolesQuery.data ?? []
  const official = roles.find((r) => r.role === 'official')
  const isAdmin = roles.some((r) => r.role === 'admin')

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    profile: profileQuery.data ?? null,
    isAdmin,
    role: isAdmin ? 'admin' : official ? 'official' : 'citizen',
    officialOf: official?.authority_id ? { id: official.authority_id, shortName: official.authority_short_name ?? '' } : null,
    // Roles decide where a user lands, so wait for them too.
    loading: sessionLoading || (Boolean(userId) && (profileQuery.isLoading || rolesQuery.isLoading)),
    refreshProfile: async () => {
      await qc.invalidateQueries({ queryKey: ['profile', userId] })
      await qc.invalidateQueries({ queryKey: ['roles', userId] })
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
