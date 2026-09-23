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
  /** Point de rosée (°C) fourni par la source ; à défaut, `calcDewpoint`. */
  dewpoint?: number | null
  /** Pression (hPa) — affichage/export uniquement, hors verdict. */
  pressureHpa?: number | null
}

/**
 * Point de rosée (°C) par la formule de Magnus (a = 17,625 ; b = 243,04 °C).
 * Repli quand la source ne fournit pas Td. null si T ou HR manquante, ou HR ≤ 0.
 */
export function calcDewpoint(t: number | null, rh: number | null): number | null {
  if (t == null || rh == null || rh <= 0) return null
  const a = 17.625
  const b = 243.04
  const gamma = Math.log(rh / 100) + (a * t) / (b + t)
  return (b * gamma) / (a - gamma)
}

/**
 * Niveaux §3.6. `indetermine` = donnée météo aberrante (capteur défaillant ?) :
 * un échec de DONNÉE, pas un verdict réglementaire — l'heure n'est déclarée
 * ni recevable ni non recevable.
 */
export type RecevabiliteLevel = 'ok' | 'warn' | 'bad' | 'indetermine'

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
  /**
   * Filtres de VALIDITÉ (anti-aberration) — ne sont pas des seuils §3.6 :
   * une valeur hors plage rend l'heure `indetermine`, prioritairement à tout
   * critère. Bornes STRICTES (−50 °C est valide, −50,1 °C ne l'est pas).
   */
  validiteTempMinC: number
  validiteTempMaxC: number
  /** Précipitation horaire au-delà de laquelle la donnée est jugée aberrante (mm/h). */
  validitePrecipMaxMm: number
  /**
   * Critère d'humidité ADDITIONNEL, exclusif, désactivé par défaut. Aucun des
   * deux n'est un seuil réglementaire : actif, il rend `isMelccfpDefault` faux
   * (badge « non MELCCFP ») et apparaît dans le rapport et les exports.
   *  - 'hr'    : HR > `hrMaxPct` ⇒ non recevable — paramètre d'ÉQUIPEMENT
   *              (tolérance du sonomètre ; le §3.6 2026 renvoie au fabricant).
   *              Défaut 90 %, valeur reprise de la Note 98-01.
   *  - 'rosee' : T − Td < `roseeEcartMinC` ⇒ non recevable — critère d'équipe.
   * Défaut 'aucun' : un projet sauvegardé sans ce champ se recharge SANS
   * critère (jamais d'activation rétroactive).
   */
  humiditeMode: 'aucun' | 'hr' | 'rosee'
  hrMaxPct: number
  roseeEcartMinC: number
}

export const DEFAUT_MELCCFP: RecevabiliteConfig = {
  windMaxKmh: 20,
  precipMaxMm: 0,
  hrDryPct: 90,
  // −50 / +50 °C : un hiver québécois (−30 °C) reste valide ; le −10 °C du
  // standalone l'aurait déclaré aberrant.
  validiteTempMinC: -50,
  validiteTempMaxC: 50,
  validitePrecipMaxMm: 100,
  humiditeMode: 'aucun',
  hrMaxPct: 90,
  roseeEcartMinC: 2,
}

/** Vrai si les filtres de validité sont ceux par défaut. */
export function filtresValiditeParDefaut(c: RecevabiliteConfig): boolean {
  return (
    c.validiteTempMinC === DEFAUT_MELCCFP.validiteTempMinC &&
    c.validiteTempMaxC === DEFAUT_MELCCFP.validiteTempMaxC &&
    c.validitePrecipMaxMm === DEFAUT_MELCCFP.validitePrecipMaxMm
  )
}

/** Vrai si la config est strictement les valeurs MELCCFP par défaut. */
export function isMelccfpDefault(c: RecevabiliteConfig): boolean {
  return (
    c.windMaxKmh === DEFAUT_MELCCFP.windMaxKmh &&
    c.precipMaxMm === DEFAUT_MELCCFP.precipMaxMm &&
    c.hrDryPct === DEFAUT_MELCCFP.hrDryPct &&
    c.humiditeMode === 'aucun'
  )
}

