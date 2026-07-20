/**
 * Détection de désaccord inter-sources météo (formalise l'ancien surlignage
 * `spread > 5` de ComparisonTable). Signal PUREMENT INFORMATIF : il n'entre
 * JAMAIS dans le verdict de recevabilité §3.6 (fiabilité de la donnée ≠
 * recevabilité réglementaire).
 *
 * Doctrine « source unique » (comme REG_PERIODS) : seuils centralisés ici, un
 * seuil PROPRE par variable — leurs échelles n'ont rien à voir (°C, km/h, mm, %).
 */

export type DiscordVar = 'temperature' | 'windSpeed' | 'precipitation' | 'humidity'

/** Ordre canonique d'affichage / d'export. */
export const DISCORD_VARS: DiscordVar[] = [
  'temperature',
  'windSpeed',
  'precipitation',
  'humidity',
]

/**
 * SOURCE UNIQUE des seuils de désaccord, par variable. Un Δ (max − min entre
 * sources présentes) STRICTEMENT supérieur au seuil marque un désaccord.
 */
export const DISCORD_THRESHOLDS: Record<DiscordVar, number> = {
  temperature: 5, // °C
  windSpeed: 5, // km/h
  precipitation: 0.5, // mm — capte « une source dit sec, l'autre pluie »
  humidity: 15, // % — l'HR varie de 10-15 pts entre modèles sans vrai désaccord
}

/** Libellé + unité + décimales d'affichage, centralisés (pas de littéral dispersé). */
export const DISCORD_VAR_META: Record<
  DiscordVar,
  { label: string; unit: string; decimals: number }
> = {
  temperature: { label: 'T°', unit: '°C', decimals: 1 },
  windSpeed: { label: 'vent', unit: 'km/h', decimals: 1 },
  precipitation: { label: 'précip', unit: 'mm', decimals: 1 },
  humidity: { label: 'HR', unit: '%', decimals: 0 },
}

export interface DiscordResult {
  disagree: boolean
  /** Δ = max − min ; `null` si moins de 2 valeurs présentes. */
  amplitude: number | null
  min: number | null
  max: number | null
  /** Nombre de sources ayant une valeur exploitable pour cette variable/heure. */
  count: number
}

/**
 * Désaccord pour UNE variable à UNE heure. Une source absente (null/NaN) est
 * exclue ; il faut ≥ 2 valeurs présentes pour qu'un désaccord soit possible
 * (1 seule source présente ⇒ jamais de désaccord).
 */
export function evalDiscord(
  values: (number | null | undefined)[],
  threshold: number,
): DiscordResult {
  const present = values.filter(
    (v): v is number => v != null && Number.isFinite(v),
  )
  if (present.length < 2) {
    const solo = present.length === 1 ? present[0] : null
    return { disagree: false, amplitude: null, min: solo, max: solo, count: present.length }
  }
  const min = Math.min(...present)
  const max = Math.max(...present)
  const amplitude = max - min
  return { disagree: amplitude > threshold, amplitude, min, max, count: present.length }
}

export interface HourDiscord {
  byVar: Record<DiscordVar, DiscordResult>
  /** Variables en désaccord, ordre canonique (pour synthèse / export). */
  vars: DiscordVar[]
  anyDisagree: boolean
}

const EMPTY_RESULT: DiscordResult = {
  disagree: false,
  amplitude: null,
  min: null,
  max: null,
  count: 0,
}

/**
 * Désaccord pour UNE heure, toutes variables fournies. Les variables absentes
 * de `cells` reçoivent un résultat vide (jamais en désaccord).
 */
export function detectDiscord(
  cells: Partial<Record<DiscordVar, (number | null | undefined)[]>>,
): HourDiscord {
  const byVar = {} as Record<DiscordVar, DiscordResult>
  const vars: DiscordVar[] = []
  for (const v of DISCORD_VARS) {
    const values = cells[v]
    const res = values ? evalDiscord(values, DISCORD_THRESHOLDS[v]) : EMPTY_RESULT
    byVar[v] = res
    if (res.disagree) vars.push(v)
  }
  return { byVar, vars, anyDisagree: vars.length > 0 }
}

/**
 * Étiquette compacte des désaccords d'une heure — « vent Δ7.2; HR Δ18 » — pour
 * la synthèse UI et la colonne « Désaccord » des exports. `''` si concordant.
 */
export function formatDiscord(d: HourDiscord): string {
  return d.vars
    .map((v) => {
      const m = DISCORD_VAR_META[v]
      return `${m.label} Δ${d.byVar[v].amplitude!.toFixed(m.decimals)}`
    })
    .join('; ')
}
