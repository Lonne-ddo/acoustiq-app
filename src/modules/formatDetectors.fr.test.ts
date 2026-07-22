import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as XLSX from 'xlsx'
import { selectFormat, parseWorkbookFromWb, FormatError } from './formatDetectors'

// ── Fixtures FR synthétiques ─────────────────────────────────────────────────
const D = 46000
const at0700 = (sec: number) => D + (7 * 3600 + sec) / 86400
const atSec = (sec: number) => D + sec / 86400
const band6 = [50, 51, 52, 53, 54, 55]

function appendAoa(wb: XLSX.WorkBook, name: string, aoa: unknown[][]) {
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name)
}

/** « Historique temporel » FR (pas 1 s ; Date+Temps séparés ; marqueur « Départ »). */
function frStepwiseSheet(bandLabels = ['1/3 LZeq 100', '1/3 LZeq 125', '1/3 LZeq 160', '1/3 LZeq 200', '1/3 LZeq 250', '1/3 LZeq 315']): unknown[][] {
  const hdr = ['Record #', "Type d'enregistrement", 'Date', 'Temps', 'LAeq', 'LApk', 'LAFmax', 'LAFmin', 'LAImax', 'LCeq', ...bandLabels]
  const empties = new Array(bandLabels.length).fill('')
  return [
    hdr,
    // Marqueur « Départ » : Date/Temps remplies (comme le vrai fichier), mesures vides.
    [1, 'Départ', D, D, ...empties.slice(0, 0), '', '', '', '', '', '', ...empties],
    [2, '', at0700(0), at0700(0), 69.3, 81.6, 70.5, 65.2, 71.1, 71.6, ...band6],
    [3, '', at0700(1), at0700(1), 70.5, 84.3, 71.5, 68.7, 72.3, 73.1, ...band6],
    [4, '', at0700(2), at0700(2), 67.5, 80.2, 68.9, 66.5, 70.5, 71.9, ...band6],
  ]
}

/** « Historique de mesure » FR (agrégats horaire, pas 3600 s). */
function frAggregateSheet(): unknown[][] {
  const hdr = ['Record #', 'Latitude', 'Longitude', 'Élévation', 'Date', 'Temps', 'Durée de la course', 'LAeq']
  const rows: unknown[][] = [hdr]
  for (let h = 0; h < 5; h++) rows.push([h + 1, '', '', '', atSec(h * 3600), atSec(h * 3600), 0.0416, 60 + h])
  return rows
}

function buildFrWb(opts: { stepwise?: boolean; aggregate?: boolean; bandLabels?: string[] } = {}): XLSX.WorkBook {
  const { stepwise = true, aggregate = true, bandLabels } = opts
  const wb = XLSX.utils.book_new()
  appendAoa(wb, 'Sommaire', [['', ''], ['Modèle', '831C'], ['Série', '12782']])
  if (aggregate) appendAoa(wb, 'Historique de mesure', frAggregateSheet())
  if (stepwise) appendAoa(wb, 'Historique temporel', frStepwiseSheet(bandLabels))
  return wb
}

// ─────────────────────────────────────────────────────────────────────────────

