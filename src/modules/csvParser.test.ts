import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as XLSX from 'xlsx'
import { csvSource, readCsvSampleRows, parseCsv } from './csvParser'
import { expectSheetSourceContract } from './sheetSourceContract.testkit'
import { parseWorkbookFromWb, selectFormat, selectFormatFromSource } from './formatDetectors'

// Encodage cp1252 (nos accents ∈ 0xE0-0xFF = même code que le point Unicode).
const cp1252 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const blobOf = (s: string) => new Blob([cp1252(s)])

// ── (a) CONFORMITÉ — csvSource passe la MÊME spec que wbSource ────────────────
describe('csvSource — contrat SheetSource (spec partagée, identique à wbSource)', () => {
  it('respecte le contrat SheetSource', async () => {
    // Fixture canonique équivalente : ligne pleine + ligne "courte" (champs vides → null).
    const csv = 'H0,H1,H2,H3\n"1,5",texte,46000,42\n7,,,'
    const { rows } = await readCsvSampleRows(blobOf(csv), 64)
    expectSheetSourceContract(csvSource(rows, 'S'), 'S')
  })
})

// ── Test FONCTIONNEL synthétique (non-skip) : parseCsv de bout en bout ────────
describe('parseCsv — G4-FR synthétique (flux complet)', () => {
  // Champ quoté seulement s'il contient le délimiteur (comme G4 pour les décimales).
  const q = (v: string) => (v.includes(',') ? `"${v}"` : v)
  const line = (fields: string[]) => fields.map(q).join(',')
  const dt = (s: number) => `2025-07-03  07:00:0${s}` // datetime double-espace, secondes 0..2

  const hdr = ['Record #', "Type d'enregistrement", 'Date', 'Temps', 'LAeq', 'LApk', 'LAFmax', 'LAFmin', 'LAImax', 'LCeq', '1/3 LZeq 100', '1/3 LZeq 125', '1/3 LZeq 160', '1/3 LZeq 200', '1/3 LZeq 250', '1/3 LZeq 315']
  const marker = ['1', 'Départ', dt(0), dt(0), '', '', '', '', '', '', '', '', '', '', '', '']
  const bands = ['50', '51', '52', '53', '54', '55']
  const d = (rec: string, sec: number, laeq: string, lceq: string) =>
    [rec, '', dt(sec), dt(sec), laeq, '81,6', '70,5', '65,2', '71,1', lceq, ...bands]
  const csv = [hdr, marker, d('2', 0, '69,3', '71,6'), d('3', 1, '70,5', '73,1'), d('4', 2, '67,5', '71,9')]
    .map(line).join('\r\n')

  it('marqueur sauté, 3 points, décimales virgule, spectre 6 bandes, date data-first', async () => {
    const f = await parseCsv(blobOf(csv), 'fr.csv')
    expect(f.data).toHaveLength(3)                       // marqueur « Départ » sauté
    expect(f.date).toBe('2025-07-03')                    // date depuis les données
    // décimales virgule correctement converties
    expect(f.data[0].laeq).toBeCloseTo(69.3, 6)
    expect(f.data[0].lceq).toBeCloseTo(71.6, 6)
    expect(f.data[1].laeq).toBeCloseTo(70.5, 6)
    // horodatages : 07:00:00, :01, :02
    expect(f.data[0].t).toBeCloseTo(420, 6)              // 7 h = 420 min
    expect(f.data[1].t).toBeCloseTo(420 + 1 / 60, 6)
    // spectre 6 bandes détecté
    expect(f.data[0].spectra).toEqual([50, 51, 52, 53, 54, 55])
    expect(f.spectraFreqs).toEqual([100, 125, 160, 200, 250, 315])
  })
})

// ── (b) ORACLE — xlsx vs CSV (même session) ──────────────────────────────────
// Fixtures RÉELLES non committées (gouvernance données). Déposer une paire COURTE
// (même session exportée en xlsx ET en CSV « Historique du temps ») ici :
//   <dir>/oracle-csv.xlsx   et   <dir>/oracle-csv.csv
const FIX_DIR = 'C:/Users/oganes/OneDrive - Englobe Corp/Bureau/Projets/En cours/DDA/Test acoustiq/'
const ORACLE_XLSX = FIX_DIR + 'oracle-csv.xlsx'
const ORACLE_CSV = FIX_DIR + 'oracle-csv.csv'
const haveOracle = fs.existsSync(ORACLE_XLSX) && fs.existsSync(ORACLE_CSV)

describe('ORACLE — xlsx vs CSV (même session)', () => {
  it.skipIf(!haveOracle)(
    'STRICT (count/t/structure/mapping) + TOLÉRÉ (|Δ dB| ≤ 0,051)',
    async () => {
      const wb = XLSX.read(fs.readFileSync(ORACLE_XLSX), { type: 'buffer', cellDates: false })
      const fx = parseWorkbookFromWb(wb, 'oracle.xlsx')
      const csvBlob = new Blob([fs.readFileSync(ORACLE_CSV)])
      const fc = await parseCsv(csvBlob, 'oracle.csv')

      // Mapping de colonnes détecté IDENTIQUE — attrape un décalage de colonne.
      const outX = selectFormat(wb)
      const { rows: sampleC } = await readCsvSampleRows(csvBlob, 64)
      const outC = selectFormatFromSource(csvSource(sampleC))
      expect(outX.kind).toBe('ok')
      expect(outC.kind).toBe('ok')
      if (outX.kind === 'ok' && outC.kind === 'ok') {
        const a = outX.columnMap, b = outC.columnMap
        expect([b.recordTypeCol, b.laeqCol, b.lceqCol, b.lafmaxCol, b.laftEqCol])
          .toEqual([a.recordTypeCol, a.laeqCol, a.lceqCol, a.lafmaxCol, a.laftEqCol])
        expect(b.spectra.kind).toBe(a.spectra.kind)
        if (a.spectra.kind === 'freq' && b.spectra.kind === 'freq') {
          expect(b.spectra.cols).toEqual(a.spectra.cols)
        }
      }

      // STRICT : nombre de points.
      expect(fc.data.length).toBe(fx.data.length)

      // TOLÉRÉ (dB) : rounding G4 0,1 dB vs 2 décimales xlsx → 72,5 ≠ 72,53.
      const db = (c: number, x: number) => expect(Math.abs(c - x)).toBeLessThanOrEqual(0.051)

      for (let i = 0; i < fx.data.length; i++) {
        const x = fx.data[i], c = fc.data[i]
        expect(c.t).toBeCloseTo(x.t, 6)                    // t : effectivement STRICT (float-safe)
        db(c.laeq, x.laeq)
        expect('lceq' in c).toBe('lceq' in x)              // structure STRICTE
        if (x.lceq != null && c.lceq != null) db(c.lceq, x.lceq)
        expect('laftEq' in c).toBe('laftEq' in x)
        if (x.laftEq != null && c.laftEq != null) db(c.laftEq, x.laftEq)
        expect('lafmax' in c).toBe('lafmax' in x)
        if (x.lafmax != null && c.lafmax != null) db(c.lafmax, x.lafmax)
        expect(!!c.spectra).toBe(!!x.spectra)
        if (x.spectra && c.spectra) {
          expect(c.spectra.length).toBe(x.spectra.length)  // STRICT : longueur (décalage bande)
          for (let b2 = 0; b2 < x.spectra.length; b2++) db(c.spectra[b2], x.spectra[b2])
        }
      }
    },
    180_000,
  )
})
