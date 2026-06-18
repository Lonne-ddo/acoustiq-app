import { describe, it, expect } from 'vitest'
import { computeLn, computeL10, computeL50, computeL90 } from './acoustics'

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
