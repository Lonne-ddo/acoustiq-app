import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchECCC, utcVersHeureToronto, lstVersHeureToronto, type SourceResult } from './meteoSources'
import { hourKeyOf } from './recevabilite'
import { makeDefaultMeteoState, serializeMeteoModule, meteoModuleAuChargement, corrigerEcccLstALaLecture } from './meteoModule'

/**
 * Heure ECCC. Faits vérifiés sur l'API réelle (2026-09-23) :
 *  - LOCAL_DATE est en heure NORMALE toute l'année : 12:00 LST = 17:00 UTC en
 *    juillet COMME en janvier ;
 *  - le filtre `datetime` porte sur LOCAL_DATE (17:00Z renvoie LOCAL 17:00).
 * Avant correction, les heures d'été ECCC étaient placées une heure trop tôt.
 */

describe('conversions — une heure d’ÉTÉ et une heure d’HIVER', () => {
  it('UTC → heure légale Toronto : été UTC−4, hiver UTC−5', () => {
    expect(utcVersHeureToronto('2025-07-03T17:00:00')).toBe('2025-07-03 13:00:00') // HAE
    expect(utcVersHeureToronto('2025-01-15T17:00:00')).toBe('2025-01-15 12:00:00') // HNE
    expect(utcVersHeureToronto('2025-07-04T03:30:00')).toBe('2025-07-03 23:30:00') // passage de minuit
    expect(utcVersHeureToronto('illisible')).toBeNull()
  })

  it('LST (heure normale) → heure légale : +1 h l’été, identique l’hiver', () => {
    expect(lstVersHeureToronto('2025-07-03 12:00:00')).toBe('2025-07-03 13:00:00')
    expect(lstVersHeureToronto('2025-01-15 12:00:00')).toBe('2025-01-15 12:00:00')
    expect(lstVersHeureToronto('2025-07-03 23:00:00')).toBe('2025-07-04 00:00:00')
  })
})

/** Journée LST complète de la veille au lendemain, telle que l'API la renverrait. */
function featuresLst(debutLst: string, heures: number, ecartUtc = 5) {
  const [d, h] = debutLst.split(' ')
  const t0 = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), +h.slice(0, 2))
  return Array.from({ length: heures }, (_, i) => {
    const lst = new Date(t0 + i * 3_600_000).toISOString().slice(0, 19)
    const utc = new Date(t0 + (i + ecartUtc) * 3_600_000).toISOString().slice(0, 19)
    return { properties: { LOCAL_DATE: lst.replace('T', ' '), UTC_DATE: utc, TEMP: i, REL_HUM: 70, PRECIP_AMOUNT: 0, WIND_SPEED: 5, WIND_DIRECTION: 18 } }
  })
}
const station = {
  geometry: { coordinates: [-73.74, 45.47] },
  properties: { CLIMATE_IDENTIFIER: '7025251', STN_ID: 51157, STATION_NAME: 'MONTREAL INTL A', PROV_STATE_TERR_CODE: 'QC', HAS_HOURLY_DATA: 'Y', ELEVATION: 36, HLY_FIRST_DATE: '2013-01-01', HLY_LAST_DATE: '2025-12-31' },
}
const json = (o: unknown) => ({ ok: true, status: 200, json: async () => o, text: async () => '' }) as Response

let urls: string[]
function mock(features: unknown[]) {
  urls = []
  global.fetch = vi.fn(async (u: unknown) => {
    urls.push(String(u))
    return String(u).includes('climate-stations') ? json({ features: [station] }) : json({ features })
  }) as unknown as typeof fetch
}
beforeEach(() => { urls = [] })
afterEach(() => vi.restoreAllMocks())

