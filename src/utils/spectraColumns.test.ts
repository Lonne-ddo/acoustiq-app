import { describe, it, expect } from 'vitest'
import { parseSpectrumColumn, detectFreqColumns } from './spectraColumns'
import { deweightAToZ, missingAWeightBands, A_WEIGHTING } from './weighting'
import { FormatError } from './formatError'

// ─────────────────────────────────────────────────────────────────────────────
// Reconnaissance d'en-tête : pondération A + décimale virgule
// ─────────────────────────────────────────────────────────────────────────────

describe('parseSpectrumColumn — bandes pondérées A (821SE CSV)', () => {
  it('« 1/3 LAeq 6,3 » → 6.3 Hz, pondération A', () => {
    expect(parseSpectrumColumn('1/3 LAeq 6,3')).toEqual({ type: '1/3 LAeq', freq: 6.3, weighting: 'A' })
  })

  it('« 1/3 LAeq 12,5 » → 12.5 Hz (jamais 12 : parseFloat tronquerait)', () => {
    expect(parseSpectrumColumn('1/3 LAeq 12,5')).toEqual({ type: '1/3 LAeq', freq: 12.5, weighting: 'A' })
  })

  it('« 1/3 LAFmax 1000,0 » → 1000 Hz, pondération A', () => {
    expect(parseSpectrumColumn('1/3 LAFmax 1000,0')).toEqual({ type: '1/3 LAFmax', freq: 1000, weighting: 'A' })
  })

  it('groupe fréquence GOURMAND : « 1/3 LAeq 8,0 » vaut 8, pas un match tronqué', () => {
    expect(parseSpectrumColumn('1/3 LAeq 8,0').freq).toBe(8)
    expect(parseSpectrumColumn('1/3 LAeq 63,0').freq).toBe(63)
  })

  it('bandes ≥ 100 Hz sans décimale (entiers nus de l\'export réel)', () => {
    expect(parseSpectrumColumn('1/3 LAeq 100')).toEqual({ type: '1/3 LAeq', freq: 100, weighting: 'A' })
    expect(parseSpectrumColumn('1/3 LAeq 20000')).toEqual({ type: '1/3 LAeq', freq: 20000, weighting: 'A' })
  })

  it('LAFmin reconnu (jeu min de l\'export A)', () => {
    expect(parseSpectrumColumn('1/3 LAFmin 31,5')).toEqual({ type: '1/3 LAFmin', freq: 31.5, weighting: 'A' })
  })

  it('LAeq LARGE BANDE (sans fréquence) n\'est pas une bande', () => {
    expect(parseSpectrumColumn('LAeq').type).toBeNull()
    expect(parseSpectrumColumn('LAFmax').type).toBeNull()
  })

  it('libellé à deux séparateurs → refusé (pas de fréquence inventée)', () => {
    expect(parseSpectrumColumn('1/3 LAeq 1.000,0').type).toBeNull()
  })
})

