import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as pako from 'pako'
import { fetchSource, clearMeteoCache, openMeteoEstArchive, isError, type SourceResult, type SourceError } from './meteoSources'
import { makeDefaultMeteoState, serializeMeteoModule, meteoModuleAuChargement, type MeteoModuleState } from './meteoModule'
import { buildFullProjectData, recentStateJson } from '../modules/projectManager'
import { serializeProject, deserializeProject } from '../modules/dataverseProjectStore'
import { DEFAULT_METEO } from '../types'

const T0 = new Date('2026-09-23T14:00:00Z') // départ de la requête
const T1 = new Date('2026-09-23T14:00:07Z') // résolution réseau
const T2 = new Date('2026-09-23T15:30:00Z') // second appel, servi par le cache

function omJson() {
  return {
    latitude: 45.5, longitude: -73.6, elevation: 40, timezone: 'America/Toronto',
    hourly: {
      time: ['2025-07-03T08:00', '2025-07-03T09:00'],
      temperature_2m: [20, 21], relative_humidity_2m: [60, 58], precipitation: [0, 0],
      wind_speed_10m: [5, 6], wind_direction_10m: [180, 190], weather_code: [1, 2],
      dew_point_2m: [12, null], surface_pressure: [1004.6, 1004.2],
    },
  }
}
const jsonRes = (obj: unknown) => ({ ok: true, status: 200, json: async () => obj, text: async () => '' }) as Response

