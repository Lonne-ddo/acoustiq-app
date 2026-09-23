import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Conformite2026 from '../components/Conformite2026'
import {
  evaluerFenetres,
  couvertureFenetre,
  pasFichierMin,
  libelleCouverture,
  fenetreIncomplete,
  hhmmToMinutes,
  blocCouvertureRapport,
  type CouvertureFenetre,
} from './conformiteFenetre'
import { CAS_FENETRE, fichier } from './conformiteFenetre.fixtures'
import { filterDataByPeriods } from './acoustics'

/**
 * Couverture réelle de la fenêtre LAr,1h. Valeurs ATTENDUES établies à la main
 * depuis la définition de chaque cas (conformiteFenetre.fixtures.ts), pas
 * relevées sur le code.
 */
const c = (retenues: number, m: Partial<CouvertureFenetre['manquantesMin']> = {}): CouvertureFenetre => ({
  retenuesMin: retenues,
  manquantesMin: { exclusionMeteo: 0, exclusionManuelle: 0, horsInclusion: 0, absenceDonnees: 0, ...m },
})

const ATTENDU: Record<string, CouvertureFenetre[]> = {
  complet: [c(60)],
  'exclusion-manuelle': [c(40, { exclusionManuelle: 20 })],
  'exclusion-meteo': [c(40, { exclusionMeteo: 20 })],
  'hors-inclusion': [c(30, { horsInclusion: 30 })],
  // inclusion 14:05–14:50 ; manuelle 14:20–14:25 ; météo 14:30–14:35 ; hors inclusion 14:00–14:05 + 14:50–15:00
  'causes-mixtes': [c(35, { exclusionManuelle: 5, exclusionMeteo: 5, horsInclusion: 15 })],
  'categorie-masquee': [c(60)], // catégorie masquée = exclusion neutralisée
  'absence-donnees': [c(35, { absenceDonnees: 25 })],
  // PAS MIXTES : 1800 échantillons à 1 s + 30 à 60 s = 60 minutes, pas « 1830 »
  'pas-mixtes': [c(60)],
  // RECOUVREMENT : 7200 échantillons, mais les mêmes secondes ne comptent qu'une fois
  recouvrement: [c(60)],
  minuit: [c(60)],
  'sans-br': [c(60)],
  'br-insuffisant': [c(60)],
  'k-manuels': [c(60)],
  'sans-donnees': [c(0, { absenceDonnees: 60 })],
  'deux-points': [c(45, { exclusionManuelle: 15 }), c(45, { exclusionManuelle: 15 })],
}

describe('couverture de la fenêtre — minutes retenues sur 60 et causes', () => {
  it('chaque cas du golden a sa couverture attendue', () => {
    expect(Object.keys(ATTENDU).sort()).toEqual(CAS_FENETRE.map((x) => x.id).sort())
  })

  for (const cas of CAS_FENETRE) {
    it(`${cas.id} — ${cas.titre}`, () => {
      const res = evaluerFenetres(cas.entree())
      expect(res.map((r) => r.couverture)).toEqual(ATTENDU[cas.id])
      for (const r of res) {
        const somme = r.couverture.retenuesMin + Object.values(r.couverture.manquantesMin).reduce((a, b) => a + b, 0)
        expect(somme).toBeCloseTo(60, 6)
      }
    })
  }

  it('le LAr,1h reste CALCULÉ sur une fenêtre amputée (pas de refus automatique)', () => {
    const r = evaluerFenetres(CAS_FENETRE.find((x) => x.id === 'exclusion-manuelle')!.entree())[0]
    expect(r.couverture.retenuesMin).toBe(40)
    expect(r.lar).not.toBeNull()
    expect(fenetreIncomplete(r.couverture)).toBe(true)
  })
})

describe('cohérence avec filterDataByPeriods (mêmes règles que le calcul de Ba)', () => {
  // Minutes retenues calculées sur les données DÉJÀ filtrées, sans périodes =
  // minutes retenues calculées avec les périodes : l'attribution des causes ne
  // s'écarte jamais de ce que Ba utilise réellement.
  for (const cas of CAS_FENETRE) {
    it(cas.id, () => {
      const e = cas.entree()
      const debut = hhmmToMinutes(e.evalHour)
      const filtres = e.files.map((f) => ({ ...f, data: filterDataByPeriods(f.data, f.date, e.periods, e.categories) }))
      for (const pt of new Set(Object.values(e.pointMap))) {
        const avec = couvertureFenetre(e.files, e.pointMap, e.selectedDate, pt, e.periods, e.categories, debut)
        const deja = couvertureFenetre(filtres, e.pointMap, e.selectedDate, pt, [], [], debut)
        // Le filtrage peut changer le pas médian d'un fichier amputé : on compare
        // à la seconde près par minute retenue.
        expect(Math.abs(avec.retenuesMin - deja.retenuesMin)).toBeLessThanOrEqual(0.1)
      }
    })
  }
})

describe('pas d’échantillonnage et libellé', () => {
  it('pas déduit par fichier : médiane des écarts de t', () => {
    expect(pasFichierMin(fichier('A', 0, 10, 1).data)).toBeCloseTo(1 / 60, 9)
    expect(pasFichierMin(fichier('A', 0, 10, 60).data)).toBe(1)
    expect(pasFichierMin([{ t: 5, laeq: 50 }])).toBeCloseTo(1 / 60, 9) // un seul point : 1 s par défaut
  })

  it('libellé : couverture et causes non nulles, dans un ordre fixe', () => {
    expect(libelleCouverture(c(60))).toBe('60/60 min')
    expect(libelleCouverture(c(35, { exclusionManuelle: 5, exclusionMeteo: 5, horsInclusion: 15 })))
      .toBe('35/60 min — 5 min exclusion météo, 5 min exclusion manuelle, 15 min hors période d’inclusion')
  })
})

describe('rapport et affichage', () => {
  it('bloc du rapport : une ligne par point, glyphe ⚠/✓, rappel §3.7.1 si incomplète', () => {
    const l = blocCouvertureRapport([
      { point: 'BV-1', couverture: c(40, { exclusionManuelle: 20 }) },
      { point: 'BV-2', couverture: c(60) },
    ])
    expect(l).toEqual([
      "Couverture de la fenêtre d'évaluation (minutes de données retenues sur 60) :",
      '  ⚠ BV-1 : 40/60 min — 20 min exclusion manuelle',
      '  ✓ BV-2 : 60/60 min',
      expect.stringContaining('§3.7.1'),
    ])
    expect(blocCouvertureRapport([{ point: 'BV-1', couverture: c(60) }])).toHaveLength(2) // pas de rappel si complète
    expect(blocCouvertureRapport([{ point: 'BV-1' }])).toEqual([])
  })

  it('composant Conformite2026 (rendu statique, module masqué mais atteignable) : couverture affichée avec glyphe', () => {
    const e = CAS_FENETRE.find((x) => x.id === 'causes-mixtes')!.entree()
    const html = renderToStaticMarkup(createElement(Conformite2026, {
      files: e.files, pointMap: e.pointMap, selectedDate: e.selectedDate, periods: e.periods, categories: e.categories,
    }))
    // Texte visible : glyphe ⚠ puis « 35/60 min » (React peut intercaler des marqueurs <!-- -->).
    expect(html).toMatch(/text-amber-300"[^>]*>⚠ (<!-- -->)?35(<!-- -->)?\/60 min/)
    expect(html).toContain('35/60 min — 5 min exclusion météo, 5 min exclusion manuelle, 15 min hors période d’inclusion')
  })
})
