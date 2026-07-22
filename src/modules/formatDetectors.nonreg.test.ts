import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseWorkbook } from './formatDetectors'
import { parse831C } from './parser831C'

/**
 * NON-RÉGRESSION G4 ANGLAIS : le nouveau chemin (table de détecteurs) doit
 * produire EXACTEMENT ce que produit le parser historique `parse831C` sur un
 * fichier anglais — mêmes points, mêmes colonnes, mêmes métadonnées.
 */

const D = 46000
const at0700 = (sec: number) => D + (7 * 3600 + sec) / 86400
const band6 = [40, 41, 42, 43, 44, 45]

function buildEnBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['', ''],
    ['Model', '831C'],
    ['Serial', '10585'],
    ['Start', '2026-03-10 07:00:00'],
    ['Stop', '2026-03-10 08:00:00'],
  ]), 'Summary')
  const hdr = [
    'Record #', 'Record Type', 'Date', 'Time', 'LAeq', 'LApk', 'LAFmax', 'LAFmin', 'LAImax', 'LCeq',
    '1/3 LZeq 6.3', '1/3 LZeq 8.0', '1/3 LZeq 10.0', '1/3 LZeq 12.5', '1/3 LZeq 16.0', '1/3 LZeq 20.0',
  ]
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    hdr,
    [1, 'Calibration Change', D, D, '', '', '', '', '', '', '', '', '', '', '', ''],
    [2, 'Run', D, D, '', '', '', '', '', '', '', '', '', '', '', ''],
    [3, '', at0700(0), at0700(0), 69.3, 81.6, 70.5, 65.2, 71.1, 71.6, ...band6],
    [4, '', at0700(1), at0700(1), 70.5, 84.3, 71.5, 68.7, 72.3, 73.1, ...band6],
    [5, '', at0700(2), at0700(2), 67.5, 80.2, 68.9, 66.5, 70.5, 71.9, ...band6],
  ]), 'Time History')
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array
  return out instanceof Uint8Array
    ? out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
    : out
}

describe('non-régression G4-EN : parseWorkbook ≡ parse831C', () => {
  it('mêmes points, colonnes et métadonnées', () => {
    const buf = buildEnBuffer()
    const legacy = parse831C(buf, 'en.xlsx')
    const modern = parseWorkbook(buf, 'en.xlsx')

    expect(modern.data.length).toBe(legacy.data.length)
    for (let i = 0; i < legacy.data.length; i++) {
      const a = modern.data[i], b = legacy.data[i]
      expect(a.t).toBeCloseTo(b.t, 6)
      expect(a.laeq).toBe(b.laeq)
      expect(a.lceq).toBe(b.lceq)
      expect(a.lafmax).toBe(b.lafmax)
      expect(a.laftEq).toBe(b.laftEq)
      expect(a.spectra).toEqual(b.spectra)
      expect(a.spectraMax).toEqual(b.spectraMax)
    }
    expect(modern.model).toBe(legacy.model)
    expect(modern.serial).toBe(legacy.serial)
    expect(modern.date).toBe(legacy.date)
    expect(modern.startTime).toBe(legacy.startTime)
    expect(modern.stopTime).toBe(legacy.stopTime)
    expect(modern.spectraFreqs).toEqual(legacy.spectraFreqs)
    expect(modern.rowCount).toBe(legacy.rowCount)
  })
})
