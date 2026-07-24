import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { selectFormatFromSource, selectFormat, wbSource, DETECTORS } from './formatDetectors'
import { csvSource, readCsvSampleRows, parseCsv } from './csvParser'

/**
 * NON-RÉGRESSION (ex-DIAG) — le CSV G4-FR 821SE à colonne datetime COMBINÉE
 * « Date / heure » était rejeté « Format non reconnu » (aucun détecteur : FR exige
 * Date+Temps, EN exige Date+Time). Le détecteur g4-fr-datetime-combine le couvre.
 * Ce test est passé du rejet reproduit à la détection réussie — il le garde.
 */

const cp1252 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const blobOf = (s: string) => new Blob([cp1252(s)])
const q = (v: string) => (v.includes(',') ? `"${v}"` : v)
const csvLine = (f: string[]) => f.map(q).join(',')

// En-têtes RÉELS 821SE : col0 = Type d'enregistrement (marqueur), col1 = « Date /
// heure » COMBINÉE (paddée d'espaces), puis métriques. Complété à 140 colonnes.
const named = [
  "  Type d'enregistrement  ",
  '              Date / heure              ',
  'LAeq', 'LApk', 'LCeq', 'LCpk', 'LZeq', 'LZpk',
  'Externe (V)', 'Batterie (%)', "Source d'énergie", 'Surcharge', 'LASmin', 'LASmax',
]
const filler = Array.from({ length: 140 - named.length }, (_, i) => `1/3 LZeq ${i}`)
const header = [...named, ...filler] // 140 colonnes

const dt = (s: number) => `2025-07-03 07:00:0${s}` // datetime combiné, secondes 0..2
const restVals = Array.from({ length: 140 - 3 }, () => '72,5') // cols 3..139 (137)
const dataRow = (sec: number, laeq: string) => ['', dt(sec), laeq, ...restVals] // col0 vide = pas un marqueur
const markerRow = ['Départ', dt(0), ...Array.from({ length: 138 }, () => '')]
const csv = [header, markerRow, dataRow(0, '69,3'), dataRow(1, '70,5'), dataRow(2, '67,5')]
  .map(csvLine).join('\r\n')

describe('non-rég — CSV 821SE « Date / heure » combinée : détection RÉUSSIE', () => {
  it('csvSource → détecté g4-fr-datetime-combine (auparavant « none »)', async () => {
    const { rows } = await readCsvSampleRows(blobOf(csv), 64)
    const out = selectFormatFromSource(csvSource(rows))
    expect(out.kind).toBe('ok')
    if (out.kind === 'ok') expect(out.detectorId).toBe('g4-fr-datetime-combine')
  })

  it('parseCsv → marqueur sauté, 3 points, t à 1 s d’intervalle, décimales virgule', async () => {
    const f = await parseCsv(blobOf(csv), 'x.csv')
    expect(f.data).toHaveLength(3) // « Départ » sauté
    expect(f.data[0].t).toBeCloseTo(420, 6) // 07:00:00
    expect(f.data[1].t).toBeCloseTo(420 + 1 / 60, 6) // +1 s
    expect(f.data[2].t).toBeCloseTo(420 + 2 / 60, 6) // +2 s
    expect(f.data[0].laeq).toBeCloseTo(69.3, 6) // '69,3' → 69.3
  })

  it('MÊMES en-têtes via wbSource → détecté aussi : le chemin xlsx en profite', () => {
    const num137 = Array.from({ length: 137 }, () => 72.5)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      header,
      ['Départ', dt(0), ...Array.from({ length: 138 }, () => '')],
      ['', dt(0), 69.3, ...num137],
      ['', dt(1), 70.5, ...num137],
      ['', dt(2), 67.5, ...num137],
    ]), 'Historique temporel')
    const out = selectFormat(wb)
    expect(out.kind).toBe('ok')
    if (out.kind === 'ok') expect(out.detectorId).toBe('g4-fr-datetime-combine')
  })

  it('mutuellement exclusif : 821SE → EXACTEMENT 1 détecteur (le nouveau), jamais 2', async () => {
    const { rows } = await readCsvSampleRows(blobOf(csv), 64)
    const src = csvSource(rows)
    const matched = DETECTORS.filter((d) => d.scan(src)?.kind === 'match').map((d) => d.id)
    expect(matched).toEqual(['g4-fr-datetime-combine'])
  })

  it('mutuellement exclusif : 831C FR (Date+Temps séparés) → EXACTEMENT 1 (g4-fr), jamais 2', () => {
    const D = 46000
    const at = (s: number) => D + (7 * 3600 + s) / 86400
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Record #', "Type d'enregistrement", 'Date', 'Temps', 'LAeq'],
      [1, '', at(0), at(0), 60],
      [2, '', at(1), at(1), 61],
      [3, '', at(2), at(2), 62],
    ]), 'Historique temporel')
    const matched = DETECTORS.filter((d) => d.scan(wbSource(wb))?.kind === 'match').map((d) => d.id)
    expect(matched).toEqual(['g4-fr'])
  })
})
