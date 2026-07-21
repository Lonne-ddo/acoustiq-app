import { describe, it, expect } from 'vitest'
import { dataInRegPeriod } from './regPeriod'
import { dpTimestampMs, filterDataByPeriods } from './acoustics'
import type { Period, Category } from '../types'

/** Point minimal : t en minutes depuis minuit. h(H,M) → minutes. */
const h = (hh: number, mm = 0) => hh * 60 + mm
const P = (t: number) => ({ t })
const ts = (arr: { t: number }[]) => arr.map((d) => d.t).sort((a, b) => a - b)

describe('dataInRegPeriod — bornes (début inclusif, fin exclusive)', () => {
  it('jour 07-19 : nominal + bornes (07:00 inclus, 19:00 exclu)', () => {
    const r = dataInRegPeriod(
      [P(h(6, 59)), P(h(7)), P(h(12)), P(h(18, 59)), P(h(19)), P(h(22))],
      'jour',
    )
    expect(ts(r.data)).toEqual([h(7), h(12), h(18, 59)]) // 06:59 et 19:00 exclus
    expect(r.periodMin).toBe(720)
    expect(r.coveredMin).toBe(3)
  })

  it('soir 19-22 : nominal (19:00 inclus, 22:00 exclu)', () => {
    const r = dataInRegPeriod([P(h(18, 59)), P(h(19)), P(h(21, 59)), P(h(22))], 'soir')
    expect(ts(r.data)).toEqual([h(19), h(21, 59)])
    expect(r.periodMin).toBe(180)
  })
})

describe('dataInRegPeriod — nuit 22-07 franchit minuit', () => {
  it('retient les points des DEUX côtés de minuit', () => {
    const r = dataInRegPeriod(
      [P(h(21, 59)), P(h(22)), P(h(23)), P(0), P(h(1)), P(h(6, 59)), P(h(7)), P(h(12))],
      'nuit',
    )
    // 22:00 inclus, 00:00 et 01:00 inclus, 06:59 inclus ; 21:59 / 07:00 / 12:00 exclus
    expect(ts(r.data)).toEqual([0, h(1), h(6, 59), h(22), h(23)])
    expect(r.periodMin).toBe(540)
  })

  it('fichier mono-journée démarrant à 10h : seuls les points après 22h', () => {
    const r = dataInRegPeriod([P(h(10)), P(h(15)), P(h(22)), P(h(23, 30))], 'nuit')
    expect(ts(r.data)).toEqual([h(22), h(23, 30)]) // 10:00 et 15:00 exclus
  })

  it('fichier chevauchant deux jours : continuité 23h→01h (t normalisé mod 1440)', () => {
    // 23:00, 23:59 puis passage minuit → 00:00, 00:01, 01:00 (t revenu à 0..60)
    const r = dataInRegPeriod([P(h(23)), P(h(23, 59)), P(0), P(1), P(h(1))], 'nuit')
    expect(ts(r.data)).toEqual([0, 1, h(1), h(23), h(23, 59)])
    expect(r.coveredMin).toBe(5) // 5 minutes distinctes, continuité correcte
  })
})

describe('dataInRegPeriod — période vide', () => {
  it('aucun point dans la période → retour explicite (data vide, coveredMin 0), pas d’exception', () => {
    const r = dataInRegPeriod([P(h(10)), P(h(12))], 'nuit')
    expect(r.data).toEqual([])
    expect(r.coveredMin).toBe(0)
    expect(r.periodMin).toBe(540) // la durée attendue reste connue
  })
})

describe('dataInRegPeriod — composition avec « À exclure »', () => {
  const ISO = '2026-01-15'
  const base = dpTimestampMs(ISO, 0)
  const catExcl: Category = { id: 'x', name: 'À exclure', color: '#000', mode: 'exclude', visible: true }
  // Période catégorie « exclue » couvrant 23:00 (t=1380).
  const periodExcl: Period = {
    id: 'p',
    name: 'bruit',
    startMs: base + (h(23) - 5) * 60_000,
    endMs: base + (h(23) + 5) * 60_000,
    categoryId: 'x',
  }

  it('un point exclu (dans la nuit) n’apparaît dans AUCUNE période', () => {
    const data = [{ t: h(23) }, { t: h(23, 30) }] // les deux sont la nuit
    // 1) exclusion catégorie D'ABORD, 2) extraction période ENSUITE.
    const afterCat = filterDataByPeriods(data, ISO, [periodExcl], [catExcl])
    const night = dataInRegPeriod(afterCat, 'nuit')

    expect(ts(night.data)).toEqual([h(23, 30)]) // 23:00 exclu → absent
    // Contrôle : sans l'exclusion, 23:00 SERAIT dans la nuit.
    expect(ts(dataInRegPeriod(data, 'nuit').data)).toEqual([h(23), h(23, 30)])
  })
})
