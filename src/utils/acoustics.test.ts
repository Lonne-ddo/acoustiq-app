import { describe, it, expect } from 'vitest'
import {
  computeLn,
  computeL10,
  computeL50,
  computeL90,
  filterDataByPeriods,
  dpTimestampMs,
} from './acoustics'
import type { Category, Period } from '../types'

/**
 * Verrouille la convention acoustique des percentiles :
 *   Ln = niveau dépassé n % du temps = (100 − n)e percentile (tri croissant).
 *
 * Distribution de référence : 0, 1, 2, …, 100 (101 valeurs).
 * Pour cette distribution, computePercentile(v, p) = round(p), donc
 * computeLn(v, n) = computePercentile(v, 100 − n) = 100 − n. C'est exact et
 * facile à vérifier à la main.
 */
const RAMP = Array.from({ length: 101 }, (_, i) => i) // [0..100]

// Mélange déterministe pour prouver l'indépendance à l'ordre d'entrée.
const SHUFFLED = (() => {
  const a = [...RAMP]
  for (let i = 0; i < a.length; i++) {
    const j = (i * 37 + 11) % a.length
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
})()

describe('computeLn — convention Ln = (100 − n)e percentile', () => {
  it('mappe chaque Ln sur le (100 − n)e percentile de la rampe 0..100', () => {
    for (const n of [1, 5, 10, 50, 90, 95, 99]) {
      expect(computeLn(RAMP, n)).toBe(100 - n)
    }
  })

  it('est indépendant de l’ordre des valeurs en entrée', () => {
    for (const n of [1, 10, 50, 90, 99]) {
      expect(computeLn(SHUFFLED, n)).toBe(computeLn(RAMP, n))
    }
  })

  it('est monotone décroissant en n (plus n est grand, plus le niveau est bas)', () => {
    const levels = [1, 10, 50, 90, 95, 99].map((n) => computeLn(RAMP, n))
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeLessThanOrEqual(levels[i - 1])
    }
  })
})

describe('computeL10 / L50 / L90 — inversion corrigée', () => {
  it('L90 est une valeur BASSE (bruit de fond), L10 une valeur HAUTE (pointes)', () => {
    expect(computeL90(RAMP)).toBe(10) // 10e percentile
    expect(computeL50(RAMP)).toBe(50) // médiane
    expect(computeL10(RAMP)).toBe(90) // 90e percentile
  })

  it('respecte l’ordre documenté L90 ≤ L50 ≤ L10', () => {
    expect(computeL90(RAMP)).toBeLessThanOrEqual(computeL50(RAMP))
    expect(computeL50(RAMP)).toBeLessThanOrEqual(computeL10(RAMP))
  })

  it('délègue à computeLn (mêmes résultats)', () => {
    expect(computeL90(SHUFFLED)).toBe(computeLn(SHUFFLED, 90))
    expect(computeL10(SHUFFLED)).toBe(computeLn(SHUFFLED, 10))
    expect(computeL50(SHUFFLED)).toBe(computeLn(SHUFFLED, 50))
  })
})

