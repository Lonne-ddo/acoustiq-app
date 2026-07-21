import { describe, it, expect } from 'vitest'
import {
  classifyCorr9801,
  corr9801CauseMessage,
  computeCorr9801Point,
  type Corr9801Facts,
} from './corr9801'
import type { DataPoint } from '../types'

const facts = (over: Partial<Corr9801Facts>): Corr9801Facts => ({
  hasData: true,
  lceqPresent: true,
  lceqFinite: true,
  lafmaxPresent: true,
  laftm5IsNull: false,
  spectrumPresent: true,
  spectrumValid: true,
  ...over,
})

describe('classifyCorr9801 — cause typée par terme (PURE)', () => {
  it('Kb sans LCeq → no-lceq', () =>
    expect(classifyCorr9801('kb', facts({ lceqPresent: false }))).toBe('no-lceq'))
  it('Kb LCeq présent mais non fini → invalid-values', () =>
    expect(classifyCorr9801('kb', facts({ lceqPresent: true, lceqFinite: false }))).toBe(
      'invalid-values',
    ))
  it('Ki sans LAFmax → no-lafmax', () =>
    expect(classifyCorr9801('ki', facts({ lafmaxPresent: false }))).toBe('no-lafmax'))
  it('Ki LAFmax présent mais LAFTM5 null → invalid-values', () =>
    expect(classifyCorr9801('ki', facts({ laftm5IsNull: true }))).toBe('invalid-values'))
  it('Kt sans spectre → no-spectrum', () =>
    expect(classifyCorr9801('kt', facts({ spectrumPresent: false }))).toBe('no-spectrum'))
  it('Kt spectre présent mais invalide (bande non finie) → invalid-values', () =>
    expect(classifyCorr9801('kt', facts({ spectrumPresent: true, spectrumValid: false }))).toBe(
      'invalid-values',
    ))
  it('fenêtre vide → no-data', () => {
    expect(classifyCorr9801('kt', facts({ hasData: false }))).toBe('no-data')
    expect(classifyCorr9801('ki', facts({ hasData: false }))).toBe('no-data')
    expect(classifyCorr9801('kb', facts({ hasData: false }))).toBe('no-data')
  })
  it('cas INATTENDU (tous les faits présents) → unknown, jamais un kind spécifique', () => {
    expect(classifyCorr9801('kb', facts({}))).toBe('unknown')
    expect(classifyCorr9801('kt', facts({}))).toBe('unknown')
    expect(classifyCorr9801('ki', facts({}))).toBe('unknown')
    expect(classifyCorr9801('kb', facts({}))).not.toBe('no-lceq')
  })
})

describe('corr9801CauseMessage — libellés acousticiens exacts', () => {
  it('no-lceq', () =>
    expect(corr9801CauseMessage('kb', 'no-lceq')).toBe('Kb indisponible — LCeq absent du fichier source'))
  it('no-lafmax', () =>
    expect(corr9801CauseMessage('ki', 'no-lafmax')).toBe(
      'Ki indisponible — LAFmax 1 s absent du fichier source',
    ))
  it('no-spectrum', () =>
    expect(corr9801CauseMessage('kt', 'no-spectrum')).toBe(
      "Kt indisponible — spectre 1/3 d'octave absent du fichier source",
    ))
  it('invalid-values', () =>
    expect(corr9801CauseMessage('kb', 'invalid-values')).toBe(
      'Kb indisponible — valeurs présentes mais non exploitables (non finies)',
    ))
  it('no-data', () =>
    expect(corr9801CauseMessage('ki', 'no-data')).toBe(
      'Ki indisponible — aucune donnée sur la fenêtre sélectionnée',
    ))
  it('unknown', () =>
    expect(corr9801CauseMessage('kb', 'unknown')).toBe('Kb indisponible — cause inconnue'))
})

// ── Tests VALEUR : NaN ⇒ invalid-values, JAMAIS un correctif de 0 ────────────

const dp = (over: Partial<DataPoint>): DataPoint => ({ t: 0, laeq: 50, ...over })

describe('computeCorr9801Point — Number.isFinite : NaN ⇒ indispo, pas 0', () => {
  it('Kb : LCeq = NaN → indispo (invalid-values), PAS 0,0 dB', () => {
    const r = computeCorr9801Point([dp({ lceq: NaN }), dp({ lceq: NaN })])
    expect(r.kb.value).toBeNull() // surtout pas 0
    expect(r.kb.value).not.toBe(0)
    expect(r.kb.cause).toBe('invalid-values')
  })

  it('Kb : LCeq absent → no-lceq (distinct de invalid-values)', () => {
    const r = computeCorr9801Point([dp({}), dp({})])
    expect(r.kb.value).toBeNull()
    expect(r.kb.cause).toBe('no-lceq')
  })

  it('Kb : LCeq fini → valeur inchangée (75 vs LAeq 50 ⇒ 25 dB), LCeq conservé', () => {
    const r = computeCorr9801Point([dp({ laeq: 50, lceq: 75 })])
    expect(r.kb.value).toBeCloseTo(25, 6)
    expect(r.kb.lceq).toBeCloseTo(75, 6)
    expect(r.kb.cause).toBeNull()
  })

  it('Kt : une bande NaN → indispo (invalid-values), PAS un Kt calculé', () => {
    const r = computeCorr9801Point([dp({ spectra: [60, NaN, 55] })])
    expect(r.kt.value).toBeNull()
    expect(r.kt.value).not.toBe(0)
    expect(r.kt.cause).toBe('invalid-values')
  })

  it('Kt : spectre absent → no-spectrum', () => {
    const r = computeCorr9801Point([dp({})])
    expect(r.kt.value).toBeNull()
    expect(r.kt.cause).toBe('no-spectrum')
  })

  it('Ki : LAFmax = NaN → invalid-values (déjà) ; LAFmax absent → no-lafmax', () => {
    expect(computeCorr9801Point([dp({ lafmax: NaN })]).ki.cause).toBe('invalid-values')
    expect(computeCorr9801Point([dp({})]).ki.cause).toBe('no-lafmax')
  })

  it('fenêtre vide → les 3 termes no-data', () => {
    const r = computeCorr9801Point([])
    expect(r.kt.cause).toBe('no-data')
    expect(r.ki.cause).toBe('no-data')
    expect(r.kb.cause).toBe('no-data')
  })
})
