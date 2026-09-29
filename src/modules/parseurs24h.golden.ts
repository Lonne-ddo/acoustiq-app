/**
 * Exécution et résumé des cas du golden des parseurs > 24 h (#19). Partagé par
 * le test (parseurs24h.golden.test.ts) et le générateur
 * (scripts/golden-parseurs-24h/generer.mjs) : les deux comparent EXACTEMENT la
 * même chose.
 */
import { createHash } from 'node:crypto'
import { parseWorkbook } from './formatDetectors'
import { parseCsv } from './csvParser'
import { canon } from '../utils/serialisationCanonique'
import type { MeasurementFile } from '../types'
import type { CasParseur24h } from './parseurs24h.fixtures'

/** Parse un cas par le chemin EXACT de l'app (parseCsv / parseWorkbook). */
export async function parserCas(c: CasParseur24h): Promise<MeasurementFile> {
  const s = c.source()
  return s.kind === 'csv' ? parseCsv(s.blob, c.nom) : parseWorkbook(s.buffer, c.nom)
}

/**
 * Résumé LISIBLE de ce qui compte pour #19 : date du fichier, bornes de `t`,
 * retours en arrière de `t` (repli à minuit) et instants répétés.
 */
export function resumer(f: MeasurementFile) {
  const t = f.data.map((d) => d.t)
  const sauts: { i: number; de: number; a: number }[] = []
  for (let i = 1; i < t.length; i++) if (t[i] < t[i - 1]) sauts.push({ i, de: t[i - 1], a: t[i] })
  const vus = new Map<number, number>()
  for (const x of t) vus.set(x, (vus.get(x) ?? 0) + 1)
  const repetes = [...vus.values()].filter((n) => n > 1).length
  return {
    date: f.date,
    n: t.length,
    tPremier: t[0],
    tDernier: t[t.length - 1],
    tMin: Math.min(...t),
    tMax: Math.max(...t),
    sauts,
    instantsRepetes: repetes,
  }
}

/** Empreinte de la sortie COMPLÈTE (sans l'id aléatoire), sérialisation canonique. */
export function empreinte(f: MeasurementFile): string {
  const sansId: Partial<MeasurementFile> = { ...f }
  delete sansId.id
  return createHash('sha256').update(canon(sansId)).digest('hex')
}
