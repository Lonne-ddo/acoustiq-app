import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { selectFormat, parseWorkbookFromWb, FormatError } from './formatDetectors'

// ── Fabriques de classeurs synthétiques (petits, en mémoire, portables) ──────
// Sériels Excel : jour entier D + fraction de journée. On n'assert pas la date
// calendaire ici (elle dépend de D) mais le PAS temporel et l'heure du jour.
const D = 46000 // jour-sériel arbitraire valide
const atSec = (sec: number) => D + sec / 86400          // 00:00:00 + sec
const at0700 = (sec: number) => D + (7 * 3600 + sec) / 86400
const band6 = [40, 41, 42, 43, 44, 45]

function appendAoa(wb: XLSX.WorkBook, name: string, aoa: unknown[][]) {
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name)
}

/** Feuille pas-à-pas anglaise « Time History » (1 s, 2 marqueurs + 3 données). */
function enStepwiseSheet(): unknown[][] {
  const hdr = [
    'Record #', 'Record Type', 'Date', 'Time', 'LAeq', 'LApk', 'LAFmax', 'LAFmin', 'LAImax', 'LCeq',
    '1/3 LZeq 6.3', '1/3 LZeq 8.0', '1/3 LZeq 10.0', '1/3 LZeq 12.5', '1/3 LZeq 16.0', '1/3 LZeq 20.0',
  ]
  return [
    hdr,
    [1, 'Calibration Change', D, D, '', '', '', '', '', '', '', '', '', '', '', ''],
    [2, 'Run', D, D, '', '', '', '', '', '', '', '', '', '', '', ''],
    [3, '', at0700(0), at0700(0), 69.3, 81.6, 70.5, 65.2, 71.1, 71.6, ...band6],
    [4, '', at0700(1), at0700(1), 70.5, 84.3, 71.5, 68.7, 72.3, 73.1, ...band6],
    [5, '', at0700(2), at0700(2), 67.5, 80.2, 68.9, 66.5, 70.5, 71.9, ...band6],
  ]
}

/** Feuille agrégats horaire anglaise « Measurement History » (pas 3600 s). */
function enAggregateSheet(): unknown[][] {
  const hdr = ['Record #', 'Latitude', 'Longitude', 'Elevation', 'Date', 'Time', 'Run Duration', 'LAeq']
  const rows: unknown[][] = [hdr]
  for (let h = 0; h < 5; h++) rows.push([h + 1, '', '', '', atSec(h * 3600), atSec(h * 3600), 0.0416, 60 + h])
  return rows
}

function enSummary(): unknown[][] {
  return [
    ['', ''],
    ['Model', '831C'],
    ['Serial', '10585'],
    ['Start', '2026-03-10 07:00:00'],
    ['Stop', '2026-03-10 08:00:00'],
  ]
}

function buildEnWb(opts: { stepwise?: boolean; aggregate?: boolean; aggregateFirst?: boolean } = {}): XLSX.WorkBook {
  const { stepwise = true, aggregate = true, aggregateFirst = false } = opts
  const wb = XLSX.utils.book_new()
  appendAoa(wb, 'Summary', enSummary())
  if (aggregate && aggregateFirst) appendAoa(wb, 'Measurement History', enAggregateSheet())
  if (stepwise) appendAoa(wb, 'Time History', enStepwiseSheet())
  if (aggregate && !aggregateFirst) appendAoa(wb, 'Measurement History', enAggregateSheet())
  return wb
}

// ─────────────────────────────────────────────────────────────────────────────

describe('selectFormat — règle 1/0/plusieurs + reconnaissance positive', () => {
  it('G4-EN : exactement 1 détecteur reconnaît, feuille « Time History »', () => {
    const out = selectFormat(buildEnWb())
    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.detectorId).toBe('g4-en')
    expect(out.sheetName).toBe('Time History')
  })

  it('négatif : aucune signature connue → « none » avec feuilles + en-têtes vus (pas de crash)', () => {
    const wb = XLSX.utils.book_new()
    appendAoa(wb, 'Feuil1', [['Foo', 'Bar', 'Baz'], [1, 2, 3], [4, 5, 6]])
    const out = selectFormat(wb)
    expect(out.kind).toBe('none')
    if (out.kind !== 'none') return
    expect(out.seenSheets).toContain('Feuil1')
    expect(out.sampleHeaders).toEqual(expect.arrayContaining(['Foo', 'Bar', 'Baz']))
  })
})

describe('POINT #4 — sélection de feuille par PAS TEMPOREL, pas par ordre de liste', () => {
  it('pas-à-pas (1 s) gagne sur agrégats (3600 s), quel que soit l’ordre des onglets', () => {
    const a = selectFormat(buildEnWb({ aggregateFirst: false }))
    const b = selectFormat(buildEnWb({ aggregateFirst: true }))
    expect(a.kind).toBe('ok'); if (a.kind === 'ok') expect(a.sheetName).toBe('Time History')
    expect(b.kind).toBe('ok'); if (b.kind === 'ok') expect(b.sheetName).toBe('Time History')
  })

  it('agrégée seule → aggregate-only (jamais parsée en pas-à-pas)', () => {
    const out = selectFormat(buildEnWb({ stepwise: false, aggregate: true }))
    expect(out.kind).toBe('aggregate-only')
    if (out.kind !== 'aggregate-only') return
    expect(out.sheetName).toBe('Measurement History')
  })
})

describe('parseWorkbookFromWb — G4-EN : extraction correcte', () => {
  it('marqueurs sautés, temps/colonnes/spectres corrects', () => {
    const f = parseWorkbookFromWb(buildEnWb(), 'en.xlsx')
    expect(f.data.length).toBe(3)                 // 2 marqueurs sautés
    expect(f.data[0].t).toBeCloseTo(420, 4)       // 07:00
    expect(f.data[0].laeq).toBe(69.3)
    expect(f.data[0].lceq).toBe(71.6)
    expect(f.data[0].lafmax).toBe(70.5)
    expect(f.data[0].laftEq).toBe(71.1)           // LAImax (proxy)
    expect(f.data[0].spectra).toEqual(band6)
    expect(f.spectraFreqs).toEqual([6.3, 8, 10, 12.5, 16, 20])
    expect(f.model).toBe('831C')
    expect(f.serial).toBe('10585')
    expect(f.date).toBe('2026-03-10')             // summary-first
    expect(f.startTime).toBe('07:00')
  })

  it('aggregate-only → FormatError explicite « exportez l’historique temporel pas-à-pas »', () => {
    expect(() => parseWorkbookFromWb(buildEnWb({ stepwise: false }), 'agg.xlsx')).toThrow(FormatError)
    try {
      parseWorkbookFromWb(buildEnWb({ stepwise: false }), 'agg.xlsx')
    } catch (e) {
      const m = (e as Error).message
      expect(m).toContain('agrégats horaires')
      expect(m).toContain('Measurement History')
      expect(m).toContain('pas-à-pas')
    }
  })

  it('format non reconnu → FormatError avec feuilles + en-têtes vus', () => {
    const wb = XLSX.utils.book_new()
    appendAoa(wb, 'Feuil1', [['Foo', 'Bar'], [1, 2]])
    try {
      parseWorkbookFromWb(wb, 'junk.xlsx')
      throw new Error('devait lever')
    } catch (e) {
      expect(e).toBeInstanceOf(FormatError)
      const m = (e as Error).message
      expect(m).toContain('Format non reconnu')
      expect(m).toContain('Feuil1')
    }
  })
})
