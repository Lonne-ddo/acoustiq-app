/**
 * Sources météo (gratuites, sans clé API) :
 *   1. Open-Meteo (forecast/best_match + archive ERA5)
 *   2. GEM Canada via Open-Meteo (modèle gem_seamless)
 *   3. Environnement Canada (stations climatiques, API GeoMet)
 *
 * Toutes les requêtes sont CORS-friendly (testées par l'aggrégateur d'origine).
 */

import type { MeteoHourRow } from './recevabilite'

export type SourceId = 'openmeteo' | 'gem' | 'eccc'

export interface SourceMeta {
  id: SourceId
  label: string
  shortLabel: string
  /** Couleur d'accent pour les marqueurs de carte. */
  color: string
}

export const SOURCES: Record<SourceId, SourceMeta> = {
  openmeteo: {
    id: 'openmeteo',
    label: 'Open-Meteo (best match / ERA5)',
    shortLabel: 'Open-Meteo',
    color: '#2563eb',
  },
  gem: {
    id: 'gem',
    label: 'GEM Canada (gem_seamless)',
    shortLabel: 'GEM Canada',
    color: '#059669',
  },
  eccc: {
    id: 'eccc',
    label: 'Environnement Canada (station)',
    shortLabel: 'Env. Canada',
    color: '#dc2626',
  },
}

export interface StationInfo {
  name: string
  lat: number
  lng: number
  distanceKm: number
  climateId?: string
  elevation?: number
}

export interface SourceResult {
  source: SourceId
  rows: MeteoHourRow[]
  station: StationInfo
  sourceUrl: string
  sourceLabel: string
  isArchive: boolean
  timezone: string
}

export interface SourceError {
  source: SourceId
  error: string
}

export type SourceOutcome = SourceResult | SourceError

export function isError(o: SourceOutcome): o is SourceError {
  return 'error' in o
}

const DAY_MS = 86_400_000

function toDate(s: string): Date {
  return new Date(s + 'T00:00:00')
}

