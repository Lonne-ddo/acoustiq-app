import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseWorkbook } from './formatDetectors'
import { parse831C } from './parser831C'
import { analyzeKt, KT_BAND_FREQS } from '../utils/acoustics'

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

  it('Kt inchangé sur un 831C en Z natif (le support du A ne touche pas ce chemin)', () => {
    const buf = buildEnBuffer()
    const legacy = parse831C(buf, 'en.xlsx')
    const modern = parseWorkbook(buf, 'en.xlsx')

    // Le spectre est mesuré en Z : aucune dépondération ne doit s'appliquer.
    expect(modern.spectraSource).toBe('Z-natif')
    for (let i = 0; i < legacy.data.length; i++) {
      const a = analyzeKt(modern.data[i].spectra ?? [], modern.data[i].laeq, modern.spectraFreqs)
      const b = analyzeKt(legacy.data[i].spectra ?? [], legacy.data[i].laeq, legacy.spectraFreqs)
      expect(a.unavailable).toEqual(b.unavailable)
      expect(a.kt).toBe(b.kt)
      expect(a.triggeringIndex).toBe(b.triggeringIndex)
      expect(a.bands).toEqual(b.bands)
    }
  })
})

/**
 * G2 — BLOC POSITIONNEL 831C (colonnes 41-67, bandes 50 Hz → 20 kHz).
 *
 * C'est le SEUL chemin dont le spectre commence à 50 Hz, donc le seul aligné
 * sur `KT_BAND_FREQS`. Le garde-fou d'alignement ne doit RIEN y changer : même
 * Kt, mêmes bandes, mêmes émergences qu'avant son introduction.
 */
describe('G2 — 831C bloc positionnel : Kt calculé, identique à la baseline', () => {
  /** Classeur EN sans libellé de bande reconnaissable → repli positionnel 41-67. */
  function buildPositionalBuffer(): ArrayBuffer {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['', ''], ['Model', '831C'], ['Serial', '10585'],
      ['Start', '2026-03-10 07:00:00'], ['Stop', '2026-03-10 08:00:00'],
    ]), 'Summary')
    // 41 colonnes de tête, puis 27 bandes anonymes (« B1 »…« B27 ») en 41-67.
    const head = ['Record #', 'Record Type', 'Date', 'Time', 'LAeq', 'LApk', 'LAFmax', 'LAFmin', 'LAImax', 'LCeq']
    const hdr = [...head, ...Array.from({ length: 41 - head.length }, (_, i) => `X${i}`),
      ...Array.from({ length: 27 }, (_, i) => `B${i + 1}`)]
    // Spectre plat 50 dB, émergence de 25 dB sur la 6ᵉ bande (160 Hz). Assez
    // haute pour rester significative face au LAeq global (69,3) : 69,3 − 61,6
    // = 7,7 < 15, donc non exclue par l'exception « bande masquée ».
    const spec = new Array(27).fill(50); spec[5] = 75
    const pad = new Array(41 - head.length).fill(0)
    const row = (n: number) => [n, '', at0700(n), at0700(n), 69.3, 81.6, 70.5, 65.2, 71.1, 71.6, ...pad, ...spec]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, row(0), row(1), row(2)]), 'Time History')
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array
    return out instanceof Uint8Array
      ? out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
      : out
  }

  it('1ʳᵉ bande = 50 Hz → alignement prouvé, Kt numérique produit', () => {
    const f = parseWorkbook(buildPositionalBuffer(), 'pos.xlsx')
    expect(f.spectraFreqs?.[0]).toBe(50)
    expect(f.spectraFreqs?.[0]).toBe(KT_BAND_FREQS[0])
    expect(f.spectraSource).toBe('Z-natif')

    const a = analyzeKt(f.data[0].spectra ?? [], f.data[0].laeq, f.spectraFreqs)
    expect(a.unavailable).toBeNull()
    expect(a.bands).toHaveLength(24)
    expect(a.kt).toBe(5)
    expect(a.bands[a.triggeringIndex as number].freq).toBe(160)
  })

  it("BASELINE : résultat identique à l'appel sans garde-fou (bandes supposées alignées)", () => {
    const f = parseWorkbook(buildPositionalBuffer(), 'pos.xlsx')
    const spectrum = f.data[0].spectra ?? []
    // Baseline = ce que l'ancien code calculait : il itérait N = min(24, 27)
    // bandes en supposant `KT_BAND_FREQS`, sans jamais lire au-delà (diffNext
    // est null sur la dernière). Les 24 premières valeurs suffisent donc à le
    // reproduire à l'identique.
    const baseline = analyzeKt(spectrum.slice(0, 24), f.data[0].laeq, KT_BAND_FREQS)
    const guarded = analyzeKt(spectrum, f.data[0].laeq, f.spectraFreqs)
    expect(guarded.kt).toBe(baseline.kt)
    expect(guarded.triggeringIndex).toBe(baseline.triggeringIndex)
    expect(guarded.bands).toEqual(baseline.bands)
  })
})
