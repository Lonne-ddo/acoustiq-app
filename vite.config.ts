import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { powerApps } from '@microsoft/power-apps-vite/plugin'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig({
  // powerApps() = handshake Local Play : base './', CORS apps.powerapps.com,
  // sert power.config.json et imprime l'URL Local Play au démarrage.
  plugins: [react(), tailwindcss(), powerApps()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Port figé sur 5174 : budget-codeapp occupe 5173 → on déconflicte pour que
  // les deux Code Apps puissent tourner en Local Play simultanément. L'URL Local
  // Play d'AcoustiQ dans le harness doit pointer sur 5174. strictPort échoue
  // franchement si le port est pris, au lieu de basculer en silence (ce qui
  // casserait le handshake).
  server: {
    port: 5174,
    strictPort: true,
  },
})
