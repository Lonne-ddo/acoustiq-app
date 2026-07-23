import { describe, it, expect } from 'vitest'
import { buildIndicesSnapshot, buildFullProjectData, buildProjectNotes } from './projectManager'
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

describe('buildFullProjectData — ProjectData COMPLET (voie Dataverse)', () => {
  const data = [dp(0, 50), dp(60, 90), dp(120, 50)]
  const files = [file(data)]
  const pointMap = { f1: 'BV-1' }

  it('embarque les données brutes files[].data + spectraFreqs (contrairement à saveProject)', () => {
    const freqs = [31.5, 40, 50, 63] // alignement 821SE
    const withFreqs = [{ ...file(data), spectraFreqs: freqs }]
    const pd = buildFullProjectData({ files: withFreqs, pointMap, events: [], concordance: {}, savedAt: 'X' })
    expect(pd.files).toHaveLength(1)
    expect(pd.files[0].data).toEqual(data) // présent + intact
    expect(pd.files[0].spectraFreqs).toEqual(freqs) // alignement spectral préservé
    // métadonnées standard aussi présentes
    expect(pd.files[0]).toMatchObject({ id: 'f1', name: 'f1', model: '831C', rowCount: 3 })
  })

  it('inclut projectName + projectNumber (vide autorisé)', () => {
    const withNum = buildFullProjectData({
      files, pointMap, events: [], concordance: {},
      projectName: 'Chantier X', projectNumber: '24-01234', savedAt: 'X',
    })
    expect(withNum.projectName).toBe('Chantier X')
    expect(withNum.projectNumber).toBe('24-01234')

    const empty = buildFullProjectData({ files, pointMap, events: [], concordance: {}, savedAt: 'X' })
    expect(empty.projectNumber).toBeUndefined() // non fourni → non bloquant
  })

  it('reprend les autres champs de ProjectData + savedAt injectable', () => {
    const cats: Category[] = [catExcl]
    const pers: Period[] = [periodExcl]
    const pd = buildFullProjectData({
      files, pointMap,
      events: [], concordance: { 'e1|BV-1': 'confirmed' },
      mapImage: 'data:img', mapMarkers: { 'BV-1': { x: 0.5, y: 0.5 } },
      categories: cats, periods: pers, savedAt: '2026-07-22T00:00:00.000Z',
    })
    expect(pd.version).toBe('1.1')
    expect(pd.savedAt).toBe('2026-07-22T00:00:00.000Z')
    expect(pd.pointAssignments).toEqual(pointMap)
    expect(pd.concordance).toEqual({ 'e1|BV-1': 'confirmed' })
    expect(pd.mapImage).toBe('data:img')
    expect(pd.categories).toEqual(cats)
    expect(pd.periods).toEqual(pers)
    // PAS de snapshot d'indices : voie Dataverse sources-only, recalcul au load.
    expect(pd.indicesSnapshot).toBeUndefined()
  })

  it('est PURE : ne mute pas les entrées', () => {
    const pm = { f1: 'BV-1' }
    const evs: never[] = []
    const pd = buildFullProjectData({ files, pointMap: pm, events: evs, concordance: {}, savedAt: 'X' })
    expect(pd.pointAssignments).not.toBe(pm) // copie défensive
    expect(pm).toEqual({ f1: 'BV-1' }) // entrée intacte
  })
})

describe('buildProjectNotes — résumé court pour acq_notes', () => {
  const mk = (id: string, date: string): MeasurementFile => ({ ...file([]), id, name: id, date })

  it('compte fichiers + points distincts + plage de dates', () => {
    const files = [mk('f1', '2026-07-07'), mk('f2', '2026-07-08'), mk('f3', '2026-07-07')]
    const notes = buildProjectNotes(files, { f1: 'BV-1', f2: 'BV-2', f3: 'BV-1' })
    expect(notes).toBe('3 fichier(s), 2 point(s), 2026-07-07 → 2026-07-08')
  })

  it('une seule date → pas de flèche', () => {
    const files = [mk('f1', '2026-07-07')]
    expect(buildProjectNotes(files, { f1: 'BV-1' })).toBe('1 fichier(s), 1 point(s), 2026-07-07')
  })

  it('projet vide → 0 fichier, aucune date', () => {
    expect(buildProjectNotes([], {})).toBe('0 fichier(s), 0 point(s), aucune date')
  })
})
