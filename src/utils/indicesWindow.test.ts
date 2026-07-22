import { describe, it, expect } from 'vitest'
import { windowData, isRegPeriodMode, type IndicesMode } from './indicesWindow'
import { dataInRegPeriod } from './regPeriod'
import { computeCorr9801Point } from './corr9801'
import type { DataPoint } from '../types'

/** Point minimal : t en minutes ; laeq indicatif (non lu par windowData). */
const dp = (t: number): DataPoint => ({ t, laeq: 50 })
const sample: DataPoint[] = [
  dp(0), dp(6 * 60 + 59), dp(7 * 60), dp(12 * 60), dp(18 * 60 + 59),
  dp(19 * 60), dp(21 * 60 + 59), dp(22 * 60), dp(23 * 60 + 30),
]
const ts = (arr: DataPoint[]) => arr.map((d) => d.t).sort((a, b) => a - b)

// Le comportement HISTORIQUE que la refonte doit préserver à l'identique.
const legacyFilter = (data: DataPoint[], startMin: number, endMin: number) =>
  data.filter((d) => d.t >= startMin && d.t <= endMin)

describe('isRegPeriodMode', () => {
  it('vrai pour jour/soir/nuit, faux pour full/custom', () => {
    expect(isRegPeriodMode('jour')).toBe(true)
    expect(isRegPeriodMode('soir')).toBe(true)
    expect(isRegPeriodMode('nuit')).toBe(true)
    expect(isRegPeriodMode('full')).toBe(false)
    expect(isRegPeriodMode('custom')).toBe(false)
  })
})

describe('windowData — NON-RÉGRESSION full/custom (identique au filtre historique)', () => {
  it('full : [-Infinity, +Infinity] ⇒ TOUS les points, identique au filtre historique', () => {
    const got = windowData(sample, 'full', -Infinity, Infinity)
    expect(ts(got)).toEqual(ts(legacyFilter(sample, -Infinity, Infinity)))
    expect(got.length).toBe(sample.length) // aucun point perdu
  })

  it('custom : borne [07:00, 19:00] ⇒ strictement le même sous-ensemble qu’avant', () => {
    const s = 7 * 60, e = 19 * 60
    const got = windowData(sample, 'custom', s, e)
    expect(ts(got)).toEqual(ts(legacyFilter(sample, s, e)))
    // Bornes inclusives des deux côtés (comportement historique conservé).
    expect(ts(got)).toEqual([7 * 60, 12 * 60, 18 * 60 + 59, 19 * 60])
  })

  it('custom : les bornes restent INCLUSIVES (≥ start ET ≤ end)', () => {
    const got = windowData(sample, 'custom', 22 * 60, 23 * 60 + 30)
    expect(ts(got)).toEqual([22 * 60, 23 * 60 + 30])
  })
})

describe('windowData — mode période délègue à dataInRegPeriod (wrap-aware)', () => {
  const modes: IndicesMode[] = ['jour', 'soir', 'nuit']
  for (const m of modes) {
    it(`${m} : identique à dataInRegPeriod(...).data (startMin/endMin ignorés)`, () => {
      // startMin/endMin volontairement absurdes : ne doivent PAS influencer le résultat.
      const got = windowData(sample, m, 999, -999)
      const expected = dataInRegPeriod(sample, m as 'jour' | 'soir' | 'nuit').data
      expect(ts(got)).toEqual(ts(expected))
    })
  }

  it('nuit : franchit minuit (00:00 et 06:59 avant 07h retenus, 22:00+ retenus, 07h→22h exclu)', () => {
    const got = windowData(sample, 'nuit', -Infinity, Infinity)
    // 00:00 et 06:59 (< 07h) côté matin ; 22:00 et 23:30 côté soir ; 07h..21h59 exclus.
    expect(ts(got)).toEqual([0, 6 * 60 + 59, 22 * 60, 23 * 60 + 30])
  })
})

// ── NON-RÉGRESSION 98-01 (arbitrage 1) : le routage windowData ne doit PAS
//    altérer les correctifs en mode plein, ET la nuit ne doit PAS produire un
//    faux « indispo » (no-data) par filtre non-wrap. ─────────────────────────
describe('windowData × computeCorr9801Point — non-régression + nuit non vide', () => {
  // Points riches (LCeq/LAFmax/spectre présents) répartis jour + soir + nuit.
  const rich = (t: number, laeq: number): DataPoint => ({
    t, laeq, lceq: laeq + 10, lafmax: laeq + 5, spectra: [laeq, laeq - 3, laeq - 6],
  })
  const full: DataPoint[] = [
    rich(12 * 60, 60),      // jour
    rich(20 * 60, 58),      // soir
    rich(23 * 60, 55),      // nuit (avant minuit)
    rich(2 * 60, 50),       // nuit (après minuit)
    rich(5 * 60, 48),       // nuit (après minuit)
  ]

  it('mode plein : corr 98-01 STRICTEMENT identique au chemin filtre historique', () => {
    const viaWindow = computeCorr9801Point(windowData(full, 'full', -Infinity, Infinity))
    const viaLegacy = computeCorr9801Point(full.filter((d) => d.t >= -Infinity && d.t <= Infinity))
    // Égalité profonde des 3 termes (valeurs + causes + intermédiaires conservés).
    expect(viaWindow).toEqual(viaLegacy)
  })

  it('nuit : sous-ensemble NON vide ⇒ correctifs disponibles (pas de faux « no-data »)', () => {
    const night = windowData(full, 'nuit', -Infinity, Infinity)
    expect(night.map((d) => d.t).sort((a, b) => a - b)).toEqual([2 * 60, 5 * 60, 23 * 60])
    const corr = computeCorr9801Point(night)
    // Données présentes ⇒ la cause n'est jamais « aucune donnée sur la fenêtre ».
    expect(corr.kb.cause).not.toBe('no-data')
    expect(corr.ki.cause).not.toBe('no-data')
    expect(corr.kt.cause).not.toBe('no-data')
    expect(corr.kb.value).not.toBeNull() // LCeq présent ⇒ Kb calculable
  })

  it('DOCUMENTE le piège évité : un filtre non-wrap [22h,7h] donnerait le vide → faux « no-data »', () => {
    // start(1320) > end(420) ⇒ AUCUN point ne satisfait t>=1320 && t<=420.
    const naiveNonWrap = full.filter((d) => d.t >= 22 * 60 && d.t <= 7 * 60)
    expect(naiveNonWrap).toEqual([])
    // C'est exactement le faux « indispo » que le routage dataInRegPeriod élimine.
    expect(computeCorr9801Point(naiveNonWrap).kb.cause).toBe('no-data')
  })
})
