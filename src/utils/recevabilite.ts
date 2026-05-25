/**
 * Recevabilité acoustique — Lignes directrices MELCCFP, §3.6.
 *
 * Modèle aligné sur le standalone « agrégateur météo » v0.6 :
 *   - Vent  : < 20 km/h, sinon relevé sonore NON RECEVABLE.
 *   - Précipitations : = 0 mm, sinon mesures à retirer (NON RECEVABLE).
 *   - Chaussée sèche : si « asphalte à proximité » est coché, une chaussée
 *     non sèche fait passer l'heure en « à signaler » (warn) ; sinon l'état
 *     de la chaussée n'affecte pas la recevabilité.
 *
 * Trois niveaux : 'ok' (recevable) · 'warn' (à signaler) · 'bad' (non recevable).
 * Périodes §2.2 : jour 07 h–19 h, nuit 19 h–07 h.
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

export type RecevabiliteLevel = 'ok' | 'warn' | 'bad'

export interface RecevabiliteHour extends MeteoHourRow {
  date: Date
  /** Période MELCCFP : jour 07 h–19 h, nuit 19 h–07 h. */
  period: 'jour' | 'nuit'
  /** Niveau §3.6 : recevable / à signaler / non recevable. */
  level: RecevabiliteLevel
  /** Raccourci : `level === 'ok'`. Conservé pour les consommateurs existants. */
  recevable: boolean
  reasons: string[]
}

/** §3.6 — seuil de vent unique (km/h). */
export const SEUIL_VENT_KMH = 20

/** Libellés d'affichage par niveau. */
export const RECEVABILITE_LABEL: Record<RecevabiliteLevel, string> = {
  ok: 'recevable',
  warn: 'à signaler',
  bad: 'non recevable',
}

export function isDayHour(date: Date): boolean {
  const h = date.getHours()
  return h >= 7 && h < 19
}

export function periodLabel(date: Date): 'jour' | 'nuit' {
  return isDayHour(date) ? 'jour' : 'nuit'
}

/**
 * Filtre de période §2.2. La nuit est le complément du jour, ce qui couvre
 * naturellement 19 h–23 h ET 00 h–07 h sans logique de passage à minuit.
 */
export function passesPeriodFilter(
  date: Date,
  filter: 'all' | 'jour' | 'nuit',
): boolean {
  if (filter === 'all') return true
  return filter === 'jour' ? isDayHour(date) : !isDayHour(date)
}

/** Parse un timestamp en respectant l'absence de fuseau (heure locale). */
export function parseHourTimestamp(s: string): Date {
  // Open-Meteo renvoie « 2026-04-15T14:00 » (heure locale, pas de Z).
  // Env. Canada renvoie « 2026-04-15 14:00:00 » (heure locale LST).
  // Le caractère [T ] accepte les deux séparateurs.
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
 * Heuristique « chaussée sèche » (§3.6). Retourne `null` si indéterminable.
 *   - précipitation > 0 → non sèche
 *   - T° > 0 °C (sans précip) → sèche
 *   - sinon (gel, sans précip) : dépend de l'humidité — sèche si HR ≤ 90 %.
 */
export function chausseeSeche(
  temp: number | null,
  hr: number | null,
  precip: number | null,
): 'sèche' | 'non sèche' | null {
  if (precip == null || temp == null) return null
  if (precip > 0) return 'non sèche'
  if (temp > 0) return 'sèche'
  if (hr == null) return null
  return hr <= 90 ? 'sèche' : 'non sèche'
}

/**
 * Calcule la recevabilité §3.6 heure par heure.
 * @param rows    lignes horaires (n'ont pas besoin d'être triées)
 * @param asphalt « asphalte à proximité » — active le critère de chaussée sèche
 */
export function evaluateRecevabilite(
  rows: MeteoHourRow[],
  asphalt = true,
): RecevabiliteHour[] {
  const parsed = rows.map((r) => ({
    ...r,
    date: parseHourTimestamp(r.datetime),
  }))
  parsed.sort((a, b) => a.date.getTime() - b.date.getTime())

  return parsed.map((row) => {
    const period: 'jour' | 'nuit' = isDayHour(row.date) ? 'jour' : 'nuit'
    const reasons: string[] = []
    let level: RecevabiliteLevel = 'ok'

    if (row.windSpeed != null && row.windSpeed >= SEUIL_VENT_KMH) {
      reasons.push(`vent ${row.windSpeed.toFixed(1)} km/h ≥ ${SEUIL_VENT_KMH}`)
      level = 'bad'
    }
    if (row.precipitation != null && row.precipitation > 0) {
      reasons.push(`précip. ${row.precipitation.toFixed(1)} mm > 0`)
      level = 'bad'
    }
    if (level === 'ok' && asphalt) {
      const cs = chausseeSeche(row.temperature, row.humidity, row.precipitation)
      if (cs === 'non sèche') {
        reasons.push('chaussée non sèche')
        level = 'warn'
      }
    }

    return {
      ...row,
      date: row.date,
      period,
      level,
      recevable: level === 'ok',
      reasons,
    }
  })
}

export interface RecevabiliteStats {
  total: number
  /** Heures `level === 'ok'`. */
  recevables: number
  warn: number
  bad: number
  /** Pourcentage de recevables (ok) sur le total. */
  pourcentage: number
  jourTotal: number
  jourRecevable: number
  nuitTotal: number
  nuitRecevable: number
}

export function computeStats(hours: RecevabiliteHour[]): RecevabiliteStats {
  let recevables = 0
  let warn = 0
  let bad = 0
  let jourTotal = 0
  let jourRecevable = 0
  let nuitTotal = 0
  let nuitRecevable = 0
  for (const h of hours) {
    if (h.level === 'ok') recevables++
    else if (h.level === 'warn') warn++
    else bad++
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
    warn,
    bad,
    pourcentage: total === 0 ? 0 : (recevables / total) * 100,
    jourTotal,
    jourRecevable,
    nuitTotal,
    nuitRecevable,
  }
}