describe('parseSpectrumColumn — non-régression des cas Z', () => {
  const zCases: Array<[string, string, number]> = [
    ['1/3 LZeq 6.3', '1/3 LZeq', 6.3],
    ['1/3 LZeq 31.5', '1/3 LZeq', 31.5],
    ['1/3 LZeq 31,5', '1/3 LZeq', 31.5],
    ['1/3 LZeq 1000', '1/3 LZeq', 1000],
    ['1/3 Leq Z 500', '1/3 LZeq', 500],
    ['1/3 LZFmax 6.3', '1/3 LZFmax', 6.3],
    ['1/3 LZmax 6.3', '1/3 LZFmax', 6.3],
    ['1/3 LZFmin 20000', '1/3 LZFmin', 20000],
    ['1/1 LZeq 8.0', '1/1 LZeq', 8],
    ['1/1 LZFmax 1000', '1/1 LZFmax', 1000],
  ]
  for (const [header, type, freq] of zCases) {
    it(`« ${header} » → ${type} @ ${freq} Hz, pondération Z`, () => {
      expect(parseSpectrumColumn(header)).toEqual({ type, freq, weighting: 'Z' })
    })
  }

  it('fréquence nue (autres exports) → Z par convention historique', () => {
    expect(parseSpectrumColumn('1000')).toEqual({ type: 'number', freq: 1000, weighting: 'Z' })
    expect(parseSpectrumColumn('16k')).toEqual({ type: 'number', freq: 16000, weighting: 'Z' })
    expect(parseSpectrumColumn('31.5 Hz')).toEqual({ type: 'number', freq: 31.5, weighting: 'Z' })
  })

  it('hors plage 6 Hz – 20 kHz et non-bandes → rejetés', () => {
    expect(parseSpectrumColumn('1/3 LZeq 4').type).toBeNull()
    expect(parseSpectrumColumn('1/3 LAeq 25000').type).toBeNull()
    expect(parseSpectrumColumn('Date / heure').type).toBeNull()
    expect(parseSpectrumColumn('').type).toBeNull()
    expect(parseSpectrumColumn(null).type).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sélection du jeu de bandes
// ─────────────────────────────────────────────────────────────────────────────

describe('detectFreqColumns — pondération du jeu retenu', () => {
  it('jeu A seul → weighting A, jeu Fmax apparié en A', () => {
    const headers = [
      'Date / heure', 'LAeq',
      '1/3 LAeq 6,3', '1/3 LAeq 8,0', '1/3 LAeq 10,0', '1/3 LAeq 12,5', '1/3 LAeq 16,0', '1/3 LAeq 20,0',
      '1/3 LAFmax 6,3', '1/3 LAFmax 8,0', '1/3 LAFmax 10,0', '1/3 LAFmax 12,5', '1/3 LAFmax 16,0', '1/3 LAFmax 20,0',
    ]
    const fc = detectFreqColumns(headers)
    expect(fc?.weighting).toBe('A')
    expect(fc?.freqs).toEqual([6.3, 8, 10, 12.5, 16, 20])
    expect(fc?.cols).toEqual([2, 3, 4, 5, 6, 7])
    expect(fc?.maxCols).toEqual([8, 9, 10, 11, 12, 13])
  })

  it('A et Z coexistants → Z gagne (mesure native avant reconstruction)', () => {
    const headers = [
      '1/3 LAeq 100', '1/3 LAeq 125', '1/3 LAeq 160', '1/3 LAeq 200', '1/3 LAeq 250', '1/3 LAeq 315',
      '1/3 LZeq 100', '1/3 LZeq 125', '1/3 LZeq 160', '1/3 LZeq 200', '1/3 LZeq 250', '1/3 LZeq 315',
    ]
    const fc = detectFreqColumns(headers)
    expect(fc?.weighting).toBe('Z')
    expect(fc?.cols).toEqual([6, 7, 8, 9, 10, 11])
  })

  it('jeu Fmax d\'une AUTRE pondération n\'est jamais apparié (pas de spectre mixte)', () => {
    const headers = [
      '1/3 LAeq 100', '1/3 LAeq 125', '1/3 LAeq 160', '1/3 LAeq 200', '1/3 LAeq 250', '1/3 LAeq 315',
      '1/3 LZFmax 100', '1/3 LZFmax 125', '1/3 LZFmax 160', '1/3 LZFmax 200', '1/3 LZFmax 250', '1/3 LZFmax 315',
    ]
    const fc = detectFreqColumns(headers)
    expect(fc?.weighting).toBe('A')
    expect(fc?.maxCols).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Dépondération A → Z
// ─────────────────────────────────────────────────────────────────────────────

describe('deweightAToZ', () => {
  it('LZ = LA − A(f), exact à la table', () => {
    expect(deweightAToZ([-29.1, 0, 63.7], [6.3, 1000, 1000])).toEqual([-29.1 + 85.4, 0, 63.7])
    expect(deweightAToZ([10], [31.5])[0]).toBeCloseTo(49.4, 10)
  })

  it('aller-retour A → Z → A neutre sur toutes les bandes de la table', () => {
    const freqs = Object.keys(A_WEIGHTING).map(Number)
    const la = freqs.map((_, i) => 40 + i * 0.7)
    const back = deweightAToZ(la, freqs).map((z, i) => z + A_WEIGHTING[freqs[i]])
    back.forEach((v, i) => expect(v).toBeCloseTo(la[i], 10))
  })

  it('bande absente de A_WEIGHTING → FormatError explicite, jamais NaN ni 0 dB', () => {
    expect(() => deweightAToZ([50], [4500])).toThrow(FormatError)
    expect(() => deweightAToZ([50], [4500])).toThrow(/4500 Hz/)
    // La garde amont voit la même bande.
    expect(missingAWeightBands([1000, 4500, 31.5])).toEqual([4500])
    expect(missingAWeightBands([6.3, 31.5, 12500, 20000])).toEqual([])
  })

  it('alignement bande↔fréquence rompu → FormatError, jamais de troncature muette', () => {
    expect(() => deweightAToZ([50, 60], [1000])).toThrow(FormatError)
  })

  it('A_WEIGHTING couvre les 36 bandes 6,3 Hz – 20 kHz de l\'export 821SE', () => {
    const bands = [
      6.3, 8, 10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315,
      400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000,
      10000, 12500, 16000, 20000,
    ]
    expect(missingAWeightBands(bands)).toEqual([])
    // Clés de lookup issues d'un libellé à virgule : elles doivent tomber juste.
    expect(A_WEIGHTING[Number('6,3'.replace(',', '.'))]).toBe(-85.4)
    expect(A_WEIGHTING[Number('31,5'.replace(',', '.'))]).toBe(-39.4)
    expect(A_WEIGHTING[Number('12,5'.replace(',', '.'))]).toBe(-63.4)
  })
})
