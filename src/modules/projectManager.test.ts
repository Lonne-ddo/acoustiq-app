import { describe, it, expect } from 'vitest'
import { buildIndicesSnapshot } from './projectManager'
import { laeqAvg, dpTimestampMs, filterDataByPeriods } from '../utils/acoustics'
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
const periodExcl: Period = {
  id: 'p1',
  name: 'bruit parasite',
  startMs: base + 30 * 60_000,
  endMs: base + 90 * 60_000,
  categoryId: 'cat-excl',
}

describe('buildIndicesSnapshot — snapshot FILTRÉ (état vu par l’utilisateur)', () => {
  const data = [dp(0, 50), dp(60, 90), dp(120, 50)] // t=60 (90 dB) exclu
  const files = [file(data)]
  const pointMap = { f1: 'BV-1' }
  const key = 'BV-1|2026-01-15'

  it('exclut « À exclure » : IDENTIQUE à IndicesPanel, DIFFÉRENT du brut', () => {
    const snap = buildIndicesSnapshot(files, pointMap, [periodExcl], [catExcl])

    const indicesPanel = laeqAvg(
      filterDataByPeriods(data, ISO, [periodExcl], [catExcl]).map((d) => d.laeq),
    )
    const brut = laeqAvg([50, 90, 50]) // ≈ 85.2 dB

    expect(snap[key]?.laeq).toBeCloseTo(indicesPanel, 6)
    expect(snap[key]?.laeq).toBeCloseTo(50, 6)
    // Échoue si quelqu'un rebranche les données brutes plus tard :
    expect(snap[key]?.laeq).not.toBeCloseTo(brut, 1)
  })

  it('sans période exclue → brut (contrôle)', () => {
    const snap = buildIndicesSnapshot(files, pointMap, [], [])
    expect(snap[key]?.laeq).toBeCloseTo(laeqAvg([50, 90, 50]), 6)
  })
})
