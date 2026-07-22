import { describe, it, expect } from 'vitest'
import * as pako from 'pako'
import { serializeProject, deserializeProject, SCHEMA_VERSION } from './dataverseProjectStore'
import type { ProjectData, DataPoint, Period, Category } from '../types'

// ── Fixtures ProjectData réalistes (avec files[].data non vide) ──────────────
function makeDataPoints(n: number): DataPoint[] {
  const out: DataPoint[] = []
  for (let i = 0; i < n; i++) {
    // Valeurs à décimales « sales » (i/60, /10) pour prouver l'absence d'arrondi.
    const dp: DataPoint = { t: i / 60, laeq: 40 + (i % 40) + (i % 10) / 10 }
    if (i % 2 === 0) dp.lceq = dp.laeq + 8.3
    if (i % 3 === 0) dp.lafmax = dp.laeq + 5.7
    if (i % 5 === 0) dp.spectra = [30.1, 31.2, 32.3, 33.4, 34.5, 35.6]
    out.push(dp)
  }
  return out
}

const cat = (id: string, mode: Category['mode']): Category => ({ id, name: id, color: '#22c55e', mode, visible: true })
const per = (id: string, categoryId: string): Period => ({ id, name: id, startMs: 1_700_000_000_000, endMs: 1_700_003_600_000, categoryId })

function makeProject(dataPointsPerFile = 3): ProjectData {
  return {
    version: '1.1',
    savedAt: '2026-07-22T12:00:00.000Z',
    files: [
      { id: 'f1', name: 'BV-94.xlsx', model: '831C', serial: '12782', date: '2026-07-07', startTime: '07:00', stopTime: '15:00', rowCount: dataPointsPerFile, data: makeDataPoints(dataPointsPerFile) },
      { id: 'f2', name: 'BV-98.xlsx', model: '831C', serial: '12783', date: '2026-07-07', startTime: '07:00', stopTime: '15:00', rowCount: dataPointsPerFile, data: makeDataPoints(dataPointsPerFile) },
    ],
    pointAssignments: { f1: 'BV-94', f2: 'BV-98' },
    events: [],
    concordance: {},
    categories: [cat('amb', 'include'), cat('exc', 'exclude')],
    periods: [per('p1', 'amb'), per('p2', 'exc')],
    projectName: 'Projet test',
  }
}

describe('dataverseProjectStore — sérialisation (round-trip versionné, chaîne octets)', () => {
  it('1. round-trip intégrité : ProjectData réaliste conservé + schemaVersion=1', () => {
    const p = makeProject(3)
    const gz = serializeProject(p)
    const { schemaVersion, project } = deserializeProject(gz)
    expect(schemaVersion).toBe(1)
    expect(schemaVersion).toBe(SCHEMA_VERSION)
    expect(project).toEqual(p) // deep equal
  })

  it('2. intégrité aux octets sur data volumineux (~1000 DataPoint) : aucune perte/arrondi', () => {
    const p = makeProject(1000)
    const gz = serializeProject(p)
    const { project } = deserializeProject(gz)
    expect(project.files[0].data).toHaveLength(1000)
    expect(project.files[0].data).toEqual(p.files[0].data) // data intact au bit près
    expect(project).toEqual(p) // deep equal complet
  })

  it('3. tolérance ancien format : ProjectData NU (sans wrapper) → pas de throw, schemaVersion=0', () => {
    const naked = makeProject(2)
    const gzNaked = pako.gzip(new TextEncoder().encode(JSON.stringify(naked))) // PAS d'enveloppe {schemaVersion,project}
    const { schemaVersion, project } = deserializeProject(gzNaked)
    expect(schemaVersion).toBe(0)
    expect(project).toEqual(naked)
  })

  it('4. ratio de compression (log, pas d’assert strict) sur le cas volumineux', () => {
    const p = makeProject(1000)
    const raw = new TextEncoder().encode(JSON.stringify({ schemaVersion: SCHEMA_VERSION, project: p }))
    const gz = serializeProject(p)
    const ratio = raw.length / gz.length
    // eslint-disable-next-line no-console
    console.log(`[ratio] brut ${(raw.length / 1024).toFixed(1)} Ko → gz ${(gz.length / 1024).toFixed(1)} Ko = ${ratio.toFixed(2)}:1`)
    expect(ratio).toBeGreaterThan(1) // sanité, pas de seuil strict
  })
})
