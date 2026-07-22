import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as XLSX from 'xlsx'
import { computeLaftm5 } from './acoustics'

/**
 * ORACLE LAFTM5 — le LAFTM5 reconstruit depuis le pas-à-pas (« Historique
 * temporel », LAFmax col 6) doit correspondre au LAFTM5 PRÉ-CALCULÉ par le
 * sonomètre (« Historique de mesure », col 33), heure par heure, à la tolérance
 * d'arrondi près. C'est la preuve que le calcul est juste sans dépendre d'EQ-09.
 *
 * Fichier réel NON committé (données de mesure, gouvernance) → test gardé par
 * fs.existsSync ; ignoré en CI, joué localement avant validation.
 */
const REAL = 'C:/Users/oganes/OneDrive - Englobe Corp/Bureau/Projets/En cours/DDA/Test acoustiq/831C_12782-20260707 070000-26070700.LD0.xlsx'

const num = (v: unknown): number => (typeof v === 'number' ? v : parseFloat(String(v)))
const secOfDay = (serial: number): number => Math.round((((serial % 1) + 1) % 1) * 86400)
const hourOf = (serial: number): number => Math.floor(secOfDay(serial) / 3600) % 24

describe('ORACLE — LAFTM5 reconstruit (pas-à-pas) ≡ LAFTM5 G4 (col 33), heure par heure', () => {
  it.skipIf(!fs.existsSync(REAL))('écart < 0,1 dB sur chaque heure recoupée', () => {
    const wb = XLSX.read(fs.readFileSync(REAL), { type: 'buffer', cellDates: false })

    // pas-à-pas : { tSec, lafmax } groupés par heure d'horloge (marqueurs sautés)
    const th = XLSX.utils.sheet_to_json(wb.Sheets['Historique temporel'], { header: 1, defval: null }) as unknown[][]
    const byHour = new Map<number, { tSec: number; lafmax: number }[]>()
    for (let i = 1; i < th.length; i++) {
      const r = th[i]
      if (!r) continue
      const rt = r[1]
      if (rt !== null && rt !== '' && rt !== undefined) continue // marqueur (« Départ »…)
      const t = num(r[3]), laf = num(r[6])
      if (!Number.isFinite(t) || !Number.isFinite(laf)) continue
      const h = hourOf(t)
      const arr = byHour.get(h) ?? []
      arr.push({ tSec: secOfDay(t), lafmax: laf })
      byHour.set(h, arr)
    }

    // agrégée : LAFTM5 pré-calculé (col 33) par heure (Temps col 5)
    const mh = XLSX.utils.sheet_to_json(wb.Sheets['Historique de mesure'], { header: 1, defval: null }) as unknown[][]
    const g4 = new Map<number, number>()
    for (let i = 1; i < mh.length; i++) {
      const r = mh[i]
      if (!r) continue
      const t = num(r[5])
      if (!Number.isFinite(t)) continue
      const v = num(r[33])
      if (Number.isFinite(v)) g4.set(hourOf(t), v)
    }

    expect(g4.size).toBeGreaterThan(0)
    let compared = 0
    let maxDelta = 0
    for (const [h, samples] of byHour) {
      const truth = g4.get(h)
      if (truth === undefined) continue
      const recon = computeLaftm5(samples)
      expect(recon).not.toBeNull()
      const delta = Math.abs((recon as number) - truth)
      maxDelta = Math.max(maxDelta, delta)
      expect(delta).toBeLessThan(0.1) // < 0,1 dB visé (bruit d'arrondi 1 décimale)
      compared++
    }
    expect(compared).toBeGreaterThanOrEqual(5) // au moins 5 heures recoupées
    // Trace (visible avec --reporter=verbose) : écart max effectif ~0,05 dB.
    expect(maxDelta).toBeLessThan(0.1)
  }, 60000)
})

describe('GARDE PERMANENTE — successif ≠ glissant (empêche un retour à la fenêtre glissante)', () => {
  it('un pic isolé : computeLaftm5 (successif) diverge du glissant historique', () => {
    const laf = [80, 50, 50, 50, 50, 50, 50, 50, 50, 50] // pic isolé en tête
    const successif = computeLaftm5(laf.map((lafmax, i) => ({ tSec: i, lafmax }))) as number

    // Réimplémentation du GLISSANT historique (1 max/seconde forward, chevauchant).
    const rolling: number[] = []
    for (let i = 0; i < laf.length; i++) {
      let m = -Infinity
      const e = Math.min(laf.length - 1, i + 4)
      for (let j = i; j <= e; j++) if (laf[j] > m) m = laf[j]
      rolling.push(m)
    }
    const glissant = 10 * Math.log10(rolling.reduce((s, x) => s + Math.pow(10, x / 10), 0) / rolling.length)

    // Successif = énergétique de {bloc0=80, bloc1=50} ≈ 77.0 ; glissant ≈ 70.0.
    expect(successif).toBeCloseTo(10 * Math.log10((1e8 + 1e5) / 2), 6)
    expect(Math.abs(successif - glissant)).toBeGreaterThan(1) // divergence franche
  })
})