describe('cas limites', () => {
  it('renvoie 0 pour un tableau vide', () => {
    expect(computeLn([], 90)).toBe(0)
  })

  it('ignore NaN / Infinity', () => {
    const vals = [10, 20, 30, NaN, Infinity, -Infinity]
    // valides triés : [10, 20, 30] → L50 = 50e percentile = 20
    expect(computeLn(vals, 50)).toBe(20)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// filterDataByPeriods — filtrage par catégories + exclusion ad-hoc
// ─────────────────────────────────────────────────────────────────────────
const D = '2026-03-09'
const cat = (id: string, mode: Category['mode'], visible = true): Category => ({
  id, name: id, color: '#ffffff', mode, visible,
})
// Période couvrant [startMin, endMin) minutes sur la date D.
const per = (categoryId: string, startMin: number, endMin: number): Period => ({
  id: `${categoryId}:${startMin}-${endMin}`,
  name: '',
  startMs: dpTimestampMs(D, startMin),
  endMs: dpTimestampMs(D, endMin),
  categoryId,
})
const pts = (mins: number[]) => mins.map((t) => ({ t }))
const tsOf = (rows: { t: number }[]) => rows.map((r) => r.t)

describe('filterDataByPeriods — comportement par DÉFAUT (4 args, opts absent)', () => {
  const cats = [cat('amb', 'include'), cat('exc', 'exclude'), cat('ann', 'annotation')]

  it('aucune période → garde tout (projet neuf)', () => {
    const data = pts([0, 60, 120])
    expect(filterDataByPeriods(data, D, [], cats)).toEqual(data)
    expect(filterDataByPeriods(data, D, null, cats)).toEqual(data)
    expect(filterDataByPeriods(data, D, undefined, cats)).toEqual(data)
  })

  it('aucune catégorie → garde tout', () => {
    const data = pts([0, 60, 120])
    expect(filterDataByPeriods(data, D, [per('amb', 0, 60)], [])).toEqual(data)
  })

  it('mode include = whitelist (restreint aux périodes incluses)', () => {
    const data = pts([0, 60, 120, 200])
    const out = filterDataByPeriods(data, D, [per('amb', 60, 180)], cats)
    expect(tsOf(out)).toEqual([60, 120]) // 0 et 200 hors [60,180)
  })

  it('mode exclude = blacklist (retire les périodes exclues)', () => {
    const data = pts([0, 60, 90, 120, 180])
    const out = filterDataByPeriods(data, D, [per('exc', 60, 120)], cats)
    expect(tsOf(out)).toEqual([0, 120, 180]) // 60 et 90 retirés ; 120 conservé (borne ouverte)
  })

  it('mode annotation = jamais filtrant', () => {
    const data = pts([0, 60, 120])
    expect(filterDataByPeriods(data, D, [per('ann', 0, 1440)], cats)).toEqual(data)
  })

  it('catégorie non visible = neutralisée', () => {
    const data = pts([0, 60, 120])
    const hidden = [cat('exc', 'exclude', false)]
    expect(filterDataByPeriods(data, D, [per('exc', 60, 120)], hidden)).toEqual(data)
  })
})

describe('filterDataByPeriods — exclusion ad-hoc (opts.excludeCategoryIds)', () => {
  // amb couvre toute la journée (include) ; trafic est un sous-intervalle include.
  const cats = [cat('amb', 'include'), cat('trafic', 'include'), cat('ann', 'annotation')]
  const periods = [per('amb', 0, 1440), per('trafic', 120, 180)]

  it('exclut à la volée les périodes de la catégorie choisie', () => {
    const data = pts([0, 60, 150, 200])
    const out = filterDataByPeriods(data, D, periods, cats, { excludeCategoryIds: ['trafic'] })
    expect(tsOf(out)).toEqual([0, 60, 200]) // 150 ∈ [120,180) retiré
  })

  it('fonctionne QUEL QUE SOIT le mode de la catégorie (même annotation)', () => {
    const data = pts([0, 90, 150])
    const annPeriods = [per('ann', 60, 120)]
    // Sans opts : annotation ignorée → tout gardé.
    expect(filterDataByPeriods(data, D, annPeriods, cats)).toEqual(data)
    // Avec exclusion ad-hoc de 'ann' : la période devient blacklist.
    const out = filterDataByPeriods(data, D, annPeriods, cats, { excludeCategoryIds: ['ann'] })
    expect(tsOf(out)).toEqual([0, 150]) // 90 ∈ [60,120) retiré
  })

  it('set/itérable VIDE = strictement identique au défaut', () => {
    const data = pts([0, 60, 150, 200])
    const base = filterDataByPeriods(data, D, periods, cats)
    expect(filterDataByPeriods(data, D, periods, cats, { excludeCategoryIds: [] })).toEqual(base)
    expect(filterDataByPeriods(data, D, periods, cats, { excludeCategoryIds: new Set() })).toEqual(base)
    expect(filterDataByPeriods(data, D, periods, cats, {})).toEqual(base)
  })

  it('opts absent = strictement identique à opts vide (défauts inchangés)', () => {
    const data = pts([0, 60, 150, 200])
    expect(filterDataByPeriods(data, D, periods, cats)).toEqual(
      filterDataByPeriods(data, D, periods, cats, { excludeCategoryIds: [] }),
    )
  })

  it('accepte un Set comme itérable', () => {
    const data = pts([0, 60, 150, 200])
    const out = filterDataByPeriods(data, D, periods, cats, { excludeCategoryIds: new Set(['trafic']) })
    expect(tsOf(out)).toEqual([0, 60, 200])
  })
})
