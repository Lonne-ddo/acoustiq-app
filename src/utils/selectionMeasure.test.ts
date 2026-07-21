import { describe, it, expect } from 'vitest'
import { measureSelectionRange } from './selectionMeasure'
import { laeqAvg, dpTimestampMs, filterDataByPeriods } from './acoustics'
import type { MeasurementFile, Period, Category, DataPoint } from '../types'

const ISO = '2026-01-15'
const base = dpTimestampMs(ISO, 0)

const dp = (t: number, laeq: number): DataPoint => ({ t, laeq })
const file = (data: DataPoint[]): MeasurementFile => ({
  id: 'f1',
  name: 'f1',
  model: '831C',
  serial: 's',
  date: ISO,
  startTime: '00:00',
  stopTime: '02:00',
  point: 'BV-1',
  data,
  rowCount: data.length,
})

const catExcl: Category = { id: 'cat-excl', name: 'À exclure', color: '#000', mode: 'exclude', visible: true }
// Période exclue couvrant t=60 (01:00 ∈ [00:30, 01:30]).
const periodExcl: Period = {
  id: 'p1',
  name: 'bruit parasite',
  startMs: base + 30 * 60_000,
  endMs: base + 90 * 60_000,
  categoryId: 'cat-excl',
}

const data = [dp(0, 50), dp(60, 90), dp(120, 50)] // t=60 (90 dB) exclu
const files = [file(data)]

describe('measureSelectionRange — brut / filtré', () => {
  it('plage SANS chevauchement d’exclusion → filtré == brut, excludedCount 0 (une seule valeur)', () => {
    const m = measureSelectionRange(files, 100, 130, [periodExcl], [catExcl]) // ne couvre que t=120
    expect(m.excludedCount).toBe(0)
    expect(m.raw.laeq).toBeCloseTo(50, 6)
    expect(m.filtered.laeq).toBeCloseTo(m.raw.laeq!, 6)
    expect(m.filtered.l90).toBeCloseTo(m.raw.l90!, 6)
  })

  it('plage AVEC chevauchement → deux valeurs distinctes ; filtré == IndicesPanel sur la plage', () => {
    const tA = 0
    const tB = 130
    const m = measureSelectionRange(files, tA, tB, [periodExcl], [catExcl])

    expect(m.excludedCount).toBe(1) // le point à t=60 retiré

    // Équivalent IndicesPanel : filterDataByPeriods puis même fenêtre.
    const indicesPanel = laeqAvg(
      filterDataByPeriods(data, ISO, [periodExcl], [catExcl])
        .filter((d) => d.t >= tA && d.t <= tB)
        .map((d) => d.laeq),
    )
    expect(m.filtered.laeq).toBeCloseTo(indicesPanel, 6)
    expect(m.filtered.laeq).toBeCloseTo(50, 6)

    // brut ≠ filtré (le 90 dB exclu tire le brut vers le haut)
    expect(m.raw.laeq).toBeCloseTo(laeqAvg([50, 90, 50]), 6)
    expect(m.filtered.laeq).not.toBeCloseTo(m.raw.laeq!, 1)
  })

  it('sans période exclue → filtré == brut (contrôle)', () => {
    const m = measureSelectionRange(files, 0, 130, [], [])
    expect(m.excludedCount).toBe(0)
    expect(m.filtered.laeq).toBeCloseTo(m.raw.laeq!, 6)
  })
})
