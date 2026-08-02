import { describe, it, expect } from 'vitest'
import {
  analyzeKt,
  analyzeKt9801,
  checkKtAlignment,
  ktLevelsByFrequency,
  detectKt,
  computeKt,
  KT_BAND_FREQS,
} from './acoustics'

/**
 * INDEXATION DES BANDES D'ANALYSE TONALE — par FRÉQUENCE, plus par index.
 *
 * `analyzeKt` associait `spectrum[i]` à `KT_BAND_FREQS[i]`. Le seul spectre
 * naturellement aligné était le bloc positionnel 831C (1ʳᵉ bande 50 Hz) ; les
 * exports G4 français et 821SE démarrent à 6,3 Hz, soit NEUF bandes de
 * décalage — mauvais seuil, mauvaise pondération A, mauvais test d'exclusion.
 *
 * Chaque bande d'analyse est désormais retrouvée par sa fréquence. Deux règles
 * verrouillées ici :
 *   - un spectre qui COUVRE la plage d'analyse est exploitable, où qu'il
 *     commence (c'est le correctif) ;
 *   - un spectre à qui MANQUE une bande d'analyse est refusé avec un motif,
 *     jamais analysé sur un jeu troué (les Δ se calculent entre bandes
 *     adjacentes : un trou les fausserait en silence).
 */

/** Spectre plat 50 dB, émergence de 25 dB sur la bande `freq`. */
function spectrumWithPeak(freqs: number[], peakFreq: number): number[] {
  return freqs.map((f) => (f === peakFreq ? 75 : 50))
}

/** Les 36 bandes d'un export G4 FR / 821SE : démarre à 6,3 Hz. */
const FREQS_36 = [
  6.3, 8, 10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315,
  400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
  10000, 12500, 16000, 20000,
]

/** Les 27 bandes du bloc positionnel 831C : démarre à 50 Hz. */
const FREQS_831C = FREQS_36.slice(FREQS_36.indexOf(50))

describe('ktLevelsByFrequency — réordonnancement sur les bandes d\'analyse', () => {
  it('831C (50 Hz →) : les 24 bandes sont retrouvées', () => {
    const r = ktLevelsByFrequency(new Array(27).fill(50), FREQS_831C)
    expect('levels' in r && r.levels).toHaveLength(24)
  })

  it('821SE / G4 FR (6,3 Hz →) : les 24 bandes sont retrouvées MALGRÉ le décalage', () => {
    const spectrum = FREQS_36.map((f) => f) // niveau = fréquence, traçable
    const r = ktLevelsByFrequency(spectrum, FREQS_36)
    expect('levels' in r).toBe(true)
    if ('levels' in r) {
      // Chaque niveau doit être celui de SA fréquence, pas celui de l'index.
      expect(r.levels).toEqual(KT_BAND_FREQS)
      expect(r.levels[0]).toBe(50)      // et non 6.3 (ancien comportement)
      expect(r.levels[23]).toBe(10000)
    }
  })

  it('bande d\'analyse absente → motif la nommant', () => {
    const freqs = FREQS_36.slice(FREQS_36.indexOf(100)) // 50, 63, 80 manquent
    const r = ktLevelsByFrequency(new Array(freqs.length).fill(50), freqs)
    expect('levels' in r).toBe(false)
    if (!('levels' in r)) {
      expect(r.reason).toBe('bande-analyse-absente')
      expect(r.message).toBe(
        'Tonalité non évaluable — la bande d\'analyse 50 Hz est absente du spectre '
        + '(bandes 50 Hz – 10000 Hz requises).',
      )
    }
  })

  it('trou AU MILIEU de la plage → refusé (les Δ seraient faussés en silence)', () => {
    const freqs = FREQS_36.filter((f) => f !== 1000)
    const r = ktLevelsByFrequency(new Array(freqs.length).fill(50), freqs)
    expect('levels' in r).toBe(false)
    if (!('levels' in r)) {
      expect(r.reason).toBe('bande-analyse-absente')
      expect(r.message).toContain('1000 Hz est absente')
    }
  })

  it('fréquences inconnues → refusé (ne pas pouvoir vérifier n\'autorise pas à supposer)', () => {
    const r = ktLevelsByFrequency(new Array(24).fill(50), undefined)
    expect('levels' in r).toBe(false)
    if (!('levels' in r)) {
      expect(r.reason).toBe('alignement-non-verifiable')
      expect(r.message).toContain('fréquences des bandes inconnues')
    }
  })

  it('nombre de fréquences ≠ nombre de niveaux → refusé', () => {
    const r = ktLevelsByFrequency(new Array(24).fill(50), FREQS_831C)
    expect('levels' in r).toBe(false)
    if (!('levels' in r)) {
      expect(r.reason).toBe('alignement-non-verifiable')
      expect(r.message).toContain('24 niveaux pour 27 fréquences')
    }
  })

  it('checkKtAlignment reste cohérent avec ktLevelsByFrequency', () => {
    expect(checkKtAlignment(new Array(27).fill(50), FREQS_831C)).toBeNull()
    expect(checkKtAlignment(new Array(36).fill(50), FREQS_36)).toBeNull()
    expect(checkKtAlignment(new Array(24).fill(50), undefined)?.reason)
      .toBe('alignement-non-verifiable')
  })
})