beforeEach(() => {
  clearMeteoCache()
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('fetchedAt — posé à la RÉSOLUTION réseau, conservé par le cache', () => {
  it('résolution à T1 (pas le départ T0) ; second appel servi par le cache → T1, un seul appel réseau', async () => {
    vi.setSystemTime(T0)
    let liberer!: () => void
    const reponse = new Promise<void>((r) => { liberer = r })
    const fetchMock = vi.fn(async () => { await reponse; return jsonRes(omJson()) })
    global.fetch = fetchMock as unknown as typeof fetch

    const p = fetchSource('openmeteo', 45.5, -73.6, '2025-07-03', '2025-07-03')
    vi.setSystemTime(T1) // le réseau répond plus tard
    liberer()
    const o1 = await p
    expect(isError(o1)).toBe(false)
    expect(o1.fetchedAt).toBe(T1.toISOString())

    vi.setSystemTime(T2)
    const o2 = await fetchSource('openmeteo', 45.5, -73.6, '2025-07-03', '2025-07-03')
    expect(o2.fetchedAt).toBe(T1.toISOString()) // horodatage d'ORIGINE, pas T2
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('request figée : coordonnées, plage, côté archive, fuseau ; lignes avec dewpoint/pressure tels quels', async () => {
    vi.setSystemTime(T0)
    global.fetch = vi.fn(async () => jsonRes(omJson())) as unknown as typeof fetch
    const o = (await fetchSource('openmeteo', 45.5, -73.6, '2025-07-03', '2025-07-03')) as SourceResult
    expect(o.request).toEqual({
      lat: 45.5, lng: -73.6, startDate: '2025-07-03', endDate: '2025-07-03',
      chosenClimateId: null, isArchive: true, timezone: 'America/Toronto',
    })
    expect(o.rows[0].dewpoint).toBe(12)
    expect(o.rows[1].dewpoint).toBeNull() // absent à la source : PAS recalculé
    expect(o.rows[0].pressureHpa).toBe(1004.6)
  })

  it('échec de source : figé aussi (fetchedAt + request), ECCC avec sa cause typée', async () => {
    vi.setSystemTime(T0)
    global.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => 'indisponible' }) as Response) as unknown as typeof fetch
    const om = (await fetchSource('openmeteo', 45.5, -73.6, '2025-07-03', '2025-07-03')) as SourceError
    expect(om.error).toContain('503')
    expect(om.fetchedAt).toBe(T0.toISOString())
    expect(om.request?.isArchive).toBe(true)
    const ec = (await fetchSource('eccc', 45.5, -73.6, '2025-07-03', '2025-07-03', '7025251')) as SourceError
    // 503 sur la liste des stations : classé « no-stations » par fetchECCCStations, statut conservé.
    expect(ec.ecccFailure).toEqual({ kind: 'no-stations', httpStatus: 503 })
    expect(ec.fetchedAt).toBe(T0.toISOString())
    expect(ec.request).toMatchObject({ chosenClimateId: '7025251', isArchive: true, timezone: 'America/Toronto' })
  })
})

describe('frontière archive / prévision Open-Meteo — elle bouge avec la date du jour', () => {
  const now = new Date(2026, 8, 23, 10, 0) // 23 sept. 2026, heure locale
  it('fin de plage à 7 jours ⇒ archive ; à 6 jours ⇒ prévision ; GEM toujours prévision', () => {
    expect(openMeteoEstArchive('2026-09-16', null, now)).toBe(true)
    expect(openMeteoEstArchive('2026-09-17', null, now)).toBe(false)
    expect(openMeteoEstArchive('2025-07-03', 'gem_seamless', now)).toBe(false)
  })

  it('la MÊME plage change de côté quand le jour avance : request le fige', async () => {
    global.fetch = vi.fn(async () => jsonRes(omJson())) as unknown as typeof fetch
    vi.setSystemTime(new Date(2026, 8, 20, 10, 0)) // fin de plage à 3 jours
    const avant = (await fetchSource('openmeteo', 45.5, -73.6, '2026-09-17', '2026-09-17')) as SourceResult
    clearMeteoCache()
    vi.setSystemTime(new Date(2026, 8, 30, 10, 0)) // fin de plage à 13 jours
    const apres = (await fetchSource('openmeteo', 45.5, -73.6, '2026-09-17', '2026-09-17')) as SourceResult
    expect(avant.request?.isArchive).toBe(false)
    expect(apres.request?.isArchive).toBe(true)
  })
})

/** État réaliste : un succès (Td absent sur une ligne), un échec ECCC typé, traces complètes. */
function etatAvecResultats(): MeteoModuleState {
  const s = makeDefaultMeteoState()
  const pid = s.points[0].id
  const req = { lat: 45.5, lng: -73.6, startDate: '2025-07-03', endDate: '2025-07-03', chosenClimateId: null, isArchive: true, timezone: 'America/Toronto' }
  s.results = [{
    pointId: pid,
    outcomes: [
      {
        source: 'openmeteo',
        rows: [
          { datetime: '2025-07-03T08:00', temperature: 20, humidity: 60, precipitation: 0, windSpeed: 5, windDirection: 180, weatherCode: 1, weatherText: null, dewpoint: 12, pressureHpa: 1004.6 },
          { datetime: '2025-07-03T09:00', temperature: 21, humidity: 58, precipitation: 0, windSpeed: 6, windDirection: 190, weatherCode: 2, weatherText: null, dewpoint: null, pressureHpa: null },
        ],
        station: { name: 'Point de grille', lat: 45.5, lng: -73.6, distanceKm: 1.2, elevation: 40 },
        sourceUrl: 'https://archive-api.open-meteo.com/v1/archive?x', sourceLabel: 'Open-Meteo Archive · ERA5',
        isArchive: true, timezone: 'America/Toronto',
        fetchedAt: '2026-09-23T14:00:07.000Z', request: req,
      },
      {
        source: 'eccc', error: 'Env. Canada : erreur HTTP 503', ecccFailure: { kind: 'http', httpStatus: 503 },
        fetchedAt: '2026-09-23T14:00:09.000Z', request: { ...req, chosenClimateId: '7025251', timezone: 'local (LST)' },
      },
    ],
  }]
  return s
}

function blob(meteoModuleState: MeteoModuleState) {
  const project = buildFullProjectData({
    files: [], pointMap: {}, events: [], concordance: {},
    meteoModule: serializeMeteoModule(meteoModuleState, { withResults: true }),
    savedAt: '2026-09-23T16:00:00.000Z',
  })
  return serializeProject(project)
}

describe('blob projet (Dataverse) — results figés, rien de recalculé au chargement', () => {
  it('round-trip gzip : succès, échec ECCC, fetchedAt, request, dewpoint/pressure — identiques', () => {
    const etat = etatAvecResultats()
    const { schemaVersion, project } = deserializeProject(blob(etat))
    expect(schemaVersion).toBe(2)
    const recharge = meteoModuleAuChargement(project.meteoModule)
    expect(recharge.results).toEqual(etat.results)
    const om = recharge.results[0].outcomes[0] as SourceResult
    expect(om.rows[1].dewpoint).toBeNull() // pas de Magnus au chargement
  })

  it('le blob est une COPIE : modifier l’état après sérialisation ne le change pas', () => {
    const etat = etatAvecResultats()
    const persiste = serializeMeteoModule(etat, { withResults: true })
    ;(etat.results[0].outcomes[0] as SourceResult).rows[0].temperature = 99
    expect((persiste.results![0].outcomes[0] as SourceResult).rows[0].temperature).toBe(20)
  })

  it('blob v1 (avant figeage, sans results) : se charge, module sans résultats, config intacte', () => {
    const cfg = { ...makeDefaultMeteoState().recevabiliteConfig, windMaxKmh: 25 }
    const v1 = {
      schemaVersion: 1,
      project: {
        version: '1.1', savedAt: '2026-01-01T00:00:00Z', files: [], pointAssignments: {}, events: [], concordance: {},
        meteoModule: { points: [], startDate: '2025-07-03', endDate: '2025-07-09', selectedSources: ['eccc'], asphalt: true, eccStationByPoint: {}, recevabiliteConfig: cfg },
      },
    }
    const { schemaVersion, project } = deserializeProject(pako.gzip(new TextEncoder().encode(JSON.stringify(v1))))
    expect(schemaVersion).toBe(1)
    const m = meteoModuleAuChargement(project.meteoModule)
    expect(m.results).toEqual([])
    expect(m.recevabiliteConfig.windMaxKmh).toBe(25)
  })
})

describe('projets récents (localStorage) — JAMAIS de results', () => {
  const aucuneCleResults = (v: unknown): boolean => {
    if (Array.isArray(v)) return v.every(aucuneCleResults)
    if (v && typeof v === 'object') return !('results' in v) && Object.values(v).every(aucuneCleResults)
    return true
  }
  const base = {
    files: [], pointMap: {}, events: [], concordance: {}, mapImage: null, mapMarkers: {}, meteo: DEFAULT_METEO,
    checklist: {} as never, categories: [], periods: [], projectNumber: '',
  }
  const etats: [string, MeteoModuleState][] = [
    ['module vierge', makeDefaultMeteoState()],
    ['module avec résultats et échecs', etatAvecResultats()],
    ['module rechargé depuis un blob (résultats figés)', meteoModuleAuChargement(deserializeProject(blob(etatAvecResultats())).project.meteoModule)],
  ]
  for (const [nom, meteoModule] of etats) {
    it(`${nom} : le JSON écrit ne contient la clé « results » à aucun niveau`, () => {
      const json = recentStateJson({ ...base, meteoModule })
      expect(aucuneCleResults(JSON.parse(json))).toBe(true)
      expect(json).not.toContain('"results"')
    })
  }
})
