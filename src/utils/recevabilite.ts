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
 * Périodes réglementaires : jour 07 h–19 h, soir 19 h–22 h, nuit 22 h–07 h —
 * bornes réutilisées depuis `REG_PERIODS`/`regPeriodOfHour` (source unique dans
 * acoustics.ts). La période est une ÉTIQUETTE : elle n'influe pas sur le niveau
 * de recevabilité (les critères vent/précip/chaussée sont indépendants de l'heure).
 */

import { regPeriodOfHour, type RegPeriod } from './acoustics'

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
  /** Période MELCCFP : jour 07 h–19 h, soir 19 h–22 h, nuit 22 h–07 h. */
  period: RegPeriod
  /** Niveau §3.6 : recevable / à signaler / non recevable. */
  level: RecevabiliteLevel
  /** Raccourci : `level === 'ok'`. Conservé pour les consommateurs existants. */
  recevable: boolean
  reasons: string[]
}

/**
 * Seuils de recevabilité §3.6 — SOURCE UNIQUE (doctrine REG_PERIODS). Aucun
 * littéral de seuil ailleurs dans le code. `precipMaxMm` est VOLONTAIREMENT
 * partagé entre la recevabilité (précip qui invalide) et l'état de chaussée
 * (précip qui mouille) : même fait physique, couplage explicite (cf. libellé UI).
 */
export interface RecevabiliteConfig {
  /** Vent max (km/h) : ≥ ce seuil ⇒ non recevable. */
  windMaxKmh: number
  /** Précip max (mm) : > ce seuil ⇒ non recevable ET chaussée non sèche. */
  precipMaxMm: number
  /** HR seuil chaussée sèche (%) : ≤ ce seuil (sans précip, gel) ⇒ sèche. */
  hrDryPct: number
}

export const DEFAUT_MELCCFP: RecevabiliteConfig = {
  windMaxKmh: 20,
  precipMaxMm: 0,
  hrDryPct: 90,
}

/** Libellés d'affichage par niveau. */
export const RECEVABILITE_LABEL: Record<RecevabiliteLevel, string> = {
  ok: 'recevable',
  warn: 'à signaler',
  bad: 'non recevable',
}

/** Période réglementaire (jour/soir/nuit) d'un instant — via la source unique. */
export function periodLabel(date: Date): RegPeriod {
  return regPeriodOfHour(date.getHours())
}

/** Filtre de période §2.2, ternaire (jour/soir/nuit) ou `all`. */
export function passesPeriodFilter(
  date: Date,
  filter: 'all' | RegPeriod,
): boolean {
  if (filter === 'all') return true
  return periodLabel(date) === filter
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
  config: RecevabiliteConfig = DEFAUT_MELCCFP,
): 'sèche' | 'non sèche' | null {
  if (precip == null || temp == null) return null
  if (precip > config.precipMaxMm) return 'non sèche' // STRICT (jamais >=)
  if (temp > 0) return 'sèche'
  if (hr == null) return null
  return hr <= config.hrDryPct ? 'sèche' : 'non sèche'
}

/**
 * Calcule la recevabilité §3.6 heure par heure.
 * @param rows    lignes horaires (n'ont pas besoin d'être triées)
 * @param asphalt « asphalte à proximité » — active le critère de chaussée sèche
 */
export function evaluateRecevabilite(
  rows: MeteoHourRow[],
  asphalt = true,
  config: RecevabiliteConfig = DEFAUT_MELCCFP,
): RecevabiliteHour[] {
  const parsed = rows.map((r) => ({
    ...r,
    date: parseHourTimestamp(r.datetime),
  }))
  parsed.sort((a, b) => a.date.getTime() - b.date.getTime())

  return parsed.map((row) => {
    const period: RegPeriod = regPeriodOfHour(row.date.getHours())
    const reasons: string[] = []
    let level: RecevabiliteLevel = 'ok'

    if (row.windSpeed != null && row.windSpeed >= config.windMaxKmh) {
      reasons.push(`vent ${row.windSpeed.toFixed(1)} km/h ≥ ${config.windMaxKmh}`)
      level = 'bad'
    }
    if (row.precipitation != null && row.precipitation > config.precipMaxMm) {
      reasons.push(`précip. ${row.precipitation.toFixed(1)} mm > ${config.precipMaxMm}`)
      level = 'bad'
    }
    if (level === 'ok' && asphalt) {
      const cs = chausseeSeche(row.temperature, row.humidity, row.precipitation, config)
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
  soirTotal: number
  soirRecevable: number
  nuitTotal: number
  nuitRecevable: number
}

export function computeStats(hours: RecevabiliteHour[]): RecevabiliteStats {
  let recevables = 0
  let warn = 0
  let bad = 0
  let jourTotal = 0
  let jourRecevable = 0
  let soirTotal = 0
  let soirRecevable = 0
  let nuitTotal = 0
  let nuitRecevable = 0
  for (const h of hours) {
    if (h.level === 'ok') recevables++
    else if (h.level === 'warn') warn++
    else bad++
    if (h.period === 'jour') {
      jourTotal++
      if (h.recevable) jourRecevable++
    } else if (h.period === 'soir') {
      soirTotal++
      if (h.recevable) soirRecevable++
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
    soirTotal,
    soirRecevable,
    nuitTotal,
    nuitRecevable,
  }
}
