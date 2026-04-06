import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import LandingPage from './components/LandingPage.tsx'

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

  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
