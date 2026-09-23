import { describe, it, expect } from 'vitest'
import {
  makeDefaultMeteoState,
  serializeMeteoModule,
  deserializeMeteoModule,
  ecccStationsUsed,
  ecccFailuresUsed,
  fenetresAExclure,
  NIVEAUX_EXCLUS_PAR_METEO,
  type MeteoModuleState,
} from './meteoModule'
import type { PointMeteoResults } from './meteoModule'
import type { SourceResult, SourceError } from './meteoSources'
import { evaluateRecevabilite, isMelccfpDefault } from './recevabilite'

describe('fenetresAExclure — « Exclure les heures non recevables »', () => {
  const H = 3_600_000
  const h = (i: number, level: 'ok' | 'warn' | 'bad' | 'indetermine') => ({ startMs: i * H, endMs: (i + 1) * H, level })

  it('RÈGLE : retire non recevable et indéterminé, garde recevable et à signaler', () => {
    expect(NIVEAUX_EXCLUS_PAR_METEO.has('bad')).toBe(true)
    expect(NIVEAUX_EXCLUS_PAR_METEO.has('indetermine')).toBe(true)
    expect(NIVEAUX_EXCLUS_PAR_METEO.has('warn')).toBe(false)
    expect(NIVEAUX_EXCLUS_PAR_METEO.has('ok')).toBe(false)
    expect(fenetresAExclure([h(0, 'ok')])).toEqual([])
    expect(fenetresAExclure([h(0, 'warn')])).toEqual([])
    expect(fenetresAExclure([h(0, 'bad')])).toEqual([{ startMs: 0, endMs: H }])
    expect(fenetresAExclure([h(0, 'indetermine')])).toEqual([{ startMs: 0, endMs: H }])
  })

  it('fusionne les heures exclues contiguës, jamais par-dessus une heure conservée', () => {
    const hours = [h(0, 'bad'), h(1, 'indetermine'), h(2, 'warn'), h(3, 'bad'), h(4, 'ok'), h(5, 'indetermine')]
    expect(fenetresAExclure(hours)).toEqual([
      { startMs: 0, endMs: 2 * H },
      { startMs: 3 * H, endMs: 4 * H },
      { startMs: 5 * H, endMs: 6 * H },
    ])
  })

  it('ordre d’entrée indifférent', () => {
    expect(fenetresAExclure([h(1, 'bad'), h(0, 'bad')])).toEqual([{ startMs: 0, endMs: 2 * H }])
  })
})

describe('persistance meteoModule — config d’avant les filtres de validité', () => {
  it('un projet sans champs de validité se charge avec les défauts −50/+50 °C, 100 mm', () => {
    const p = serializeMeteoModule(makeDefaultMeteoState())
    // Forme d'un projet sauvegardé AVANT l'ajout des filtres : 3 seuils seulement.
    const ancien = { ...p, recevabiliteConfig: { windMaxKmh: 25, precipMaxMm: 0, hrDryPct: 90 } }
    const cfg = deserializeMeteoModule(ancien as typeof p).recevabiliteConfig
    expect(cfg.windMaxKmh).toBe(25) // seuil persisté conservé
    expect(cfg.validiteTempMinC).toBe(-50)
    expect(cfg.validiteTempMaxC).toBe(50)
    expect(cfg.validitePrecipMaxMm).toBe(100)
  })

  it('JAMAIS RÉTROACTIF : un projet sans critère d’humidité se recharge sans critère', () => {
    const p = serializeMeteoModule(makeDefaultMeteoState())
    const ancien = { ...p, recevabiliteConfig: { windMaxKmh: 20, precipMaxMm: 0, hrDryPct: 90 } }
    const cfg = deserializeMeteoModule(ancien as typeof p).recevabiliteConfig
    expect(cfg.humiditeMode).toBe('aucun')
    expect(isMelccfpDefault(cfg)).toBe(true)
    // Une heure à HR 99 % reste recevable dans ce projet rechargé.
    const [h] = evaluateRecevabilite(
      [{ datetime: '2026-07-03T08:00', temperature: 20, humidity: 99, precipitation: 0, windSpeed: 5, windDirection: null }],
      true,
      cfg,
    )
    expect(h.level).toBe('ok')
  })

  it('un critère ACTIVÉ puis sauvegardé est restauré tel quel', () => {
    const s = makeDefaultMeteoState()
    s.recevabiliteConfig = { ...s.recevabiliteConfig, humiditeMode: 'hr', hrMaxPct: 85 }
    const cfg = deserializeMeteoModule(serializeMeteoModule(s)).recevabiliteConfig
    expect(cfg.humiditeMode).toBe('hr')
    expect(cfg.hrMaxPct).toBe(85)
  })
})

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

describe('ecccFailuresUsed — le rapport n’est jamais muet sur une source tentée', () => {
  it('produit « label : indisponible — cause » par point ECCC en échec', () => {
    const base = makeDefaultMeteoState()
    const pid = base.points[0].id
    const err: SourceError = {
      source: 'eccc',
      error: 'Échec de connexion au service ECCC (réseau ou blocage navigateur).',
      ecccFailure: { kind: 'network' },
    }
    const state: MeteoModuleState = {
      ...base,
      points: [{ ...base.points[0], label: 'BV-94' }],
      results: [{ pointId: pid, outcomes: [err] } as PointMeteoResults],
    }
    expect(ecccFailuresUsed(state)).toEqual([
      'BV-94 : indisponible — Échec de connexion au service ECCC (réseau ou blocage navigateur).',
    ])
  })

  it('un succès ECCC n’apparaît pas dans les échecs', () => {
    const base = makeDefaultMeteoState()
    const pid = base.points[0].id
    const ok = {
      source: 'eccc',
      rows: [],
      station: { name: 'Dorval', lat: 0, lng: 0, distanceKm: 3, climateId: '702S006' },
      sourceUrl: '',
      sourceLabel: '',
      isArchive: true,
      timezone: 'local (LST)',
    } satisfies SourceResult
    const state: MeteoModuleState = {
      ...base,
      results: [{ pointId: pid, outcomes: [ok] } as PointMeteoResults],
    }
    expect(ecccFailuresUsed(state)).toEqual([])
  })
})
