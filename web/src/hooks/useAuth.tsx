import type { Session, User } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { getMyRoleRequest, getProfileById, getRolesOf } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { MyRoleRequest, Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  user: User | null
  profile: Profile | null
  /** Super admin: every city, plus setup (City Corporations, categories, settings, admins). */
  isAdmin: boolean
  /**
   * Which dashboard this user gets. An admin who is also an official counts as admin.
   * city_admin moderates one City Corporation's area from the Admin page.
   */
  role: 'admin' | 'city_admin' | 'official' | 'citizen'
  /** The City Corporation this user is a verified official of. */
  officialOf: { id: string; shortName: string } | null
  /** The area this user is the city admin of: its authority id and name ("Dhaka North"). */
  cityAdminOf: { id: string; area: string } | null
  /**
   * Signed up on the City Corporation page (0057) and not approved (yet): waiting, or rejected.
   * Such an account never gets the citizen app, only a waiting screen.
   */
  officialSignup: MyRoleRequest | null
  loading: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const qc = useQueryClient()
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_OUT') {
        // Drop everything the last user loaded (notifications, my reports, ...), so the next person on this
        // device never sees it, not even for a moment while it reloads.
        qc.clear()
      } else {
        // Personalised fields (my_vote, my_following...) change with the user.
        qc.invalidateQueries()
      }
      // Opened the link from a "Forgot password?" email: let them choose a new password.
      if (event === 'PASSWORD_RECOVERY') navigate('/reset-password', { replace: true })
    })
    return () => sub.subscription.unsubscribe()
  }, [qc, navigate])

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
  const cityAdmin = roles.find((r) => r.role === 'city_admin')
  const isAdmin = roles.some((r) => r.role === 'admin')
  const signupQuery = useQuery({
    queryKey: ['my_role_request', userId],
    queryFn: getMyRoleRequest,
    enabled: Boolean(userId),
  })
  const signup = signupQuery.data

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    profile: profileQuery.data ?? null,
    isAdmin,
    role: isAdmin ? 'admin' : cityAdmin ? 'city_admin' : official ? 'official' : 'citizen',
    officialOf: official?.authority_id ? { id: official.authority_id, shortName: official.authority_short_name ?? '' } : null,
    cityAdminOf: cityAdmin?.authority_id ? { id: cityAdmin.authority_id, area: cityAdmin.authority_area ?? '' } : null,
    officialSignup: signup?.via_signup && signup.status !== 'approved' && !roles.length ? signup : null,
    // Roles decide where a user lands, so wait for them too.
    loading: sessionLoading || (Boolean(userId) && (profileQuery.isLoading || rolesQuery.isLoading || signupQuery.isLoading)),
    refreshProfile: async () => {
      await qc.invalidateQueries({ queryKey: ['profile', userId] })
      await qc.invalidateQueries({ queryKey: ['roles', userId] })
      await qc.invalidateQueries({ queryKey: ['my_role_request', userId] })
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
