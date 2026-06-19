import { describe, it, expect } from 'vitest'
import {
  computeLn,
  computeLnSeries,
  computeL10,
  computeL50,
  computeL90,
  filterDataByPeriods,
  dpTimestampMs,
  computeLaftm5,
  computeKi9801,
  computeKb9801,
  analyzeKt9801,
  analyzeKt,
  leqOnRegPeriod,
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

describe('computeLnSeries — batch, source unique partagée avec computeLn', () => {
  it('même convention que computeLn sur la rampe 0..100', () => {
    expect(computeLnSeries(RAMP, [1, 10, 50, 90, 99])).toEqual([99, 90, 50, 10, 1])
  })

  it('L90 < L50 < L10 et L90 = valeur de fond basse', () => {
    const [l90, l50, l10] = computeLnSeries(RAMP, [90, 50, 10])
    expect(l90).toBe(10) // bas (bruit de fond)
    expect(l90).toBeLessThan(l50)
    expect(l50).toBeLessThan(l10)
  })

  it('strictement égal à computeLn élément par élément (indépendant de l’ordre)', () => {
    const ns = [1, 5, 10, 50, 90, 95, 99]
    expect(computeLnSeries(SHUFFLED, ns)).toEqual(ns.map((n) => computeLn(SHUFFLED, n)))
  })

  it('série vide → zéros alignés sur ns', () => {
    expect(computeLnSeries([], [10, 50, 90])).toEqual([0, 0, 0])
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

// ─────────────────────────────────────────────────────────────────────────
// Correctifs Note 98-01 — Ki (LAFTM5), Kb, Kt 98-01
// ─────────────────────────────────────────────────────────────────────────
describe('computeLaftm5 — max glissant 5 s FORWARD (EQ-09 : MAX(J5:J9)) → moyenne énergétique', () => {
  it('série constante → LAFTM5 = la constante', () => {
    expect(computeLaftm5([70, 70, 70, 70, 70])).toBe(70)
  })

  it('fenêtre FORWARD : un pic en fin remplit les fenêtres des 5 s précédentes', () => {
    // Pic à l’index 4 : pour i ∈ [0..4], la fenêtre [i..i+4] contient l’index 4
    // → tous les maxima = 80.
    expect(computeLaftm5([50, 50, 50, 50, 80])).toBe(80)
  })

  it('direction forward (pas trailing) : un pic en TÊTE ne remplit pas tout', () => {
    // En trailing on obtiendrait 80 ; en forward seul i=0 voit le pic → < 80.
    const v = computeLaftm5([80, 50, 50, 50, 50]) as number
    expect(v).toBeLessThan(80)
    expect(v).toBeGreaterThan(50)
  })

  it('fenêtre bornée à 5 s (forward)', () => {
    // 6 échantillons, pic à l’index 5 : i=0 (fenêtre [0..4]) ne l’atteint pas
    // → LAFTM5 < 80 (fenêtre bien limitée à 5 s).
    const v = computeLaftm5([50, 50, 50, 50, 50, 80]) as number
    expect(v).toBeLessThan(80)
    expect(v).toBeGreaterThan(50)
  })

  it('série vide → null (Ki indisponible)', () => {
    expect(computeLaftm5([])).toBeNull()
    expect(computeLaftm5([NaN, Infinity])).toBeNull()
  })
})

describe('computeKi9801 — Ki = LAFTM5 − LAeq, gate > 2', () => {
  it('appliqué si > 2 dB', () => {
    expect(computeKi9801(70, 65)).toBe(5)
  })
  it('non appliqué si ≤ 2 dB → 0', () => {
    expect(computeKi9801(66, 65)).toBe(0)
    expect(computeKi9801(67, 65)).toBe(0) // exactement 2 → non appliqué
  })
  it('null si LAFTM5 indisponible', () => {
    expect(computeKi9801(null, 65)).toBeNull()
  })
  it('chaîne complète depuis le LAFmax 1 s', () => {
    const laftm5 = computeLaftm5([50, 50, 50, 50, 80]) // forward : = 80
    expect(computeKi9801(laftm5, 60)).toBe(20)
  })
})

describe('computeKb9801 — Kb = LCeq − LAeq, gate ≥ 20', () => {
  it('différence brute si ≥ 20 dB', () => {
    expect(computeKb9801(90, 65)).toBe(25)
    expect(computeKb9801(85, 65)).toBe(20) // exactement 20 → appliqué
  })
  it('0 si < 20 dB', () => {
    expect(computeKb9801(80, 65)).toBe(0)
  })
  it('null si LCeq absent', () => {
    expect(computeKb9801(undefined, 65)).toBeNull()
    expect(computeKb9801(null, 65)).toBeNull()
  })
})

describe('analyzeKt9801 — seuils 15/8/5 + significativité ≤ 14,5', () => {
  // Spectre LZeq de 24 bandes, plat à 50 dB, avec une émergence E sur la bande
  // 160 Hz (index 5 de KT_BAND_FREQS).
  const spec160 = (emergence: number) => {
    const s = new Array(24).fill(50)
    s[5] = 50 + emergence
    return s
  }

  it('160 Hz exige 15 dB en 98-01 (vs 8 dB en MELCCFP 2026)', () => {
    const s = spec160(10) // 10 dB : ≥ 8 (2026) mais < 15 (98-01)
    expect(analyzeKt9801(s, 50).kt).toBe(0)   // 98-01 : non tonal
    expect(analyzeKt(s, 50).kt).toBe(5)        // MELCCFP : tonal
  })

  it('160 Hz tonal en 98-01 si émergence ≥ 15', () => {
    expect(analyzeKt9801(spec160(16), 50).kt).toBe(5)
  })

  it('significativité : exclu si (global − bande) > 14,5', () => {
    // band 160 Hz : LAeq_band = (50+16) + A_WEIGHT[160](−13,4) = 52,6.
    const s = spec160(16)
    expect(analyzeKt9801(s, 65).kt).toBe(5)  // 65 − 52,6 = 12,4 ≤ 14,5 → significatif
    expect(analyzeKt9801(s, 70).kt).toBe(0)  // 70 − 52,6 = 17,4 > 14,5 → exclu
  })
})

// ─────────────────────────────────────────────────────────────────────────
// leqOnRegPeriod — Leq par période réglementaire (jour/soir/nuit) + couverture
// ─────────────────────────────────────────────────────────────────────────
describe('leqOnRegPeriod — Leq période + couverture', () => {
  const s = (t: number, laeq: number) => ({ t, laeq })

  it('moyenne ÉNERGÉTIQUE (pas arithmétique) sur le jour', () => {
    // 60 et 70 dB → laeqAvg ≈ 67,4 (et non 65).
    const r = leqOnRegPeriod([s(8 * 60, 60), s(9 * 60, 70)], 7, 19)
    expect(r.leq).toBeCloseTo(67.4, 1)
    expect(r.periodMin).toBe(720)
    expect(r.coveredMin).toBe(2)
  })

  it('affecte chaque échantillon à la bonne période', () => {
    const data = [s(8 * 60, 50), s(20 * 60, 60), s(23 * 60, 40)]
    expect(leqOnRegPeriod(data, 7, 19).leq).toBe(50)  // jour 08h
    expect(leqOnRegPeriod(data, 19, 22).leq).toBe(60) // soir 20h
    expect(leqOnRegPeriod(data, 22, 7).leq).toBe(40)  // nuit 23h
  })

  it('gère le passage minuit (nuit 22-07)', () => {
    const data = [s(23 * 60, 45), s(2 * 60, 45)] // 23h et 02h = nuit
    const nuit = leqOnRegPeriod(data, 22, 7)
    expect(nuit.leq).toBe(45)
    expect(nuit.coveredMin).toBe(2)
    expect(nuit.periodMin).toBe(540)
    expect(leqOnRegPeriod(data, 7, 19).leq).toBeNull() // jour : rien
  })

  it('couverture partielle (< 100 %)', () => {
    // 120 minutes distinctes couvertes sur 720 (jour) → 1/6.
    const data = Array.from({ length: 120 }, (_, i) => s(7 * 60 + i, 55))
    const r = leqOnRegPeriod(data, 7, 19)
    expect(r.leq).toBeCloseTo(55, 6)
    expect(r.coveredMin).toBe(120)
    expect(r.periodMin).toBe(720)
    expect(r.coveredMin / r.periodMin).toBeCloseTo(1 / 6, 5)
  })

  it('période absente → leq null, couverture 0', () => {
    const soir = leqOnRegPeriod([s(8 * 60, 50)], 19, 22)
    expect(soir.leq).toBeNull()
    expect(soir.coveredMin).toBe(0)
    expect(soir.periodMin).toBe(180)
  })

  it('plusieurs échantillons dans la même minute = 1 minute couverte', () => {
    const data = [s(480, 50), s(480.5, 50), s(480.99, 50)]
    expect(leqOnRegPeriod(data, 7, 19).coveredMin).toBe(1)
  })
})
