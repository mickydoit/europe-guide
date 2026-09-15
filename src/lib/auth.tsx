import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from './supabase'

interface Auth {
  session: Session | null; loading: boolean
  signIn(email: string, password: string): Promise<string | null>
  signOut(): Promise<void>
  requestReset(email: string): Promise<string | null>
  updatePassword(password: string): Promise<string | null>
}
const Ctx = createContext<Auth | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  const value: Auth = {
    session, loading,
    async signIn(email, password) { const { error } = await supabase.auth.signInWithPassword({ email, password }); return error?.message ?? null },
    async signOut() { await supabase.auth.signOut() },
    async requestReset(email) {
      const redirectTo = `${location.origin}/europe-guide/reset`
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo }); return error?.message ?? null
    },
    async updatePassword(password) { const { error } = await supabase.auth.updateUser({ password }); return error?.message ?? null },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export function useAuth() { const v = useContext(Ctx); if (!v) throw new Error('useAuth outside AuthProvider'); return v }
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth(); const loc = useLocation()
  if (loading) return null
  if (!session) return <Navigate to="/signin" replace state={{ from: loc.pathname }} />
  return <>{children}</>
}
