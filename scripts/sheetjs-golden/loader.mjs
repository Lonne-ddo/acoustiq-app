// Résout `xlsx` vers l'implémentation désignée par XLSX_IMPL (dossier du paquet),
// et les imports relatifs sans extension vers .ts/.tsx (comme kt-recon).
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
const SHIM = new URL('./xlsx-shim.mjs', import.meta.url).href
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx', '.js']
export async function resolve(spec, ctx, next) {
  if (spec === 'xlsx') return { url: SHIM, shortCircuit: true }
  if (spec.startsWith('.') || spec.startsWith('/')) {
    try { return await next(spec, ctx) } catch (err) {
      const base = new URL(spec, ctx.parentURL)
      for (const e of CANDIDATES) if (existsSync(fileURLToPath(new URL(base.href + e)))) return next(base.href + e, ctx)
      throw err
    }
  }
  return next(spec, ctx)
}
