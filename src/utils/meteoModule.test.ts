import { describe, it, expect } from 'vitest'
import {
  makeDefaultMeteoState,
  serializeMeteoModule,
  deserializeMeteoModule,
  ecccStationsUsed,
  type MeteoModuleState,
} from './meteoModule'
import type { PointMeteoResults } from './meteoModule'
import type { SourceResult } from './meteoSources'

describe('persistance meteoModule — eccStationByPoint (save/load)', () => {
  function stateWithChoice(): MeteoModuleState {
    const base = makeDefaultMeteoState()
    const pid = base.points[0].id
    return {
      ...base,
      eccStationByPoint: { [pid]: '702S006' },
      // results volumineux : ne doivent PAS être persistés
      results: [{ pointId: pid, outcomes: [] } as PointMeteoResults],
    }
  }

  it('serialize retire les results et convertit le Set de sources en tableau', () => {
    const p = serializeMeteoModule(stateWithChoice())
    expect('results' in p).toBe(false)
    expect(Array.isArray(p.selectedSources)).toBe(true)
    expect(p.selectedSources).toEqual(expect.arrayContaining(['openmeteo', 'gem', 'eccc']))
  })

  it('round-trip préserve le choix de station et vide les results', () => {
    const original = stateWithChoice()
    const pid = original.points[0].id
    const restored = deserializeMeteoModule(serializeMeteoModule(original))

    expect(restored.eccStationByPoint).toEqual({ [pid]: '702S006' })
    expect(restored.results).toEqual([]) // results non persistés
    expect(restored.selectedSources instanceof Set).toBe(true)
    expect(restored.selectedSources.has('eccc')).toBe(true)
    expect(restored.points[0].id).toBe(pid) // id de point stable → clé non orpheline
    expect(restored.startDate).toBe(original.startDate)
    expect(restored.asphalt).toBe(original.asphalt)
  })

  it('deserialize tolère une charge partielle (défauts sûrs)', () => {
    const restored = deserializeMeteoModule({
      points: [],
      startDate: '',
      endDate: '',
      selectedSources: [],
      asphalt: true,
      eccStationByPoint: {},
    })
    expect(restored.points.length).toBeGreaterThan(0) // retombe sur le défaut
    expect(restored.results).toEqual([])
    expect(restored.eccStationByPoint).toEqual({})
  })
})

describe('ecccStationsUsed — traçabilité rapport', () => {
  it('produit une ligne « label : trace » par point avec résultat ECCC', () => {
    const base = makeDefaultMeteoState()
    const pid = base.points[0].id
    const ecccResult = {
      source: 'eccc',
      rows: [],
      station: { name: 'Dorval (QC)', lat: 0, lng: 0, distanceKm: 3.2, climateId: '702S006', elevation: 36 },
      sourceUrl: '',
      sourceLabel: '',
      isArchive: true,
      timezone: 'local (LST)',
    } satisfies SourceResult
    const state: MeteoModuleState = {
      ...base,
      points: [{ ...base.points[0], label: 'BV-94' }],
      results: [{ pointId: pid, outcomes: [ecccResult] } as PointMeteoResults],
    }
    expect(ecccStationsUsed(state)).toEqual(['BV-94 : Dorval (QC) · id 702S006 · 3.2 km · 36 m'])
  })

  it('ignore les points sans résultat ECCC', () => {
    const base = makeDefaultMeteoState()
    const pid = base.points[0].id
    const state: MeteoModuleState = {
      ...base,
      results: [{ pointId: pid, outcomes: [{ source: 'eccc', error: 'HTTP 500' }] } as PointMeteoResults],
    }
    expect(ecccStationsUsed(state)).toEqual([])
  })
})
