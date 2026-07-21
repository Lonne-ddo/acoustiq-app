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
  elevation?: number | null
}

/**
 * Station ECCC candidate exposée à l'UI pour la sélection manuelle. Toutes les
 * métadonnées proviennent de la MÊME réponse `climate-stations` (aucune requête
 * supplémentaire) — permet à l'ingénieur de juger la représentativité.
 */
export interface ECStationCandidate {
  climateId: string | null
  stnId: number | string | null
  name: string
  province: string | null
  lat: number
  lng: number
  distance: number
  hasHourly: boolean
  elevation: number | null
  /** Première / dernière année de données horaires (si disponible). */
  firstYear: number | null
  lastYear: number | null
}

export interface SourceResult {
  source: SourceId
  rows: MeteoHourRow[]
  station: StationInfo
  sourceUrl: string
  sourceLabel: string
  isArchive: boolean
  timezone: string
  /**
   * ECCC uniquement : stations candidates classées par distance (top 8), pour
   * le sélecteur manuel. Absent pour les autres sources.
   */
  candidates?: ECStationCandidate[]
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

/** Nombre de candidats ECCC exposés au sélecteur manuel. */
export const ECCC_CANDIDATE_LIMIT = 8

/** Extrait l'année (4 chiffres) d'une date ISO/texte ; null si absente. */
function yearOf(s: unknown): number | null {
  const m = String(s ?? '').match(/(\d{4})/)
  return m ? Number(m[1]) : null
}

/**
 * Ligne de traçabilité station (exports XLSX/CSV, rapport) : nom, id climato,
 * distance, altitude. Une donnée de recevabilité doit toujours nommer sa station.
 */
export function formatStationTrace(st: StationInfo): string {
  return [
    st.name,
    st.climateId ? `id ${st.climateId}` : null,
    Number.isFinite(st.distanceKm) ? `${st.distanceKm.toFixed(1)} km` : null,
    st.elevation != null ? `${st.elevation} m` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * Décide l'ordre d'essai des stations (PURE, testable). Choix manuel :
 * uniquement la station choisie (jamais écrasée par la plus proche) ; si elle
 * n'est pas dans les candidats → aucune tentative (l'appelant lève une erreur
 * explicite, pas de repli silencieux). Auto : top-3 par distance.
 */
export function orderEcccAttempts(
  candidates: ECStationCandidate[],
  chosenClimateId?: string | null,
): { attempts: ECStationCandidate[]; manual: boolean; chosen: ECStationCandidate | null } {
  if (chosenClimateId) {
    const chosen = candidates.find((c) => c.climateId === chosenClimateId) ?? null
    return { attempts: chosen ? [chosen] : [], manual: true, chosen }
  }
  return { attempts: candidates.slice(0, 3), manual: false, chosen: null }
}

/** Étape 1 : liste des stations candidates classées par distance (réutilisée). */
export async function fetchECCCStations(
  lat: number,
  lng: number,
): Promise<ECStationCandidate[]> {
  const radiusDeg = 0.6
  const bbox = [lng - radiusDeg, lat - radiusDeg, lng + radiusDeg, lat + radiusDeg].join(',')
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
        elevation: num(p.ELEVATION),
        // Période de données horaires (champs variables selon la collection).
        firstYear: yearOf(p.HLY_FIRST_DATE ?? p.FIRST_DATE ?? p.DLY_FIRST_DATE),
        lastYear: yearOf(p.HLY_LAST_DATE ?? p.LAST_DATE ?? p.DLY_LAST_DATE),
      } satisfies ECStationCandidate
    })
    .filter((s: ECStationCandidate) => s.hasHourly && s.climateId)
    .sort((a: ECStationCandidate, b: ECStationCandidate) => a.distance - b.distance)

  if (candidates.length === 0) {
    throw new Error('Aucune station EC avec données horaires à proximité.')
  }
  return candidates
}

