/**
 * Hook de résolution pour exécuter les modules `src/*.ts` sous Node nu
 * (`node --experimental-strip-types` est implicite depuis Node 22.18).
 *
 * Deux écarts entre le résolveur de Vite et celui de Node, que ce hook comble :
 *  1. Les imports du projet sont SANS extension (« ./spectraColumns ») ; Node
 *     exige un chemin complet. On réessaie .ts / .tsx / /index.ts.
 *  2. `xlsx` est publié en CJS et le lexer de named-exports de Node n'y voit
 *     pas `SSF` — `XLSX.SSF.parse_date_code` casserait au premier fichier.
 *     On redirige le spécifieur vers un shim qui réexporte la surface complète.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx', '.js']
const XLSX_SHIM = new URL('./kt-recon.xlsx-shim.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'xlsx') return { url: XLSX_SHIM, shortCircuit: true }
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    try {
      return await nextResolve(specifier, context)
    } catch (err) {
      const base = new URL(specifier, context.parentURL)
      for (const ext of CANDIDATES) {
        if (existsSync(fileURLToPath(new URL(base.href + ext)))) {
          return nextResolve(base.href + ext, context)
        }
      }
      throw err
    }
  }
  return nextResolve(specifier, context)
}
