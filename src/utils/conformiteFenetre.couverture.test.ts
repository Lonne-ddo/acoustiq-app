import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Conformite2026 from '../components/Conformite2026'
import {
  evaluerFenetres,
  couvertureFenetre,
  pasFichierMin,
  libelleCouverture,
  libelleCauses,
  minutesEntieres,
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
 * relevées sur le code. Minutes entières ; les secondes exactes sont dérivées
 * (tous les cas du golden tombent sur des minutes pleines).
 */
type Minutes = Pick<CouvertureFenetre, 'retenuesMin' | 'manquantesMin'>
const c = (retenues: number, m: Partial<CouvertureFenetre['manquantesMin']> = {}): CouvertureFenetre => {
  const manquantesMin = { exclusionMeteo: 0, exclusionManuelle: 0, horsInclusion: 0, absenceDonnees: 0, ...m }
  const manquantes = Object.fromEntries(Object.entries(manquantesMin).map(([k, v]) => [k, v * 60])) as CouvertureFenetre['manquantesMin']
  return { retenuesMin: retenues, manquantesMin, secondes: { retenues: retenues * 60, manquantes } }
}
/** Couverture à la seconde : minutes dérivées par minutesEntieres. */
const cs = (retenuesS: number, m: Partial<CouvertureFenetre['manquantesMin']> = {}): CouvertureFenetre => {
  const manquantes = { exclusionMeteo: 0, exclusionManuelle: 0, horsInclusion: 0, absenceDonnees: 0, ...m }
  return { ...minutesEntieres(retenuesS, manquantes), secondes: { retenues: retenuesS, manquantes } }
}
const minutes = (x: CouvertureFenetre): Minutes => ({ retenuesMin: x.retenuesMin, manquantesMin: x.manquantesMin })

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
  'kb-auto': [c(60)],
  'ki-manuel': [c(60)],
  'verdict-egalite': [c(60)],
  // A (1 s) exclu 14:10–14:20 ; B (5 min, t = 14:02, 14:07, 14:12, 14:17…) : 14:07 retenu
  // couvre 14:10–14:12, 14:17 exclu couvre 14:20–14:22 où A est retenu → la donnée
  // RETENUE prime des deux côtés : seules 14:12–14:20 manquent (8 min).
  'priorite-statuts': [c(52, { exclusionManuelle: 8 })],
  // Pas 60 s : échantillons exclus 14:10…14:29 (20) ; celui de 14:30 (= fin) est retenu.
  'borne-fin': [c(40, { exclusionManuelle: 20 })],
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
        expect(somme).toBe(60)
        const sommeS = r.couverture.secondes.retenues + Object.values(r.couverture.secondes.manquantes).reduce((a, b) => a + b, 0)
        expect(sommeS).toBe(3600)
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
        // les secondes retenues, à 6 s près.
        expect(Math.abs(avec.secondes.retenues - deja.secondes.retenues)).toBeLessThanOrEqual(6)
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
    expect(libelleCauses(c(60))).toBe('')
  })
})

describe('minutes entières (le dixième promettait une précision que le pas ne donne pas)', () => {
  it('une seule seconde manquante : jamais « 60/60 », la fenêtre reste incomplète', () => {
    const x = cs(3599, { absenceDonnees: 1 })
    expect(minutes(x)).toEqual(minutes(c(59, { absenceDonnees: 1 })))
    expect(fenetreIncomplete(x)).toBe(true)
    expect(libelleCouverture(x)).toBe('59/60 min — 1 min absence de données')
  })

  it('retenues arrondies à l’inférieur, reste au plus fort reste : 34 min 50 s + 25 min 10 s', () => {
    expect(minutes(cs(34 * 60 + 50, { exclusionManuelle: 25 * 60 + 10 }))).toEqual(minutes(c(34, { exclusionManuelle: 26 })))
  })

  it('plus fort reste entre causes, pas l’ordre fixe : 9 min 20 s météo, 10 min 40 s manuelle', () => {
    expect(minutes(cs(40 * 60, { exclusionMeteo: 9 * 60 + 20, exclusionManuelle: 10 * 60 + 40 })))
      .toEqual(minutes(c(40, { exclusionMeteo: 9, exclusionManuelle: 11 })))
  })

  it('égalité de restes : l’ordre fixe des causes départage', () => {
    // 59 min 20 s retenues, 20 s météo, 20 s manuelle : 1 min à attribuer, à la météo (1re).
    expect(minutes(cs(59 * 60 + 20, { exclusionMeteo: 20, exclusionManuelle: 20 })))
      .toEqual(minutes(c(59, { exclusionMeteo: 1 })))
  })

  it('une cause arrondie à 0 min n’est jamais tue : « < 1 min »', () => {
    const x = cs(59 * 60 + 20, { exclusionMeteo: 20, exclusionManuelle: 20 })
    expect(libelleCouverture(x)).toBe('59/60 min — 1 min exclusion météo, < 1 min exclusion manuelle')
  })

  it('somme toujours égale à 60, retenues jamais surestimées (balayage déterministe)', () => {
    let graine = 12345
    const alea = () => ((graine = (graine * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let i = 0; i < 2000; i++) {
      const coupes = [alea(), alea(), alea(), alea()].map((u) => Math.floor(u * 3601)).sort((a, b) => a - b)
      const [a, b, d, e] = coupes
      const m = { exclusionMeteo: b - a, exclusionManuelle: d - b, horsInclusion: e - d, absenceDonnees: 3600 - e + a }
      const r = minutesEntieres(3600 - (m.exclusionMeteo + m.exclusionManuelle + m.horsInclusion + m.absenceDonnees), m)
      expect(r.retenuesMin + Object.values(r.manquantesMin).reduce((s, v) => s + v, 0)).toBe(60)
      expect(r.retenuesMin * 60).toBeLessThanOrEqual(3600 - (b - a) - (d - b) - (e - d) - (3600 - e + a))
    }
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
    // Texte visible : glyphe ⚠ puis « 35/60 min », orange Okabe-Ito (React peut intercaler des marqueurs <!-- -->).
    expect(html).toMatch(/text-\[#E69F00\]"[^>]*>⚠ (<!-- -->)?35(<!-- -->)?\/60 min/)
    expect(html).not.toContain('amber-300')
    // Causes ÉCRITES dans le contenu, hors de tout attribut title : lisibles sans survol.
    const sansTitres = html.replace(/ title="[^"]*"/g, '')
    expect(sansTitres).toMatch(/manque : (<!-- -->)?5 min exclusion météo, 5 min exclusion manuelle, 15 min hors période d’inclusion/)
  })
})
