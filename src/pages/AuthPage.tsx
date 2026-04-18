/**
 * Page de connexion / inscription.
 *
 * Un seul formulaire bascule entre les deux modes via un toggle. Les erreurs
 * Supabase sont déjà traduites en FR par translateAuthError dans AuthContext.
 */
import { useState, type FormEvent } from 'react'
import { Activity, Loader2, LogIn, UserPlus, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

type Mode = 'signin' | 'signup'

export default function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail) { setError('Email requis.'); return }
    if (!password) { setError('Mot de passe requis.'); return }
    if (mode === 'signup' && password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.')
      return
    }

    setBusy(true)
    const result = mode === 'signin'
      ? await signIn(trimmedEmail, password)
      : await signUp(trimmedEmail, password)
    setBusy(false)

    if (result.error) {
      setError(result.error)
      return
    }
    if (mode === 'signup') {
      setInfo('Compte créé — vous pouvez maintenant vous connecter.')
      // Basculer sur le mode connexion pour poursuivre sans retaper l'email
      setMode('signin')
      setPassword('')
    }
    // signin success → onAuthStateChange va basculer Root sur <App />
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setInfo(null)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Header logo */}
      <header className="px-8 py-6 flex items-center justify-between border-b border-gray-800/50">
        <div className="flex items-center gap-3">
          <Activity className="text-emerald-400" size={24} />
          <span className="font-bold text-xl tracking-tight">AcoustiQ</span>
        </div>
      </header>

      {/* Corps centré */}
      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md bg-gray-900/60 border border-gray-800 rounded-xl shadow-lg p-6">
          <div className="flex items-center gap-2 mb-1">
            {mode === 'signin' ? <LogIn size={16} className="text-emerald-400" /> : <UserPlus size={16} className="text-emerald-400" />}
            <h1 className="text-lg font-semibold">
              {mode === 'signin' ? 'Connexion' : 'Inscription'}
            </h1>
          </div>
          <p className="text-xs text-gray-500 mb-5">
            {mode === 'signin'
              ? 'Entrez vos identifiants pour accéder à vos projets.'
              : 'Créez un compte pour commencer à utiliser AcoustiQ.'}
          </p>

          <form onSubmit={onSubmit} className="space-y-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="email" className="text-xs text-gray-400">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="text-sm bg-gray-800 text-gray-100 border border-gray-700 rounded
                           px-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder="vous@entreprise.com"
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="password" className="text-xs text-gray-400">Mot de passe</label>
              <input
                id="password"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="text-sm bg-gray-800 text-gray-100 border border-gray-700 rounded
                           px-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                placeholder={mode === 'signup' ? '6 caractères minimum' : '••••••••'}
                disabled={busy}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-950/40 border border-rose-800 rounded p-2">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            {info && (
              <div className="flex items-start gap-2 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-800 rounded p-2">
                <CheckCircle2 size={13} className="shrink-0 mt-0.5" />
                <span>{info}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md
                         bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50
                         text-sm font-medium transition-colors"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy
                ? 'Patientez…'
                : mode === 'signin' ? 'Se connecter' : 'Créer le compte'}
            </button>
          </form>

          {/* Toggle mode */}
          <div className="mt-4 text-center text-xs text-gray-500">
            {mode === 'signin' ? (
              <>Pas encore de compte ?{' '}
                <button
                  type="button"
                  className="text-emerald-400 hover:text-emerald-300 underline"
                  onClick={() => switchMode('signup')}
                >
                  Créer un compte
                </button>
              </>
            ) : (
              <>Déjà inscrit ?{' '}
                <button
                  type="button"
                  className="text-emerald-400 hover:text-emerald-300 underline"
                  onClick={() => switchMode('signin')}
                >
                  Se connecter
                </button>
              </>
            )}
          </div>
        </div>
      </main>

      <footer className="px-6 py-4 border-t border-gray-800/50 text-center text-xs text-gray-600">
        Aucun projet n'est partagé automatiquement — chaque compte gère ses propres projets.
      </footer>
    </div>
  )
}
