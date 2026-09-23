import { describe, it, expect } from 'vitest'
import {
  makeDefaultMeteoState,
  serializeMeteoModule,
  deserializeMeteoModule,
  ecccStationsUsed,
  ecccFailuresUsed,
  NIVEAUX_EXCLUS_PAR_METEO,
  meteoModuleAuChargement,
  type MeteoModuleState,
} from './meteoModule'
import type { PointMeteoResults } from './meteoModule'
import type { SourceResult, SourceError } from './meteoSources'
import { evaluateRecevabilite, isMelccfpDefault } from './recevabilite'

describe('meteoModuleAuChargement — création et 3 voies de chargement, même règle', () => {
  it('projet SANS module → module vierge (jamais l’état du projet précédent)', () => {
    for (const absent of [undefined, null]) {
      const m = meteoModuleAuChargement(absent)
      const vierge = makeDefaultMeteoState()
      expect(m.results).toEqual([])
      expect(m.eccStationByPoint).toEqual({})
      expect(m.recevabiliteConfig).toEqual(vierge.recevabiliteConfig)
      expect([...m.selectedSources]).toEqual([...vierge.selectedSources])
      expect(m.points).toHaveLength(1)
    }
  })

  it('projet AVEC module → ce module, désérialisé', () => {
    const s = makeDefaultMeteoState()
    s.eccStationByPoint = { [s.points[0].id]: '7025251' }
    s.recevabiliteConfig = { ...s.recevabiliteConfig, windMaxKmh: 25 }
    const m = meteoModuleAuChargement(serializeMeteoModule(s))
    expect(m.eccStationByPoint).toEqual(s.eccStationByPoint)
    expect(m.recevabiliteConfig.windMaxKmh).toBe(25)
  })

  it('App.tsx : la création ET les 3 voies de chargement passent par cette règle, et rien d’autre', async () => {
    const fs = await import('node:fs')
    const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    const corps = (nom: string) => {
      const i = app.indexOf(`const ${nom} = useCallback(`)
      expect(i, `${nom} introuvable`).toBeGreaterThan(-1)
      return app.slice(i, app.indexOf('\n  }, [', i))
    }
    const voies = {
      handleNewProject: 'meteoModuleAuChargement(null)',
      handleOpenDataverseProject: 'meteoModuleAuChargement(project.meteoModule)',
      handleLoadProject: 'meteoModuleAuChargement(project.meteoModule)',
      handleSwitchProject: 'meteoModuleAuChargement(parsed.meteoModule)',
    }
    for (const [h, appel] of Object.entries(voies)) {
      // Appel INCONDITIONNEL : pas de « if (…) setMeteoModule » qui garderait l'ancien état.
      const echappe = `setMeteoModule(${appel})`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(corps(h), h).toMatch(new RegExp(`^\\s+${echappe}`, 'm')) // en début de ligne : inconditionnel
      expect(corps(h), h).not.toMatch(/if \([^)]*\) setMeteoModule/)
    }
    // Aucun autre setMeteoModule(…) que ces 4 appels (hors la page Météo elle-même).
    const appels = app.match(/setMeteoModule\(/g) ?? []
    expect(appels).toHaveLength(4)
  })
})

describe('NIVEAUX_EXCLUS_PAR_METEO — ce que la météo peut SUGGÉRER d’exclure', () => {
  it('non recevable et indéterminé ; jamais recevable ni « à signaler » (recevable au §3.6)', () => {
    expect([...NIVEAUX_EXCLUS_PAR_METEO].sort()).toEqual(['bad', 'indetermine'])
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
