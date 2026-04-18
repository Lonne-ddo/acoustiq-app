import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Loader2 } from 'lucide-react'
import './index.css'
import App from './App.tsx'
import LandingPage from './components/LandingPage.tsx'
import AuthPage from './pages/AuthPage.tsx'
import { AuthProvider, useAuth } from './contexts/AuthContext.tsx'
import { AUTH_ENABLED } from './config/auth.ts'

const APP_VERSION = '1.0.0'

function Root() {
  const [showApp, setShowApp] = useState(() => {
    // Accès direct si déjà visité ou si URL contient #app
    return localStorage.getItem('acoustiq_visited') === 'true' || window.location.hash === '#app'
  })

  function handleEnter() {
    localStorage.setItem('acoustiq_visited', 'true')
    setShowApp(true)
  }

  if (!showApp) {
    return <LandingPage onEnter={handleEnter} version={APP_VERSION} />
  }

  // AuthProvider est toujours monté pour que useAuth() ne plante pas dans les
  // composants qui l'utilisent (UserMenu, futurs hooks). AuthGate gère la bascule.
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}

function AuthGate() {
  const { user, loading } = useAuth()

  // Mode développement : on court-circuite complètement le parcours d'auth
  // (pas de spinner, pas d'AuthPage). Cf. src/config/auth.ts.
  if (!AUTH_ENABLED) return <App />

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-400 flex flex-col items-center justify-center gap-3">
        <Loader2 size={22} className="animate-spin text-emerald-400" />
        <span className="text-sm">Chargement…</span>
      </div>
    )
  }

  if (!user) return <AuthPage />

  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