describe('analyzeKt — le décalage de 9 bandes est corrigé', () => {
  it('821SE (6,3 Hz →) : Kt calculé, et la bande tonale est la BONNE', () => {
    const a = analyzeKt(spectrumWithPeak(FREQS_36, 160), 50, FREQS_36)
    expect(a.unavailable).toBeNull()
    expect(a.bands).toHaveLength(24)
    expect(a.kt).toBe(5)
    expect(a.bands[a.triggeringIndex as number].freq).toBe(160)
  })

  it('même spectre, indexé par fréquence ≡ ses 24 bandes 50 Hz – 10 kHz extraites', () => {
    const spectrum = spectrumWithPeak(FREQS_36, 160)
    const extrait = KT_BAND_FREQS.map((f) => spectrum[FREQS_36.indexOf(f)])
    const parFreq = analyzeKt(spectrum, 50, FREQS_36)
    const direct = analyzeKt(extrait, 50, KT_BAND_FREQS)
    expect(parFreq.bands).toEqual(direct.bands)
    expect(parFreq.kt).toBe(direct.kt)
    expect(parFreq.triggeringIndex).toBe(direct.triggeringIndex)
  })

  it('l\'ancien adressage par index aurait désigné une AUTRE bande', () => {
    // Émergence posée sur 160 Hz, à l'index 14 du spectre 36 bandes. L'ancien
    // code lisait KT_BAND_FREQS[14] = 1250 Hz : bande fausse, seuil faux.
    expect(FREQS_36.indexOf(160)).toBe(14)
    expect(KT_BAND_FREQS[14]).toBe(1250)
    const a = analyzeKt(spectrumWithPeak(FREQS_36, 160), 50, FREQS_36)
    expect(a.bands[a.triggeringIndex as number].freq).not.toBe(1250)
  })

  it('831C bloc positionnel (50 Hz →) : inchangé', () => {
    const a = analyzeKt(spectrumWithPeak(FREQS_831C, 160), 50, FREQS_831C)
    expect(a.unavailable).toBeNull()
    expect(a.bands).toHaveLength(24)
    expect(a.bands[a.triggeringIndex as number].freq).toBe(160)
  })

  it('spectre vide → motif DISTINCT', () => {
    const a = analyzeKt([], 50, KT_BAND_FREQS)
    expect(a.unavailable?.reason).toBe('aucune-donnee-spectrale')
    expect(a.unavailable?.message).toBe('Tonalité non évaluable — aucune donnée spectrale.')
  })

  it('aucun spectre refusé ne produit de bande tonale', () => {
    const troue = FREQS_36.filter((f) => f !== 1000)
    for (const [spec, freqs] of [
      [new Array(24).fill(50), undefined],
      [new Array(troue.length).fill(50), troue],
      [new Array(24).fill(50), FREQS_831C],
    ] as Array<[number[], number[] | undefined]>) {
      const a = analyzeKt(spec, 50, freqs)
      expect(a.unavailable).not.toBeNull()
      expect(a.bands).toEqual([])
      expect(a.kt).toBe(0)
    }
  })
})

describe('analyzeKt9801 — même indexation', () => {
  it('821SE (6,3 Hz →) : calculé sur les bonnes bandes', () => {
    const a = analyzeKt9801(spectrumWithPeak(FREQS_36, 160), 50, FREQS_36)
    expect(a.unavailable).toBeNull()
    expect(a.bands).toHaveLength(24)
    expect(a.bands[5].freq).toBe(160)
  })

  it('bande d\'analyse absente → refusé, pas de résultat numérique', () => {
    const freqs = FREQS_36.slice(FREQS_36.indexOf(100))
    const a = analyzeKt9801(new Array(freqs.length).fill(50), 50, freqs)
    expect(a.unavailable?.reason).toBe('bande-analyse-absente')
    expect(a.bands).toEqual([])
  })
})

describe('detectKt / computeKt', () => {
  it('821SE : détection sur la bonne fréquence', () => {
    const d = detectKt(spectrumWithPeak(FREQS_36, 160), 50, FREQS_36)
    expect(d.unavailable).toBeNull()
    expect(d.detected).toBe(true)
    expect(d.fc).toBe(160)
    expect(computeKt(spectrumWithPeak(FREQS_36, 160), 50, FREQS_36)).toBe(5)
  })

  it('spectre refusé → detected=false MAIS motif porté (≠ « pas de tonalité »)', () => {
    const d = detectKt(new Array(24).fill(50), 50, undefined)
    expect(d.detected).toBe(false)
    expect(d.kt).toBe(0)
    expect(d.unavailable?.reason).toBe('alignement-non-verifiable')
  })

  it('couvert et non tonal → detected=false SANS motif (vraie absence de tonalité)', () => {
    const d = detectKt(new Array(36).fill(50), 50, FREQS_36)
    expect(d.detected).toBe(false)
    expect(d.unavailable).toBeNull()
  })
})
