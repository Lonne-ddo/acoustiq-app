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
  // Port figé sur 5173 : l'URL Local Play enregistrée dans le harness pointe
  // toujours là. strictPort échoue franchement si le port est pris, au lieu de
  // basculer en silence sur 5174 (ce qui casserait le handshake).
  server: {
    port: 5173,
    strictPort: true,
  },
})
