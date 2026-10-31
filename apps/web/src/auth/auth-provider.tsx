import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { useNavigate } from 'react-router'
import { setSessionWorkspaces } from '@/lib/api-client'
import { supabase } from '@/lib/supabase'
import { AuthContext, type AuthContextValue } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return
      setSession(next)
      setLoading(false)
      if (event === 'SIGNED_OUT') {
        setSessionWorkspaces(null)
        queryClient.clear()
      }
      // Recovery links sign the user in with a short-lived session; send them to set a new password.
      if (event === 'PASSWORD_RECOVERY') navigate('/reset-password', { replace: true })
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [navigate, queryClient])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    setSessionWorkspaces(null)
    queryClient.clear()
    navigate('/login', { replace: true })
  }, [navigate, queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({ configured: Boolean(supabase), session, user: session?.user ?? null, loading, signOut }),
    [session, loading, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