/** Libellé du critère d'humidité actif, ou null s'il n'y en a pas. */
export function critereHumiditeLabel(c: RecevabiliteConfig): string | null {
  if (c.humiditeMode === 'hr') return `HR > ${c.hrMaxPct} % (tolérance du sonomètre) ⇒ non recevable`
  if (c.humiditeMode === 'rosee') return `T − Td < ${c.roseeEcartMinC} °C (risque de condensation, critère d'équipe) ⇒ non recevable`
  return null
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
    (critereHumiditeLabel(c) ? ` · ${critereHumiditeLabel(c)}` : '') +
    (isMelccfpDefault(c) ? ' (MELCCFP)' : ' — SEUILS MODIFIÉS (non MELCCFP)') +
    ` · validité T ∈ [${c.validiteTempMinC} ; ${c.validiteTempMaxC}] °C, ` +
    `précip. ≤ ${c.validitePrecipMaxMm} mm` +
    (filtresValiditeParDefaut(c) ? '' : ' (FILTRES MODIFIÉS)')
  )
}

/** Libellés d'affichage par niveau. */
export const RECEVABILITE_LABEL: Record<RecevabiliteLevel, string> = {
  ok: 'recevable',
  warn: 'à signaler',
  bad: 'non recevable',
  indetermine: 'indéterminé',
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

/**
 * Effet d'une étape sur le verdict. `skip` = critère non évalué (sans effet) ;
 * `indetermine` = donnée aberrante, prioritaire sur tout le reste.
 */
export type StepCls = 'ok' | 'warn' | 'bad' | 'indetermine' | 'skip'

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

type CriteresHeure = Pick<MeteoHourRow, 'temperature' | 'humidity' | 'precipitation' | 'windSpeed'> &
  Pick<Partial<MeteoHourRow>, 'dewpoint'>

/** Niveau porté par une liste d'étapes : indetermine > bad > warn > ok ; `skip` est neutre. */
export function levelFromSteps(steps: VerdictStep[]): RecevabiliteLevel {
  if (steps.some((s) => s.cls === 'indetermine')) return 'indetermine'
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

  // Validité des données — PRIORITAIRE : une donnée aberrante rend l'heure
  // indéterminée, et aucun critère §3.6 n'est évalué sur elle.
  const t = row.temperature
  const p0 = row.precipitation
  const { validiteTempMinC: tMin, validiteTempMaxC: tMax, validitePrecipMaxMm: pAb } = config
  const tAberrante = t != null && (t < tMin || t > tMax)
  const pAberrante = p0 != null && p0 > pAb
  if (tAberrante || pAberrante) {
    if (tAberrante) {
      reasons.push(`T ${t.toFixed(1)} °C hors plage de validité [${tMin} ; ${tMax}] — donnée aberrante`)
      steps.push({ n: n++, label: `Validité : T ∈ [${tMin} ; ${tMax}] °C ?`, detail: `${t.toFixed(1)} °C hors plage physique`, result: 'DONNÉE ABERRANTE', cls: 'indetermine' })
    }
    if (pAberrante) {
      reasons.push(`précip. ${p0.toFixed(1)} mm > ${pAb} — donnée aberrante`)
      steps.push({ n: n++, label: `Validité : précip. ≤ ${pAb} mm ?`, detail: `${p0.toFixed(1)} mm > ${pAb}`, result: 'DONNÉE ABERRANTE', cls: 'indetermine' })
    }
    steps.push({ n: n++, label: 'Critères §3.6', detail: 'non évalués sur une donnée aberrante (capteur défaillant ?)', result: 'critères non évalués', cls: 'skip' })
    return { level: levelFromSteps(steps), reasons, steps, chaussee: null }
  }
  steps.push({ n: n++, label: 'Validité des données ?', detail: `T ∈ [${tMin} ; ${tMax}] °C et précip. ≤ ${pAb} mm (ou absentes)`, result: 'données valides', cls: 'ok' })

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

  // Critère d'humidité additionnel (non réglementaire, désactivé par défaut).
  if (config.humiditeMode === 'hr') {
    const hr = row.humidity
    const hLabel = `HR ≤ ${config.hrMaxPct} % (tolérance du sonomètre) ?`
    if (hr == null) {
      steps.push({ n: n++, label: hLabel, detail: 'HR manquante', result: 'critère non évalué', cls: 'skip' })
    } else if (hr > config.hrMaxPct) {
      reasons.push(`HR ${hr.toFixed(0)} % > ${config.hrMaxPct} (tolérance du sonomètre, non MELCCFP)`)
      steps.push({ n: n++, label: hLabel, detail: `${hr.toFixed(0)} % > ${config.hrMaxPct}`, result: 'NON RECEVABLE', cls: 'bad' })
    } else {
      steps.push({ n: n++, label: hLabel, detail: `${hr.toFixed(0)} % ≤ ${config.hrMaxPct}`, result: 'critère respecté', cls: 'ok' })
    }
  } else if (config.humiditeMode === 'rosee') {
    const t = row.temperature
    const mesure = row.dewpoint != null
    const td = mesure ? (row.dewpoint as number) : calcDewpoint(t, row.humidity)
    const rLabel = `T − Td ≥ ${config.roseeEcartMinC} °C (risque de rosée, critère d'équipe) ?`
    if (t == null || td == null) {
      steps.push({ n: n++, label: rLabel, detail: 'T ou Td manquante', result: 'critère non évalué', cls: 'skip' })
    } else {
      const ecart = t - td
      const src = mesure ? 'Td fourni par la source' : 'Td calculé (Magnus)'
      const detail = `T ${t.toFixed(1)} °C, Td ${td.toFixed(1)} °C (${src}), écart ${ecart.toFixed(1)} °C`
      if (ecart < config.roseeEcartMinC) {
        reasons.push(`T − Td = ${ecart.toFixed(1)} °C < ${config.roseeEcartMinC} (risque de condensation, non MELCCFP)`)
        steps.push({ n: n++, label: rLabel, detail, result: 'NON RECEVABLE', cls: 'bad' })
      } else {
        steps.push({ n: n++, label: rLabel, detail, result: 'critère respecté', cls: 'ok' })
      }
    }
  }

  return { level: levelFromSteps(steps), reasons, steps, chaussee }
}

/** Phrase de conclusion d'un verdict (panneau d'inspection, rapports). */
export function conclusionVerdict(v: Pick<Verdict, 'level' | 'reasons'>): string {
  switch (v.level) {
    case 'ok':
      return 'RECEVABLE — tous les critères évalués sont respectés'
    case 'warn':
      return 'À SIGNALER — chaussée non sèche (recevable §3.6, à mentionner au rapport)'
    case 'bad':
      return `NON RECEVABLE — ${v.reasons.join(' ; ')}`
    case 'indetermine':
      return `INDÉTERMINÉ — donnée aberrante (capteur défaillant ?) : ni recevable ni non recevable — ${v.reasons.join(' ; ')}`
  }
}

/** Clé horaire « YYYY-MM-DDTHH » d'un horodatage Open-Meteo ou ECCC (null si illisible). */
export function hourKeyOf(datetime: string): string | null {
  const m = String(datetime).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : null
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
  /** Heures à donnée aberrante — ni recevables ni non recevables. */
  indetermine: number
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
  let indetermine = 0
  let jourTotal = 0
  let jourRecevable = 0
  let soirTotal = 0
  let soirRecevable = 0
  let nuitTotal = 0
  let nuitRecevable = 0
  for (const h of hours) {
    if (h.level === 'ok') recevables++
    else if (h.level === 'warn') warn++
    else if (h.level === 'indetermine') indetermine++
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
    indetermine,
    pourcentage: total === 0 ? 0 : (recevables / total) * 100,
    jourTotal,
    jourRecevable,
    soirTotal,
    soirRecevable,
    nuitTotal,
    nuitRecevable,
  }
}
