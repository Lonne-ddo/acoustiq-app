import { describe, it, expect } from 'vitest'
import { classifyCorr9801, corr9801CauseMessage, type Corr9801Facts } from './corr9801'

const facts = (over: Partial<Corr9801Facts>): Corr9801Facts => ({
  hasData: true,
  hasLceq: true,
  hasLafmax: true,
  laftm5IsNull: false,
  hasSpectrum: true,
  ...over,
})

describe('classifyCorr9801 — cause typée par terme (PURE)', () => {
  it('Kb sans LCeq → no-lceq', () => {
    expect(classifyCorr9801('kb', facts({ hasLceq: false }))).toBe('no-lceq')
  })
  it('Ki sans LAFmax → no-lafmax', () => {
    expect(classifyCorr9801('ki', facts({ hasLafmax: false }))).toBe('no-lafmax')
  })
  it('Ki avec LAFmax mais LAFTM5 null → invalid-values', () => {
    expect(classifyCorr9801('ki', facts({ hasLafmax: true, laftm5IsNull: true }))).toBe(
      'invalid-values',
    )
  })
  it('Kt sans spectre → no-spectrum', () => {
    expect(classifyCorr9801('kt', facts({ hasSpectrum: false }))).toBe('no-spectrum')
  })
  it('fenêtre vide → no-data (quel que soit le terme)', () => {
    expect(classifyCorr9801('kt', facts({ hasData: false }))).toBe('no-data')
    expect(classifyCorr9801('ki', facts({ hasData: false }))).toBe('no-data')
    expect(classifyCorr9801('kb', facts({ hasData: false }))).toBe('no-data')
  })

  it('cas INATTENDU (tous les faits présents) → unknown, JAMAIS un kind spécifique', () => {
    // Chaque terme, faits complets → aucun kind spécifique ne doit être renvoyé.
    expect(classifyCorr9801('kb', facts({}))).toBe('unknown')
    expect(classifyCorr9801('kt', facts({}))).toBe('unknown')
    expect(classifyCorr9801('ki', facts({ hasLafmax: true, laftm5IsNull: false }))).toBe('unknown')
    // garantie explicite de non-retour d'un kind spécifique :
    expect(classifyCorr9801('kb', facts({}))).not.toBe('no-lceq')
    expect(classifyCorr9801('ki', facts({}))).not.toBe('no-lafmax')
  })
})

describe('corr9801CauseMessage — libellés acousticiens exacts', () => {
  it('no-lceq (Kb)', () =>
    expect(corr9801CauseMessage('kb', 'no-lceq')).toBe(
      'Kb indisponible — LCeq absent du fichier source',
    ))
  it('no-lafmax (Ki)', () =>
    expect(corr9801CauseMessage('ki', 'no-lafmax')).toBe(
      'Ki indisponible — LAFmax 1 s absent du fichier source',
    ))
  it('no-spectrum (Kt)', () =>
    expect(corr9801CauseMessage('kt', 'no-spectrum')).toBe(
      "Kt indisponible — spectre 1/3 d'octave absent du fichier source",
    ))
  it('invalid-values (Ki)', () =>
    expect(corr9801CauseMessage('ki', 'invalid-values')).toBe(
      'Ki indisponible — LAFmax 1 s présent mais sans valeur exploitable',
    ))
  it('no-data', () =>
    expect(corr9801CauseMessage('ki', 'no-data')).toBe(
      'Ki indisponible — aucune donnée sur la fenêtre sélectionnée',
    ))
  it('unknown', () =>
    expect(corr9801CauseMessage('kb', 'unknown')).toBe('Kb indisponible — cause inconnue'))
})
