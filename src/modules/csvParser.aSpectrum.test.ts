import { describe, it, expect } from 'vitest'
import { parseCsv } from './csvParser'
import { A_WEIGHTING } from '../utils/weighting'
import { CSV_821SE_A_SPECTRUM } from '../fixtures/csv821SE'

/**
 * Spectre pondéré A du 821SE (CSV « Histoire du temps ») — sur FIXTURE RÉELLE.
 *
 * Ce format n'exporte AUCUNE colonne 1/3 LZeq : le spectre n'existe qu'en
 * dB(A). Le parser l'inverse (`LZ = LA − A(f)`) pour que `DataPoint.spectra`
 * reste du LZeq comme pour tous les autres formats, et marque le fichier
 * `spectraSource: 'A-déponderé'`.
 */

const BANDS_36 = [
  6.3, 8, 10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315,
  400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
  10000, 12500, 16000, 20000,
]

/** Somme énergétique (dB) d'un jeu de niveaux. */
const energySum = (levels: number[]): number =>
  10 * Math.log10(levels.reduce((acc, v) => acc + 10 ** (v / 10), 0))

const fixtureBlob = () => new Blob([CSV_821SE_A_SPECTRUM])

describe('821SE CSV — spectre A dépondéré (fixture réelle)', () => {
  it('détecte les 36 bandes A et les stocke en LZeq', async () => {
    const f = await parseCsv(fixtureBlob(), 'histoire.csv')

    expect(f.spectraFreqs).toEqual(BANDS_36)
    expect(f.spectraSource).toBe('A-déponderé')
    expect(f.spectraUnavailable).toBeUndefined()

    const dp = f.data[0]
    expect(dp.spectra).toHaveLength(36)
    // Ligne réelle : « 1/3 LAeq 6,3 » = −23,2 dB(A) → LZ = −23,2 − (−85,4).
    expect(dp.spectra![0]).toBeCloseTo(-23.2 + 85.4, 6)
    // « 1/3 LAeq 1000 » = 63,7 dB(A), A(1000) = 0 → inchangé.
    expect(dp.spectra![22]).toBeCloseTo(63.7, 6)
    // Le jeu Fmax est apparié sur la MÊME pondération, donc dépondéré aussi.
    expect(dp.spectraMax).toHaveLength(36)
    expect(dp.spectraMax![22]).toBeCloseTo(65.1, 6)
  })

  it('T5 — bilan énergétique : Σ des 36 bandes repondérées A = LAeq large bande (< 0,2 dB)', async () => {
    const f = await parseCsv(fixtureBlob(), 'histoire.csv')
    expect(f.data.length).toBeGreaterThanOrEqual(3)

    for (const dp of f.data) {
      const backToA = dp.spectra!.map((z, i) => z + A_WEIGHTING[BANDS_36[i]])
      const ecart = Math.abs(energySum(backToA) - dp.laeq)
      expect(ecart).toBeLessThan(0.2)
    }
  })

  it('T7 — champ « Surcharge » vide NON quoté : aucun décalage de colonne', async () => {
    const f = await parseCsv(fixtureBlob(), 'histoire.csv')

    // 3 lignes de données : la ligne marqueur « Début » est sautée, pas décalée.
    expect(f.data).toHaveLength(3)
    // Colonnes large bande lues DE PART ET D'AUTRE du champ vide — un décalage
    // d'un seul cran ferait remonter LApk (84,5) ou LCeq (79,3) dans LAeq.
    expect(f.data.map((d) => d.laeq)).toEqual([72.2, 71.2, 70])
    expect(f.data[0].lceq).toBe(79.3)
    expect(f.data[0].laftEq).toBe(73.5) // LAImax, idx 17 — après la Surcharge vide
  })
})