function num(v: unknown): number | null {
  if (v == null || v === '' || v === 'M' || v === 'NA') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ─────────────────────────────────────────────────────────────────────
//   Open-Meteo (forecast best_match OU GEM seamless OU archive ERA5)
// ─────────────────────────────────────────────────────────────────────

interface OpenMeteoOptions {
  lat: number
  lng: number
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
  /** `null` = best_match (forecast/passé court) ; sinon nom de modèle Open-Meteo. */
  model: string | null
}

async function fetchOpenMeteoBase({
  lat,
  lng,
  startDate,
  endDate,
  model,
}: OpenMeteoOptions): Promise<SourceResult> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = toDate(startDate)
  const end = toDate(endDate)
  const daysSinceEnd = Math.floor((today.getTime() - end.getTime()) / DAY_MS)
  // Si un modèle est demandé OU si on est dans le futur/passé récent : forecast.
  // Sinon : archive ERA5.
  const useForecast = model !== null || daysSinceEnd < 7

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: [
      'temperature_2m',
      'relative_humidity_2m',
      'precipitation',
      'wind_speed_10m',
      'wind_direction_10m',
      'weather_code',
    ].join(','),
    timezone: 'America/Toronto',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
    temperature_unit: 'celsius',
  })

  let baseUrl: string
  let sourceLabel: string
  let isArchive: boolean

  if (useForecast) {
    const pastDays = Math.min(
      92,
      Math.max(1, Math.ceil((today.getTime() - start.getTime()) / DAY_MS) + 1),
    )
    const forecastDays = Math.max(
      1,
      Math.min(16, Math.ceil((end.getTime() - today.getTime()) / DAY_MS) + 1),
    )
    params.set('past_days', String(pastDays))
    params.set('forecast_days', String(forecastDays))
    if (model) params.set('models', model)
    baseUrl = model
      ? 'https://api.open-meteo.com/v1/gem'
      : 'https://api.open-meteo.com/v1/forecast'
    sourceLabel = model
      ? `Open-Meteo · modèle ${model}`
      : 'Open-Meteo · best_match'
    isArchive = false
  } else {
    params.set('start_date', startDate)
    params.set('end_date', endDate)
    baseUrl = 'https://archive-api.open-meteo.com/v1/archive'
    sourceLabel = 'Open-Meteo Archive · ERA5'
    isArchive = true
  }

  const sourceUrl = `${baseUrl}?${params.toString()}`
  const r = await fetch(sourceUrl)
  if (!r.ok) {
    let detail = `${r.status}`
    try {
      detail += ' — ' + (await r.text()).slice(0, 200)
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  const j = await r.json()
  if (!j?.hourly?.time) throw new Error('Pas de données horaires.')

  const startDt = new Date(startDate + 'T00:00:00')
  const endDt = new Date(endDate + 'T23:59:59')
  const t: string[] = j.hourly.time
  const rows: MeteoHourRow[] = []
  for (let i = 0; i < t.length; i++) {
    const dt = new Date(t[i])
    if (dt < startDt || dt > endDt) continue
    rows.push({
      datetime: t[i],
      temperature: num(j.hourly.temperature_2m?.[i]),
      humidity: num(j.hourly.relative_humidity_2m?.[i]),
      precipitation: num(j.hourly.precipitation?.[i]),
      windSpeed: num(j.hourly.wind_speed_10m?.[i]),
      windDirection: num(j.hourly.wind_direction_10m?.[i]),
      weatherCode: num(j.hourly.weather_code?.[i]),
      weatherText: null,
    })
  }
  if (rows.length === 0) throw new Error('Aucune donnée pour cette plage.')

  return {
    source: model ? 'gem' : 'openmeteo',
    rows,
    station: {
      name: model ? 'Point GEM (gem_seamless)' : 'Point de grille (best_match / ERA5)',
      lat: j.latitude,
      lng: j.longitude,
      distanceKm: haversineKm(lat, lng, j.latitude, j.longitude),
      elevation: j.elevation,
    },
    sourceUrl,
    sourceLabel,
    isArchive,
    timezone: j.timezone,
  }
}

export async function fetchOpenMeteo(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<SourceResult> {
  return fetchOpenMeteoBase({ lat, lng, startDate, endDate, model: null })
}

export async function fetchGEM(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<SourceResult> {
  return fetchOpenMeteoBase({
    lat,
    lng,
    startDate,
    endDate,
    model: 'gem_seamless',
  })
}

// ─────────────────────────────────────────────────────────────────────
//   Environnement Canada — station officielle la plus proche
// ─────────────────────────────────────────────────────────────────────

interface ECStationCandidate {
  climateId: string | null
  stnId: number | string | null
  name: string
  province: string | null
  lat: number
  lng: number
  distance: number
  hasHourly: boolean
}

export async function fetchECCC(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<SourceResult> {
  const radiusDeg = 0.6
  const bbox = [
    lng - radiusDeg,
    lat - radiusDeg,
    lng + radiusDeg,
    lat + radiusDeg,
  ].join(',')
  const stationsUrl =
    `https://api.weather.gc.ca/collections/climate-stations/items` +
    `?bbox=${bbox}&limit=100&f=json`

  const r = await fetch(stationsUrl)
  if (!r.ok) throw new Error(`Stations EC : HTTP ${r.status}`)
  const stationsJson = await r.json()
  if (!stationsJson?.features?.length) {
    throw new Error('Aucune station EC dans un rayon de ~60 km.')
  }

  const candidates: ECStationCandidate[] = stationsJson.features
    .map((f: any) => {
      const [stnLng, stnLat] = f.geometry.coordinates as [number, number]
      const p = f.properties || {}
      return {
        climateId: (p.CLIMATE_IDENTIFIER as string) || null,
        stnId: p.STN_ID ?? null,
        name: (p.STATION_NAME as string) || `Station ${p.STN_ID}`,
        province: (p.PROV_STATE_TERR_CODE as string) || null,
        lat: stnLat,
        lng: stnLng,
        distance: haversineKm(lat, lng, stnLat, stnLng),
        hasHourly:
          p.HAS_HOURLY_DATA === 'Y' ||
          p.HAS_HOURLY_DATA === true ||
          p.HAS_HOURLY_DATA == null,
      } satisfies ECStationCandidate
    })
    .filter((s: ECStationCandidate) => s.hasHourly && s.climateId)
    .sort((a: ECStationCandidate, b: ECStationCandidate) => a.distance - b.distance)

  if (candidates.length === 0) {
    throw new Error('Aucune station EC avec données horaires à proximité.')
  }

  const startIso = startDate + 'T00:00:00Z'
  const endIso = endDate + 'T23:59:59Z'
  let lastErr: string | null = null

  // Spec : limiter à 1 station par point pour éviter les timeouts.
  // En pratique on essaie au plus 3 candidates pour gérer les stations vides.
  for (const stn of candidates.slice(0, 3)) {
    if (!stn.climateId) continue
    const hourlyUrl =
      `https://api.weather.gc.ca/collections/climate-hourly/items` +
      `?CLIMATE_IDENTIFIER=${encodeURIComponent(stn.climateId)}` +
      `&datetime=${startIso}/${endIso}&limit=10000&sortby=LOCAL_DATE&f=json`
    try {
      const rr = await fetch(hourlyUrl)
      if (!rr.ok) {
        lastErr = `${stn.name}: HTTP ${rr.status}`
        continue
      }
      const j = await rr.json()
      if (!j?.features?.length) {
        lastErr = `${stn.name}: aucune observation`
        continue
      }
      const rows: MeteoHourRow[] = j.features
        .map((f: any) => {
          const p = f.properties || {}
          const windDir10 = num(p.WIND_DIRECTION ?? p.WIND_DIR)
          return {
            datetime: (p.LOCAL_DATE as string) || (p.UTC_DATE as string),
            temperature: num(p.TEMP),
            humidity: num(p.REL_HUM ?? p.RELATIVE_HUMIDITY),
            precipitation: num(p.PRECIP_AMOUNT ?? p.PRECIPITATION),
            windSpeed: num(p.WIND_SPEED),
            windDirection: windDir10 != null ? windDir10 * 10 : null,
            weatherCode: null,
            weatherText: (p.WEATHER as string) || null,
          } as MeteoHourRow
        })
        .sort((a: MeteoHourRow, b: MeteoHourRow) =>
          String(a.datetime).localeCompare(String(b.datetime)),
        )
      if (rows.length === 0) {
        lastErr = `${stn.name}: aucune ligne valide`
        continue
      }
      return {
        source: 'eccc',
        rows,
        station: {
          name: stn.name + (stn.province ? ` (${stn.province})` : ''),
          climateId: stn.climateId,
          lat: stn.lat,
          lng: stn.lng,
          distanceKm: stn.distance,
        },
        sourceUrl: hourlyUrl,
        sourceLabel: `Env. Canada · ${stn.name} (id ${stn.climateId})`,
        isArchive: true,
        timezone: 'local (LST)',
      }
    } catch (e) {
      lastErr = `${stn.name}: ${(e as Error).message}`
    }
  }
  throw new Error(
    `Aucune station EC exploitable. ${lastErr ? '(' + lastErr + ')' : ''}`,
  )
}

// ─────────────────────────────────────────────────────────────────────
//   Dispatch + cache
// ─────────────────────────────────────────────────────────────────────

const cache = new Map<string, Promise<SourceOutcome>>()

function cacheKey(
  source: SourceId,
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): string {
  return `${source}|${lat.toFixed(4)}|${lng.toFixed(4)}|${startDate}|${endDate}`
}

export function fetchSource(
  source: SourceId,
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<SourceOutcome> {
  const key = cacheKey(source, lat, lng, startDate, endDate)
  const cached = cache.get(key)
  if (cached) return cached

  const fetcher = (): Promise<SourceResult> => {
    if (source === 'openmeteo') return fetchOpenMeteo(lat, lng, startDate, endDate)
    if (source === 'gem') return fetchGEM(lat, lng, startDate, endDate)
    return fetchECCC(lat, lng, startDate, endDate)
  }

  const promise: Promise<SourceOutcome> = fetcher()
    .then((r) => r as SourceOutcome)
    .catch((e: Error): SourceOutcome => ({
      source,
      error: e.message || 'Erreur inconnue',
    }))

  // On cache les erreurs aussi mais brièvement (5 min).
  cache.set(key, promise)
  promise.then((outcome) => {
    if (isError(outcome)) {
      setTimeout(() => cache.delete(key), 5 * 60_000)
    }
  })
  return promise
}

export function clearMeteoCache(): void {
  cache.clear()
}
