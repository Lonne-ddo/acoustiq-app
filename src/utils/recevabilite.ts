/**
 * Recevabilité acoustique — critères québécois (REAFIE / MELCC).
 *
 * Une heure est dite "recevable" pour les mesures acoustiques en bordure
 * de chaussée si :
 *   - chaussée sèche : pas de précipitation détectable dans les 4 h
 *     précédentes ET T° > 2 °C ET HR < 95 %
 *   - vent acceptable : < 18 km/h le jour (07 h–19 h),
 *                       < 10.8 km/h la nuit (19 h–07 h)
 *
 * Les seuils en m/s correspondants : 5 m/s jour, 3 m/s nuit, à 10 m de hauteur.
 */

export interface MeteoHourRow {
  /** ISO-8601 ou « YYYY-MM-DD HH:MM[:SS] » dans le fuseau local. */
  datetime: string
  temperature: number | null
  humidity: number | null
  /** Précipitation horaire en mm. */
  precipitation: number | null
  /** Vitesse vent à 10 m, km/h. */
  windSpeed: number | null
  windDirection: number | null
  weatherCode?: number | null
  weatherText?: string | null
}

export interface RecevabiliteHour extends MeteoHourRow {
  date: Date
  /** Période MELCC : jour 07 h–19 h, nuit 19 h–07 h. */
  period: 'jour' | 'nuit'
  recevable: boolean
  reasons: string[]
}

export const SEUIL_VENT_JOUR_KMH = 18 // 5 m/s
export const SEUIL_VENT_NUIT_KMH = 10.8 // 3 m/s
export const SEUIL_TEMPERATURE_C = 2
export const SEUIL_HUMIDITE_PCT = 95
export const FENETRE_PRECIP_HEURES = 4

export function isDayHour(date: Date): boolean {
  const h = date.getHours()
  return h >= 7 && h < 19
}

export function periodLabel(date: Date): 'jour' | 'nuit' {
  return isDayHour(date) ? 'jour' : 'nuit'
}

/** Parse un timestamp en respectant l'absence de fuseau (heure locale). */
export function parseHourTimestamp(s: string): Date {
  // Open-Meteo renvoie « 2026-04-15T14:00 » (heure locale, pas de Z).
  // Env. Canada renvoie « 2026-04-15 14:00:00 » (heure locale LST).
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (m) {
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      0,
      0,
    )
  }
  return new Date(s)
}

/**
 * Calcule la recevabilité heure par heure.
 * `rows` doit être trié chronologiquement.
 */
export function evaluateRecevabilite(rows: MeteoHourRow[]): RecevabiliteHour[] {
  const parsed = rows.map((r) => ({
    ...r,
    date: parseHourTimestamp(r.datetime),
  }))
  parsed.sort((a, b) => a.date.getTime() - b.date.getTime())

  return parsed.map((row, idx) => {
    const period: 'jour' | 'nuit' = isDayHour(row.date) ? 'jour' : 'nuit'
    const reasons: string[] = []

    // Précip détectable dans les FENETRE_PRECIP_HEURES précédentes (incluant l'heure courante).
    let precipDetectee = false
    let precipManquante = false
    let lookback = 0
    for (let i = idx; i >= 0 && lookback < FENETRE_PRECIP_HEURES; i--) {
      const ageHours =
        (row.date.getTime() - parsed[i].date.getTime()) / 3600_000
      if (ageHours > FENETRE_PRECIP_HEURES - 0.5) break
      lookback++
      const p = parsed[i].precipitation
      if (p == null) precipManquante = true
      else if (p > 0) {
        precipDetectee = true
        break
      }
    }

    if (precipDetectee) {
      reasons.push('précipitation dans les 4 h précédentes')
    } else if (
      precipManquante &&
      lookback < FENETRE_PRECIP_HEURES &&
      row.precipitation == null
    ) {
      reasons.push('précipitation inconnue')
    }

    if (row.temperature == null) {
      reasons.push('température inconnue')
    } else if (row.temperature <= SEUIL_TEMPERATURE_C) {
      reasons.push(`T° ${row.temperature.toFixed(1)} °C ≤ ${SEUIL_TEMPERATURE_C}`)
    }

    if (row.humidity != null && row.humidity >= SEUIL_HUMIDITE_PCT) {
      reasons.push(`HR ${row.humidity.toFixed(0)} % ≥ ${SEUIL_HUMIDITE_PCT}`)
    }

    const seuilVent =
      period === 'jour' ? SEUIL_VENT_JOUR_KMH : SEUIL_VENT_NUIT_KMH
    if (row.windSpeed == null) {
      reasons.push('vent inconnu')
    } else if (row.windSpeed >= seuilVent) {
      reasons.push(
        `vent ${row.windSpeed.toFixed(1)} km/h ≥ ${seuilVent} (${period})`,
      )
    }

    return {
      ...row,
      date: row.date,
      period,
      recevable: reasons.length === 0,
      reasons,
    }
  })
}

export interface RecevabiliteStats {
  total: number
  recevables: number
  pourcentage: number
  jourTotal: number
  jourRecevable: number
  nuitTotal: number
  nuitRecevable: number
}

export function computeStats(hours: RecevabiliteHour[]): RecevabiliteStats {
  let recevables = 0
  let jourTotal = 0
  let jourRecevable = 0
  let nuitTotal = 0
  let nuitRecevable = 0
  for (const h of hours) {
    if (h.recevable) recevables++
    if (h.period === 'jour') {
      jourTotal++
      if (h.recevable) jourRecevable++
    } else {
      nuitTotal++
      if (h.recevable) nuitRecevable++
    }
  }
  const total = hours.length
  return {
    total,
    recevables,
    pourcentage: total === 0 ? 0 : (recevables / total) * 100,
    jourTotal,
    jourRecevable,
    nuitTotal,
    nuitRecevable,
  }
}
