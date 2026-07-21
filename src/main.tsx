import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getContext } from '@microsoft/power-apps/app'
import './index.css'
import App from './App.tsx'
import LandingPage from './components/LandingPage.tsx'

const APP_VERSION = '1.0.0'

// INIT SDK Power Apps — indispensable au boot dans le player, AVANT toute gate UI.
// getContext() déclenche le handshake (executePluginAsync → getBridge →
// postMessage 'initCommunicationWithPort') que le player attend. AcoustiQ ne
// touchant aucune source de données Dataverse, le handshake ne se déclenche
// jamais implicitement : on l'amorce ici explicitement, sinon le player rejette
// l'app (« Nous n'avons pas pu récupérer votre application »).
getContext().catch(() => {
  // Hors player (navigateur brut) le bridge ne répond pas — sans importance :
  // le postMessage de handshake est déjà parti.
})

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

  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