describe('G4-FR — détecteur français (débloque le fichier de référence)', () => {
  it('reconnu par g4-fr, feuille « Historique temporel » retenue par pas temporel', () => {
    const out = selectFormat(buildFrWb())
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.detectorId).toBe('g4-fr')
    expect(out.sheetName).toBe('Historique temporel') // pas « Historique de mesure »
  })

  it('extraction : marqueur « Départ » sauté, Date+Temps combinés → t=420 (07:00)', () => {
    const f = parseWorkbookFromWb(buildFrWb(), 'fr.xlsx')
    expect(f.data.length).toBe(3)                    // « Départ » sauté
    expect(f.data[0].t).toBeCloseTo(420, 4)          // 07:00 via combine
    expect(f.data[0].laeq).toBe(69.3)
    expect(f.data[0].lceq).toBe(71.6)
    expect(f.data[0].lafmax).toBe(70.5)              // récupéré (le worker le perdait)
    expect(f.data[0].laftEq).toBe(71.1)              // LAImax (récupéré aussi)
    expect(f.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)    // data-first, ISO valide
  })

  it('agrégée seule (« Historique de mesure ») → aggregate-only explicite', () => {
    expect(() => parseWorkbookFromWb(buildFrWb({ stepwise: false }), 'agg.xlsx')).toThrow(FormatError)
    try {
      parseWorkbookFromWb(buildFrWb({ stepwise: false }), 'agg.xlsx')
    } catch (e) {
      const m = (e as Error).message
      expect(m).toContain('agrégats horaires')
      expect(m).toContain('Historique de mesure')
    }
  })

  it('LIMITATION connue : bandes à décimale virgule (« 1/3 LZeq 6,3 ») non détectées (absentes, jamais fausses)', () => {
    const commaBands = ['1/3 LZeq 6,3', '1/3 LZeq 8,0', '1/3 LZeq 10,0', '1/3 LZeq 12,5', '1/3 LZeq 16,0', '1/3 LZeq 20,0']
    const f = parseWorkbookFromWb(buildFrWb({ bandLabels: commaBands }), 'fr.xlsx')
    // Aucune bande détectée avec ces libellés → pas de spectre (pas un spectre faux).
    expect(f.data[0].spectra).toBeUndefined()
  })
})

describe('AMBIGUÏTÉ — deux détecteurs reconnaissent → signalée, pas de devinette', () => {
  it('classeur portant à la fois une feuille EN et une feuille FR pas-à-pas → ambiguous', () => {
    const wb = XLSX.utils.book_new()
    // Feuille EN (LAeq/Time/Date, sans Temps)
    appendAoa(wb, 'Time History', [
      ['Record #', 'Record Type', 'Date', 'Time', 'LAeq'],
      [1, '', at0700(0), at0700(0), 60],
      [2, '', at0700(1), at0700(1), 61],
      [3, '', at0700(2), at0700(2), 62],
    ])
    // Feuille FR (LAeq/Temps/Date)
    appendAoa(wb, 'Historique temporel', [
      ['Record #', "Type d'enregistrement", 'Date', 'Temps', 'LAeq'],
      [1, '', at0700(0), at0700(0), 60],
      [2, '', at0700(1), at0700(1), 61],
      [3, '', at0700(2), at0700(2), 62],
    ])
    const out = selectFormat(wb)
    expect(out.kind).toBe('ambiguous')
    if (out.kind === 'ambiguous') expect(out.ids).toEqual(expect.arrayContaining(['g4-en', 'g4-fr']))
  })
})

// ── Test d'intégration RÉEL (gardé) — ne committe pas le fichier de mesure ───
//
// LENT et ASSUMÉ : parse un XLSX RÉEL de ~8 Mo (XLSX.read ~27–60 s selon la
// charge, surtout en parallèle avec l'oracle LAFTM5) → timeout 180 s. Gardé par
// fs.existsSync : ABSENCE du fichier = skip propre (jamais un échec) → ignoré en
// CI, joué localement avant validation. Ça vaut son coût : c'est le garde-fou
// qui prouve que le parser G4-FR débloque bien le fichier de référence
// (28 060 points, t=420, feuille pas-à-pas retenue) contre le fichier réel.
const REAL_FR = 'C:/Users/oganes/OneDrive - Englobe Corp/Bureau/Projets/En cours/DDA/Test acoustiq/831C_12782-20260707 070000-26070700.LD0.xlsx'

describe('G4-FR — fichier de référence réel (si présent localement)', () => {
  it.skipIf(!fs.existsSync(REAL_FR))('~28 060 points, t=420, feuille « Historique temporel »', () => {
    const buf = fs.readFileSync(REAL_FR)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const wb = XLSX.read(ab, { type: 'array', cellDates: false })
    const out = selectFormat(wb)
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.detectorId).toBe('g4-fr')
    expect(out.sheetName).toBe('Historique temporel')
    const f = parseWorkbookFromWb(wb, 'real-fr.xlsx')
    expect(f.data.length).toBe(28060)
    expect(f.data[0].t).toBeCloseTo(420, 2)
  }, 180000) // XLSX.read d'un fichier réel de 8 Mo — cf. en-tête
})