/** Étape 2 : données horaires d'UNE station (pas de repli — lève si vide). */
export async function fetchECCCHourly(
  stn: ECStationCandidate,
  startDate: string,
  endDate: string,
  candidates: ECStationCandidate[],
): Promise<SourceResult> {
  if (!stn.climateId) throw new Error(`${stn.name} : identifiant climatologique manquant.`)
  const startIso = startDate + 'T00:00:00Z'
  const endIso = endDate + 'T23:59:59Z'
  const hourlyUrl =
    `https://api.weather.gc.ca/collections/climate-hourly/items` +
    `?CLIMATE_IDENTIFIER=${encodeURIComponent(stn.climateId)}` +
    `&datetime=${startIso}/${endIso}&limit=10000&sortby=LOCAL_DATE&f=json`

  const rr = await fetch(hourlyUrl)
  if (!rr.ok) throw new Error(`${stn.name} : HTTP ${rr.status}`)
  const j = await rr.json()
  if (!j?.features?.length) throw new Error(`${stn.name} : aucune observation`)

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
  if (rows.length === 0) throw new Error(`${stn.name} : aucune ligne valide`)

  return {
    source: 'eccc',
    rows,
    station: {
      name: stn.name + (stn.province ? ` (${stn.province})` : ''),
      climateId: stn.climateId,
      lat: stn.lat,
      lng: stn.lng,
      distanceKm: stn.distance,
      elevation: stn.elevation,
    },
    sourceUrl: hourlyUrl,
    sourceLabel: `Env. Canada · ${stn.name} (id ${stn.climateId})`,
    isArchive: true,
    timezone: 'local (LST)',
    candidates: candidates.slice(0, ECCC_CANDIDATE_LIMIT),
  }
}

/**
 * ECCC : liste → station (choisie ou auto top-3) → horaire.
 * - `chosenClimateId` fourni : SEULE cette station est essayée. Si elle est
 *   introuvable ou sans données → erreur explicite, JAMAIS de repli silencieux.
 * - sinon (auto) : essaie le top-3 par distance jusqu'à en trouver une exploitable.
 */
export async function fetchECCC(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
  chosenClimateId?: string | null,
): Promise<SourceResult> {
  const candidates = await fetchECCCStations(lat, lng)
  const { attempts, manual, chosen } = orderEcccAttempts(candidates, chosenClimateId)

  if (manual && attempts.length === 0) {
    throw new Error(
      `Station choisie (id ${chosenClimateId}) introuvable parmi les candidats — choisissez-en une autre.`,
    )
  }

  let lastErr: string | null = null
  for (const stn of attempts) {
    try {
      return await fetchECCCHourly(stn, startDate, endDate, candidates)
    } catch (e) {
      lastErr = (e as Error).message
      // Choix manuel : on ne bascule PAS sur une autre station.
      if (manual) break
    }
  }

  if (manual) {
    throw new Error(
      `Station ${chosen?.name ?? chosenClimateId} : aucune donnée sur la période — choisissez-en une autre.`,
    )
  }
  throw new Error(`Aucune station EC exploitable. ${lastErr ? '(' + lastErr + ')' : ''}`)
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
  chosenClimateId?: string | null,
): string {
  const stn = source === 'eccc' && chosenClimateId ? `|${chosenClimateId}` : ''
  return `${source}|${lat.toFixed(4)}|${lng.toFixed(4)}|${startDate}|${endDate}${stn}`
}

export function fetchSource(
  source: SourceId,
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
  chosenClimateId?: string | null,
): Promise<SourceOutcome> {
  const key = cacheKey(source, lat, lng, startDate, endDate, chosenClimateId)
  const cached = cache.get(key)
  if (cached) return cached

  const fetcher = (): Promise<SourceResult> => {
    if (source === 'openmeteo') return fetchOpenMeteo(lat, lng, startDate, endDate)
    if (source === 'gem') return fetchGEM(lat, lng, startDate, endDate)
    return fetchECCC(lat, lng, startDate, endDate, chosenClimateId)
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
