import { describe, it, expect } from 'vitest'
import {
  analyzeKt,
  analyzeKt9801,
  checkKtAlignment,
  detectKt,
  computeKt,
  KT_BAND_FREQS,
} from './acoustics'

/**
 * GARDE-FOU D'ALIGNEMENT DES BANDES (G1/G2/G3).
 *
 * `analyzeKt` associe `spectrum[i]` à `KT_BAND_FREQS[i]` par INDEX. Un spectre
 * qui ne commence pas à 50 Hz produisait donc un Kt numérique calculé sur les
 * mauvaises bandes — un échec technique déguisé en fait de donnée. Sur le 821SE,
 * la régression était pire qu'un chiffre faux : avant le support du spectre A,
 * Kt était visiblement non calculable ; après, il devenait faux en silence.
 *
 * Règle verrouillée ici : AUCUN spectre désaligné ne produit de Kt numérique.
 */

/** Spectre plat 24 bandes avec une émergence de 10 dB sur la 6ᵉ (160 Hz). */
const tonalSpectrum = (n = 24) => {
  const s = new Array(n).fill(50)
  s[5] = 60
  return s
}

/** Les 36 bandes réelles d'un export G4 (821SE CSV / G4 FR) : démarre à 6,3 Hz. */
const FREQS_36 = [
  6.3, 8, 10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315,
  400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
  10000, 12500, 16000, 20000,
]

/** Les 27 bandes du bloc positionnel 831C : démarre à 50 Hz = KT_BAND_FREQS[0]. */
const FREQS_831C = [
  50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
]

describe('checkKtAlignment', () => {
  it('bandes 831C (1ʳᵉ bande 50 Hz) → aligné', () => {
    expect(checkKtAlignment(new Array(27).fill(50), FREQS_831C)).toBeNull()
  })

  it('bandes d\'analyse elles-mêmes → aligné', () => {
    expect(checkKtAlignment(new Array(24).fill(50), KT_BAND_FREQS)).toBeNull()
  })

  it('spectre démarrant à 6,3 Hz (821SE / G4 FR) → refusé, motif nommant la fréquence', () => {
    const u = checkKtAlignment(new Array(36).fill(50), FREQS_36)
    expect(u?.reason).toBe('alignement-non-verifiable')
    expect(u?.message).toBe(
      'Tonalité non évaluable — alignement des bandes non vérifiable '
      + '(spectre débute à 6.3 Hz, analyse attendue à 50 Hz).',
    )
  })

  it('spectre démarrant à 100 Hz (G4 FR avant le support de la virgule) → refusé', () => {
    const freqs = FREQS_36.slice(FREQS_36.indexOf(100))
    const u = checkKtAlignment(new Array(freqs.length).fill(50), freqs)
    expect(u?.reason).toBe('alignement-non-verifiable')
    expect(u?.message).toContain('spectre débute à 100 Hz')
  })

  it('fréquences absentes → refusé (ne pas pouvoir vérifier n\'autorise pas à supposer)', () => {
    const u = checkKtAlignment(new Array(24).fill(50), undefined)
    expect(u?.reason).toBe('alignement-non-verifiable')
    expect(u?.message).toContain('fréquences des bandes inconnues')
  })

  it('nombre de fréquences ≠ nombre de niveaux → refusé', () => {
    const u = checkKtAlignment(new Array(24).fill(50), FREQS_831C)
    expect(u?.message).toContain('24 niveaux pour 27 fréquences')
  })

  it('bonne 1ʳᵉ bande mais découpage divergent ensuite → refusé, bande nommée', () => {
    const freqs = [...KT_BAND_FREQS]
    freqs[3] = 110 // au lieu de 100
    const u = checkKtAlignment(new Array(24).fill(50), freqs)
    expect(u?.message).toContain('bande n°4 : 110 Hz dans le spectre, 100 Hz attendu')
  })
})

describe('analyzeKt — aucun Kt numérique sur un spectre désaligné (G1)', () => {
  it('831C aligné → Kt calculé', () => {
    const a = analyzeKt(tonalSpectrum(27), 50, FREQS_831C)
    expect(a.unavailable).toBeNull()
    expect(a.kt).toBe(5)
    expect(a.bands.length).toBeGreaterThan(0)
  })

  it('821SE (6,3 Hz) → non calculable, aucune bande, motif explicite', () => {
    const a = analyzeKt(tonalSpectrum(36), 50, FREQS_36)
    expect(a.unavailable?.reason).toBe('alignement-non-verifiable')
    expect(a.bands).toEqual([])
    expect(a.triggeringIndex).toBeNull()
  })

  it('G4 FR (100 Hz) → non calculable', () => {
    const freqs = FREQS_36.slice(FREQS_36.indexOf(100))
    expect(analyzeKt(tonalSpectrum(freqs.length), 50, freqs).unavailable?.reason)
      .toBe('alignement-non-verifiable')
  })

  it('spectre vide → motif DISTINCT de l\'alignement', () => {
    const a = analyzeKt([], 50, KT_BAND_FREQS)
    expect(a.unavailable?.reason).toBe('aucune-donnee-spectrale')
    expect(a.unavailable?.message).toBe('Tonalité non évaluable — aucune donnée spectrale.')
  })

  it('un spectre désaligné ne produit JAMAIS de bande tonale', () => {
    for (const freqs of [FREQS_36, FREQS_36.slice(4), undefined]) {
      const a = analyzeKt(tonalSpectrum(freqs?.length ?? 24), 50, freqs)
      expect(a.unavailable).not.toBeNull()
      expect(a.bands.some((b) => b.isTonal)).toBe(false)
    }
  })
})

describe('analyzeKt9801 — même garde-fou (G3)', () => {
  it('aligné → calculé', () => {
    const a = analyzeKt9801(tonalSpectrum(27), 50, FREQS_831C)
    expect(a.unavailable).toBeNull()
    expect(a.bands.length).toBeGreaterThan(0)
  })

  it('désaligné → non calculable, pas de résultat numérique', () => {
    const a = analyzeKt9801(tonalSpectrum(36), 50, FREQS_36)
    expect(a.unavailable?.reason).toBe('alignement-non-verifiable')
    expect(a.bands).toEqual([])
  })
})

describe('detectKt / computeKt — le motif remonte au lieu d\'un 0 muet', () => {
  it('aligné → détection normale', () => {
    const d = detectKt(tonalSpectrum(27), 50, FREQS_831C)
    expect(d.unavailable).toBeNull()
    expect(d.detected).toBe(true)
    expect(d.fc).toBe(160)
    expect(computeKt(tonalSpectrum(27), 50, FREQS_831C)).toBe(5)
  })

  it('désaligné → detected=false MAIS motif porté (≠ « pas de tonalité »)', () => {
    const d = detectKt(tonalSpectrum(36), 50, FREQS_36)
    expect(d.detected).toBe(false)
    expect(d.kt).toBe(0)
    expect(d.unavailable?.reason).toBe('alignement-non-verifiable')
  })

  it('aligné et non tonal → detected=false SANS motif (vraie absence de tonalité)', () => {
    const d = detectKt(new Array(27).fill(50), 50, FREQS_831C)
    expect(d.detected).toBe(false)
    expect(d.unavailable).toBeNull()
  })
})
