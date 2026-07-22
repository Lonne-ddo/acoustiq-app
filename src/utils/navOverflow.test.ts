import { describe, it, expect } from 'vitest'
import { computeVisibleCount } from './navOverflow'

// Largeurs synthétiques (px). Onglet 0 = « Analyse » (prioritaire), dernier = diag.
const W7 = [90, 80, 85, 70, 120, 95, 110]              // 7 onglets (défaut)
const W12 = [90, 100, 95, 70, 85, 90, 100, 80, 70, 130, 95, 110] // 12 (tous flags)
const PLUS = 60

describe('computeVisibleCount — repli « Plus » de la barre primaire', () => {
  it('tout tient (largeur généreuse) → aucun repli (7 onglets)', () => {
    const total = W7.reduce((s, w) => s + w, 0) + 4 * 6 + 13
    expect(computeVisibleCount({ widths: W7, availPx: total + 50, plusPx: PLUS, hasDiag: true })).toBe(7)
  })

  it('tout tient (largeur généreuse) → aucun repli (12 onglets)', () => {
    const total = W12.reduce((s, w) => s + w, 0) + 4 * 11 + 13
    expect(computeVisibleCount({ widths: W12, availPx: total, plusPx: PLUS, hasDiag: true })).toBe(12)
  })

  it('12 onglets, largeur contrainte → repli, ≥ 1 dans « Plus »', () => {
    const n = computeVisibleCount({ widths: W12, availPx: 600, plusPx: PLUS, hasDiag: true })
    expect(n).toBeGreaterThanOrEqual(1)
    expect(n).toBeLessThan(12) // il reste du débordement
  })

  it('« Analyse » (index 0) toujours visible même à largeur minuscule', () => {
    expect(computeVisibleCount({ widths: W12, availPx: 10, plusPx: PLUS, hasDiag: true })).toBe(1)
    expect(computeVisibleCount({ widths: W7, availPx: 0, plusPx: PLUS, hasDiag: true })).toBe(1)
  })

  it('le diagnostic (dernier) bascule dans « Plus » EN PREMIER', () => {
    // Largeur qui laisse tomber exactement le dernier : total - dernier - gap tient,
    // mais total complet non → visibleCount = 11 (diag en overflow).
    const total = W12.reduce((s, w) => s + w, 0) + 4 * 11 + 13
    const availJustUnder = total - 1 // ne tient pas d'un cheveu → repli
    const n = computeVisibleCount({ widths: W12, availPx: availJustUnder, plusPx: PLUS, hasDiag: true })
    expect(n).toBeLessThanOrEqual(11)     // le dernier (diag) est parti
    expect(n).toBeGreaterThanOrEqual(1)   // Analyse gardée
  })

  it('réduction monotone : plus la largeur baisse, moins d’onglets visibles', () => {
    const wide = computeVisibleCount({ widths: W12, availPx: 900, plusPx: PLUS, hasDiag: true })
    const narrow = computeVisibleCount({ widths: W12, availPx: 400, plusPx: PLUS, hasDiag: true })
    expect(narrow).toBeLessThanOrEqual(wide)
  })

  it('liste vide → 0', () => {
    expect(computeVisibleCount({ widths: [], availPx: 500, plusPx: PLUS })).toBe(0)
  })
})
