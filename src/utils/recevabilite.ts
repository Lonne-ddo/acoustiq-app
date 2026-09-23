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
  /** Étapes ayant produit `level` (cf. `verdictHeure`). */
  steps: VerdictStep[]
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

/** Vrai si la config est strictement les valeurs MELCCFP par défaut. */
export function isMelccfpDefault(c: RecevabiliteConfig): boolean {
  return (
    c.windMaxKmh === DEFAUT_MELCCFP.windMaxKmh &&
    c.precipMaxMm === DEFAUT_MELCCFP.precipMaxMm &&
    c.hrDryPct === DEFAUT_MELCCFP.hrDryPct
  )
}

/**
 * Ligne « seuils utilisés » pour la traçabilité (exports + rapport). Rend le
 * couplage précip EXPLICITE (recevabilité ET chaussée) et signale « non MELCCFP »
 * si un seuil diffère du défaut — jamais d'effet caché sur une sortie réglementaire.
 */
export function seuilsUtilisesLine(c: RecevabiliteConfig): string {
  return (
    `Seuils utilisés — vent ≥ ${c.windMaxKmh} km/h · ` +
    `précip > ${c.precipMaxMm} mm (recevabilité ET chaussée) · ` +
    `HR chaussée ≤ ${c.hrDryPct} %` +
    (isMelccfpDefault(c) ? ' (MELCCFP)' : ' — SEUILS MODIFIÉS (non MELCCFP)')
  )
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

// ─────────────────────────────────────────────────────────────────────────
// Verdict §3.6 — UNE SEULE fonction de décision, explicable pas à pas.
//
// Le standalone « agrégateur météo » calculait le verdict (getRecevabilite)
// et son explication (recevabiliteSteps) dans DEUX fonctions parallèles, qui
// divergeaient : asphalte décoché, l'explication disait « À SIGNALER » et le
// verdict « recevable ». Ici, le niveau est DÉRIVÉ des étapes
// (`levelFromSteps`) : l'explication affichée est, par construction, celle
// qui a produit le verdict.
// ─────────────────────────────────────────────────────────────────────────

/** Effet d'une étape sur le verdict. `skip` = critère non évalué (sans effet). */
export type StepCls = 'ok' | 'warn' | 'bad' | 'skip'

/** Une étape de l'arbre de décision, telle qu'affichée à l'utilisateur. */
export interface VerdictStep {
  n: number
  /** Question posée (« Vent < 20 km/h ? »). */
  label: string
  /** Valeurs lues et comparaison effectuée. */
  detail: string
  /** Issue lisible (« critère respecté », « NON RECEVABLE »…). */
  result: string
  cls: StepCls
}

export type EtatChaussee = 'sèche' | 'non sèche' | null

export interface ChausseeDetail {
  state: EtatChaussee
  steps: VerdictStep[]
}

export interface Verdict {
  level: RecevabiliteLevel
  reasons: string[]
  steps: VerdictStep[]
  /** Détail de l'arbre « chaussée sèche », ou null s'il n'a pas été parcouru. */
  chaussee: ChausseeDetail | null
}

type CriteresHeure = Pick<MeteoHourRow, 'temperature' | 'humidity' | 'precipitation' | 'windSpeed'>

/** Niveau porté par une liste d'étapes : bad > warn > ok ; `skip` est neutre. */
export function levelFromSteps(steps: VerdictStep[]): RecevabiliteLevel {
  if (steps.some((s) => s.cls === 'bad')) return 'bad'
  if (steps.some((s) => s.cls === 'warn')) return 'warn'
  return 'ok'
}

/**
 * Arbre « chaussée sèche » (§3.6), étape par étape. `state` null = indéterminable.
 *   1. précipitation > seuil → non sèche
 *   2. T° > 0 °C (sans précip) → sèche
 *   3. sinon (gel, sans précip) : sèche si HR ≤ seuil
 */
export function chausseeSecheDetail(
  temp: number | null,
  hr: number | null,
  precip: number | null,
  config: RecevabiliteConfig = DEFAUT_MELCCFP,
): ChausseeDetail {
  const steps: VerdictStep[] = []
  if (precip == null || temp == null) {
    steps.push({ n: 1, label: 'Données suffisantes ?', detail: 'précipitation ou température manquante', result: 'indéterminé', cls: 'skip' })
    return { state: null, steps }
  }
  const pLabel = `Précip. > ${config.precipMaxMm} mm ?`
  if (precip > config.precipMaxMm) { // STRICT (jamais >=)
    steps.push({ n: 1, label: pLabel, detail: `${precip.toFixed(1)} mm > ${config.precipMaxMm}`, result: 'NON SÈCHE', cls: 'bad' })
    return { state: 'non sèche', steps }
  }
  steps.push({ n: 1, label: pLabel, detail: `${precip.toFixed(1)} mm ≤ ${config.precipMaxMm}`, result: 'non → étape 2', cls: 'ok' })
  if (temp > 0) {
    steps.push({ n: 2, label: 'T > 0 °C ?', detail: `${temp.toFixed(1)} °C > 0`, result: 'SÈCHE', cls: 'ok' })
    return { state: 'sèche', steps }
  }
  steps.push({ n: 2, label: 'T > 0 °C ?', detail: `${temp.toFixed(1)} °C ≤ 0`, result: 'non → étape 3', cls: 'ok' })
  const hLabel = `HR ≤ ${config.hrDryPct} % ?`
  if (hr == null) {
    steps.push({ n: 3, label: hLabel, detail: 'HR manquante', result: 'indéterminé', cls: 'skip' })
    return { state: null, steps }
  }
  if (hr <= config.hrDryPct) {
    steps.push({ n: 3, label: hLabel, detail: `${hr.toFixed(0)} % ≤ ${config.hrDryPct}`, result: 'SÈCHE', cls: 'ok' })
    return { state: 'sèche', steps }
  }
  steps.push({ n: 3, label: hLabel, detail: `${hr.toFixed(0)} % > ${config.hrDryPct} (risque givre/condensation)`, result: 'NON SÈCHE', cls: 'bad' })
  return { state: 'non sèche', steps }
}

/** État de chaussée seul (raccourci de `chausseeSecheDetail`). */
export function chausseeSeche(
  temp: number | null,
  hr: number | null,
  precip: number | null,
  config: RecevabiliteConfig = DEFAUT_MELCCFP,
): EtatChaussee {
  return chausseeSecheDetail(temp, hr, precip, config).state
}

/**
 * Verdict §3.6 d'UNE heure : niveau, motifs ET étapes, produits ensemble.
 * Le niveau est `levelFromSteps(steps)` — jamais calculé à part.
 *
 * @param asphalt « asphalte à proximité » — active le critère de chaussée sèche
 */
export function verdictHeure(
  row: CriteresHeure,
  asphalt = true,
  config: RecevabiliteConfig = DEFAUT_MELCCFP,
): Verdict {
  const steps: VerdictStep[] = []
  const reasons: string[] = []
  let n = 1

  const w = row.windSpeed
  const wLabel = `Vent < ${config.windMaxKmh} km/h ?`
  if (w == null) {
    steps.push({ n: n++, label: wLabel, detail: 'donnée manquante', result: 'critère non évalué', cls: 'skip' })
  } else if (w >= config.windMaxKmh) {
    reasons.push(`vent ${w.toFixed(1)} km/h ≥ ${config.windMaxKmh}`)
    steps.push({ n: n++, label: wLabel, detail: `${w.toFixed(1)} km/h ≥ ${config.windMaxKmh}`, result: 'NON RECEVABLE', cls: 'bad' })
  } else {
    steps.push({ n: n++, label: wLabel, detail: `${w.toFixed(1)} km/h < ${config.windMaxKmh}`, result: 'critère respecté', cls: 'ok' })
  }

  const p = row.precipitation
  const pLabel = `Précip. ≤ ${config.precipMaxMm} mm ?`
  if (p == null) {
    steps.push({ n: n++, label: pLabel, detail: 'donnée manquante', result: 'critère non évalué', cls: 'skip' })
  } else if (p > config.precipMaxMm) {
    reasons.push(`précip. ${p.toFixed(1)} mm > ${config.precipMaxMm}`)
    steps.push({ n: n++, label: pLabel, detail: `${p.toFixed(1)} mm > ${config.precipMaxMm}`, result: 'NON RECEVABLE', cls: 'bad' })
  } else {
    steps.push({ n: n++, label: pLabel, detail: `${p.toFixed(1)} mm ≤ ${config.precipMaxMm}`, result: 'critère respecté', cls: 'ok' })
  }

  // Chaussée : n'a d'effet que si l'asphalte est coché ET que rien n'a déjà
  // rendu l'heure non recevable. Dans les deux autres cas, l'étape le DIT.
  let chaussee: ChausseeDetail | null = null
  const cLabel = 'Chaussée sèche ?'
  if (!asphalt) {
    steps.push({ n: n++, label: cLabel, detail: 'pas d’asphalte à proximité', result: 'critère non applicable', cls: 'skip' })
  } else if (levelFromSteps(steps) === 'bad') {
    steps.push({ n: n++, label: cLabel, detail: 'non évaluée — heure déjà non recevable', result: 'critère non évalué', cls: 'skip' })
  } else {
    chaussee = chausseeSecheDetail(row.temperature, row.humidity, row.precipitation, config)
    if (chaussee.state === 'non sèche') {
      reasons.push('chaussée non sèche')
      steps.push({ n: n++, label: cLabel, detail: 'non sèche', result: 'À SIGNALER', cls: 'warn' })
    } else if (chaussee.state === 'sèche') {
      steps.push({ n: n++, label: cLabel, detail: 'sèche', result: 'critère respecté', cls: 'ok' })
    } else {
      steps.push({ n: n++, label: cLabel, detail: 'indéterminée', result: 'critère non évalué', cls: 'skip' })
    }
  }

  return { level: levelFromSteps(steps), reasons, steps, chaussee }
}

/**
 * Calcule la recevabilité §3.6 heure par heure (via `verdictHeure`).
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
    const v = verdictHeure(row, asphalt, config)
    return {
      ...row,
      date: row.date,
      period,
      level: v.level,
      recevable: v.level === 'ok',
      reasons: v.reasons,
      steps: v.steps,
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
