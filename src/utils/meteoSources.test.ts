import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  orderEcccAttempts,
  formatStationTrace,
  fetchECCC,
  type ECStationCandidate,
} from './meteoSources'

function cand(id: string, distance: number, over: Partial<ECStationCandidate> = {}): ECStationCandidate {
  return {
    climateId: id,
    stnId: id,
    name: `Station ${id}`,
    province: 'QC',
    lat: 45.5,
    lng: -73.6,
    distance,
    hasHourly: true,
    elevation: 50,
    firstYear: 1998,
    lastYear: 2024,
    ...over,
  }
}

describe('orderEcccAttempts — choix manuel vs auto (PUR)', () => {
  const candidates = [cand('A', 1), cand('B', 5), cand('C', 12)] // triés par distance

  it('auto → top-3 par distance', () => {
    const { attempts, manual } = orderEcccAttempts(candidates)
    expect(manual).toBe(false)
    expect(attempts.map((c) => c.climateId)).toEqual(['A', 'B', 'C'])
  })

  it('choix manuel respecté — PAS écrasé par la plus proche', () => {
    const { attempts, manual, chosen } = orderEcccAttempts(candidates, 'C')
    expect(manual).toBe(true)
    expect(attempts.map((c) => c.climateId)).toEqual(['C']) // ni A ni B
    expect(chosen?.climateId).toBe('C')
  })

  it('choix manuel introuvable → aucune tentative (l’appelant lèvera)', () => {
    const { attempts, manual, chosen } = orderEcccAttempts(candidates, 'ZZZ')
    expect(manual).toBe(true)
    expect(attempts).toEqual([])
    expect(chosen).toBeNull()
  })
})

describe('formatStationTrace — traçabilité exports', () => {
  it('assemble nom · id · distance · altitude', () => {
    expect(
      formatStationTrace({ name: 'Dorval', lat: 0, lng: 0, distanceKm: 3.2, climateId: '702S006', elevation: 36 }),
    ).toBe('Dorval · id 702S006 · 3.2 km · 36 m')
  })

  it('omet les champs manquants', () => {
    expect(
      formatStationTrace({ name: 'X', lat: 0, lng: 0, distanceKm: 1.0, elevation: null }),
    ).toBe('X · 1.0 km')
  })
})

// ── fetchECCC avec fetch mocké : comportement réglementaire (repli / manuel) ──

const A = { id: 'A', lat: 45.5, lng: -73.6 } // ~0 km (la plus proche)
const B = { id: 'B', lat: 45.6, lng: -73.7 } // plus loin

function stationFeature(s: { id: string; lat: number; lng: number }) {
  return {
    geometry: { coordinates: [s.lng, s.lat] },
    properties: {
      CLIMATE_IDENTIFIER: s.id,
      STN_ID: s.id,
      STATION_NAME: `Station ${s.id}`,
      PROV_STATE_TERR_CODE: 'QC',
      HAS_HOURLY_DATA: 'Y',
      ELEVATION: 50,
      HLY_FIRST_DATE: '1998-01-01',
      HLY_LAST_DATE: '2024-12-31',
    },
  }
}

const validHourly = [
  {
    properties: {
      LOCAL_DATE: '2026-01-01 00:00:00',
      TEMP: -5,
      REL_HUM: 80,
      PRECIP_AMOUNT: 0,
      WIND_SPEED: 10,
      WIND_DIRECTION: 12,
    },
  },
]

let hourlyData: Record<string, unknown[]>
let hourlyCalls: string[]

function jsonRes(obj: unknown) {
  return { ok: true, status: 200, json: async () => obj, text: async () => '' } as Response
}

beforeEach(() => {
  hourlyCalls = []
  hourlyData = {}
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input)
    if (url.includes('climate-stations')) {
      // renvoyé non trié : le code doit trier par distance
      return jsonRes({ features: [stationFeature(B), stationFeature(A)] })
    }
    // climate-hourly
    hourlyCalls.push(url)
    const id = /CLIMATE_IDENTIFIER=([^&]+)/.exec(url)?.[1] ?? ''
    return jsonRes({ features: hourlyData[id] ?? [] })
  }) as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('fetchECCC — repli auto vs choix manuel', () => {
  const D = '2026-01-01'

  it('auto : repli sur la station suivante quand la plus proche est vide', async () => {
    hourlyData = { A: [], B: validHourly } // A vide → doit basculer sur B
    const res = await fetchECCC(45.5, -73.6, D, D)
    expect(res.station.climateId).toBe('B')
    // a bien essayé A puis B (repli)
    expect(hourlyCalls.some((u) => u.includes('CLIMATE_IDENTIFIER=A'))).toBe(true)
    expect(hourlyCalls.some((u) => u.includes('CLIMATE_IDENTIFIER=B'))).toBe(true)
  })

  it('manuel : station choisie sans données → message explicite, AUCUN repli', async () => {
    hourlyData = { A: validHourly, B: [] } // B choisie mais vide ; A a des données
    await expect(fetchECCC(45.5, -73.6, D, D, 'B')).rejects.toThrow(/aucune donnée sur la période/i)
    // n'a essayé QUE B (pas de bascule silencieuse vers A)
    expect(hourlyCalls.every((u) => u.includes('CLIMATE_IDENTIFIER=B'))).toBe(true)
    expect(hourlyCalls.some((u) => u.includes('CLIMATE_IDENTIFIER=A'))).toBe(false)
  })

  it('manuel : station choisie (B, pas la plus proche) respectée + candidats exposés', async () => {
    hourlyData = { A: validHourly, B: validHourly }
    const res = await fetchECCC(45.5, -73.6, D, D, 'B')
    expect(res.station.climateId).toBe('B') // et non A (la plus proche)
    expect(res.station.elevation).toBe(50)
    expect(res.candidates?.map((c) => c.climateId)).toEqual(['A', 'B'])
  })
})
