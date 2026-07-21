import { describe, it, expect } from 'vitest'
import { windowData, isRegPeriodMode, type IndicesMode } from './indicesWindow'
import { dataInRegPeriod } from './regPeriod'
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
