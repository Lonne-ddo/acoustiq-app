import { describe, it, expect } from 'vitest'
import { computeReportIndices } from './reportIndices'
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

// Une catégorie « À exclure » + une période couvrant t=60 (01:00 ∈ [00:30, 01:30]).
const catExcl: Category = { id: 'cat-excl', name: 'À exclure', color: '#000', mode: 'exclude', visible: true }
const periodExcl: Period = {
  id: 'p1',
  name: 'bruit parasite',
  startMs: base + 30 * 60_000,
  endMs: base + 90 * 60_000,
  categoryId: 'cat-excl',
}

describe('computeReportIndices — texte ET figure sur données FILTRÉES', () => {
  const data = [dp(0, 50), dp(60, 90), dp(120, 50)] // t=60 (90 dB) dans la zone exclue
  const files = [file(data)]
  const pointMap = { f1: 'BV-1' }

  it('exclut « À exclure » : IDENTIQUE à IndicesPanel, DIFFÉRENT du brut', () => {
    const res = computeReportIndices(files, pointMap, ISO, ['BV-1'], [periodExcl], [catExcl])

    // Valeur « IndicesPanel » = même filtre per-fichier + laeqAvg (patron existant).
    const indicesPanel = laeqAvg(
      filterDataByPeriods(data, ISO, [periodExcl], [catExcl]).map((d) => d.laeq),
    )
    const brut = laeqAvg([50, 90, 50]) // ≈ 85.2 dB — dominé par le 90 exclu

    expect(res['BV-1']?.laeq).toBeCloseTo(indicesPanel, 6) // == IndicesPanel
    expect(res['BV-1']?.laeq).toBeCloseTo(50, 6) // les deux 50 restants
    // Échoue si quelqu'un rebranche les données brutes plus tard :
    expect(res['BV-1']?.laeq).not.toBeCloseTo(brut, 1)
  })

  it('sans période exclue → tous les points (contrôle brut = filtré)', () => {
    const res = computeReportIndices(files, pointMap, ISO, ['BV-1'], [], [])
    expect(res['BV-1']?.laeq).toBeCloseTo(laeqAvg([50, 90, 50]), 6)
  })

  it('point sans donnée → null', () => {
    const res = computeReportIndices(files, pointMap, ISO, ['BV-2'], [periodExcl], [catExcl])
    expect(res['BV-2']).toBeNull()
  })
})