describe('fetchECCC — heures légales, journées complètes', () => {
  it('ÉTÉ : 24 heures légales du 3 juillet, 00:00 à 23:00 (depuis LST 2 juil. 23:00 → 3 juil. 22:00)', async () => {
    mock(featuresLst('2025-07-02 00:00:00', 72)) // l'API renvoie les 3 jours LST de la fenêtre élargie
    const r = (await fetchECCC(45.5, -73.6, '2025-07-03', '2025-07-03')) as SourceResult
    expect(r.rows).toHaveLength(24)
    expect(r.rows[0].datetime).toBe('2025-07-03 00:00:00')
    expect(r.rows[23].datetime).toBe('2025-07-03 23:00:00')
    // 13:00 légale = 12:00 LST = la 13e heure LST de la fenêtre qui commence le 2 juillet 00:00 → TEMP 36
    expect(r.rows.find((x) => x.datetime === '2025-07-03 13:00:00')?.temperature).toBe(36)
    expect(r.timezone).toBe('America/Toronto')
    // Fenêtre élargie d'un jour de chaque côté (filtre de l'API en LST).
    expect(urls.find((u) => u.includes('climate-hourly'))).toContain('datetime=2025-07-02T00:00:00Z/2025-07-04T23:59:59Z')
  })

  it('HIVER : 24 heures, LST = heure légale (aucun décalage)', async () => {
    mock(featuresLst('2025-01-14 00:00:00', 72))
    const r = (await fetchECCC(45.5, -73.6, '2025-01-15', '2025-01-15')) as SourceResult
    expect(r.rows).toHaveLength(24)
    expect(r.rows.find((x) => x.datetime === '2025-01-15 12:00:00')?.temperature).toBe(36) // 12:00 LST
  })

  it('ALIGNEMENT : la ligne ECCC de 17:00 UTC et la ligne Open-Meteo de 13:00 (HAE) ont la même clé horaire', async () => {
    mock(featuresLst('2025-07-02 00:00:00', 72))
    const r = (await fetchECCC(45.5, -73.6, '2025-07-03', '2025-07-03')) as SourceResult
    const ecccDe17hUtc = r.rows.find((x) => x.temperature === 36)!
    expect(hourKeyOf(ecccDe17hUtc.datetime)).toBe(hourKeyOf('2025-07-03T13:00')) // format Open-Meteo
  })
})

describe('résultats ECCC figés AVANT la correction : corrigés à la lecture', () => {
  function ancienEccc(stationName: string, rows: string[]): SourceResult {
    return {
      source: 'eccc',
      rows: rows.map((datetime) => ({ datetime, temperature: 20, humidity: 60, precipitation: 0, windSpeed: 5, windDirection: 180 })),
      station: { name: stationName, lat: 45.47, lng: -73.74, distanceKm: 3, climateId: '7025251' },
      sourceUrl: 'x', sourceLabel: 'x', isArchive: true, timezone: 'local (LST)',
      fetchedAt: '2026-09-23T15:00:00.000Z',
    }
  }
  function recharger(o: SourceResult) {
    const s = makeDefaultMeteoState()
    s.results = [{ pointId: s.points[0].id, outcomes: [o] }]
    return meteoModuleAuChargement(serializeMeteoModule(s, { withResults: true })).results[0].outcomes[0] as SourceResult
  }

  it('station QC : +1 h l’été, rien l’hiver ; marqué « corrigé à la lecture »', () => {
    const r = recharger(ancienEccc('MONTREAL INTL A (QC)', ['2025-07-03 12:00:00', '2025-01-15 12:00:00']))
    expect(r.rows.map((x) => x.datetime)).toEqual(['2025-07-03 13:00:00', '2025-01-15 12:00:00'])
    expect(r.timezone).toContain('corrigé à la lecture')
    expect(r.fetchedAt).toBe('2026-09-23T15:00:00.000Z') // la trace d'acquisition n'est pas touchée
  })

  it('province à écart LST non sûr (BC) : laissé tel quel', () => {
    const r = recharger(ancienEccc('VANCOUVER INTL A (BC)', ['2025-07-03 12:00:00']))
    expect(r.rows[0].datetime).toBe('2025-07-03 12:00:00')
    expect(r.timezone).toBe('local (LST)')
  })

  it('résultat récent (déjà en heure légale) : jamais décalé une seconde fois', () => {
    const recent = { ...ancienEccc('MONTREAL INTL A (QC)', ['2025-07-03 13:00:00']), timezone: 'America/Toronto' }
    expect(corrigerEcccLstALaLecture(recent)).toBe(recent)
    expect(recharger(recent).rows[0].datetime).toBe('2025-07-03 13:00:00')
  })
})
