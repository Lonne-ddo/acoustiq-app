import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Port de dev fixé à 5174 pour éviter la collision avec l'autre projet
  // Vite (5173). N'affecte que `npm run dev` — aucun impact build/déploiement.
  server: {
    port: 5174,
  },
})
