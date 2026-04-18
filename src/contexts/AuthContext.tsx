/**
 * Contexte d'authentification — expose l'utilisateur courant et les actions
 * signIn / signUp / signOut. Les changements de session sont propagés
 * automatiquement via supabase.auth.onAuthStateChange.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthError, Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export interface AuthResult {
  error: string | null
}

interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string) => Promise<AuthResult>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Traduit les erreurs Supabase en messages FR parlant pour l'utilisateur. */
function translateAuthError(err: AuthError | null): string | null {
  if (!err) return null
  const msg = err.message || ''
  const low = msg.toLowerCase()
  if (low.includes('invalid login credentials')) return 'Email ou mot de passe incorrect.'
  if (low.includes('email not confirmed')) return 'Vous devez confirmer votre email avant de vous connecter.'
  if (low.includes('user already registered') || low.includes('already been registered')) {
    return 'Cet email est déjà utilisé — utilisez la connexion.'
  }
  if (low.includes('password should be at least') || low.includes('password is too short')) {
    return 'Le mot de passe est trop court (minimum 6 caractères).'
  }
  if (low.includes('invalid email') || low.includes('unable to validate email address')) {
    return 'Adresse email invalide.'
  }
  if (low.includes('rate limit')) return 'Trop de tentatives — réessayez dans quelques secondes.'
  return msg
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setUser(data.session?.user ?? null)
      setLoading(false)
    })
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return
      setSession(newSession)
      setUser(newSession?.user ?? null)
      setLoading(false)
    })
    return () => {
      mounted = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string): Promise<AuthResult> {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: translateAuthError(error) }
  }

  async function signUp(email: string, password: string): Promise<AuthResult> {
    const { error } = await supabase.auth.signUp({ email, password })
    return { error: translateAuthError(error) }
  }

  async function signOut(): Promise<void> {
    await supabase.auth.signOut()
  }

  const value: AuthContextValue = { user, session, loading, signIn, signUp, signOut }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider')
  return ctx
}
