/**
 * Sous-ensemble de points appartenant à une période réglementaire (jour/soir/
 * nuit), WRAP-AWARE (la nuit 22h-07h franchit minuit). Fonction PURE, isolée,
 * pour être testée avant tout câblage UI.
 *
 * - Bornes : REG_PERIODS (source unique) — AUCUN littéral d'heure ici.
 *
 * POURQUOI PAS D'isoDate (divergence assumée avec filterDataByPeriods) —
 *   Une période réglementaire est un MOTIF HORAIRE RÉPÉTÉ (« toutes les nuits »),
 *   pas une plage datée. L'appartenance ne dépend donc que de l'heure du jour :
 *   `t` (minutes depuis minuit, normalisé mod 1440). Un fichier de 3 jours agrège
 *   naturellement ses 3 nuits. À l'inverse, filterDataByPeriods filtre des Period
 *   à ms ABSOLUES (un intervalle daté précis) et exige l'ancrage isoDate pour
 *   convertir `t` en ms. Les deux signatures divergent pour cette raison de fond.
 *
 * - `t` normalisé mod 1440 : un point à 01h00 (t=60) est retenu par la nuit qu'il
 *   vienne d'un fichier mono-jour ou du lendemain d'un fichier chevauchant minuit
 *   → « continuité » correcte des deux côtés de 00h00. `coveredMin` compte des
 *   minutes-de-jour distinctes ⇒ plafonné à `periodMin` (jamais « 18 h / 9 h »).
 * - COMPOSITION avec « À exclure » : ce filtre s'applique EN PLUS des exclusions
 *   de catégorie, jamais à leur place. On l'applique APRÈS filterDataByPeriods :
 *       const cat = filterDataByPeriods(f.data, f.date, periods, categories, opts)
 *       const { data } = dataInRegPeriod(cat, 'nuit')   // le point exclu est déjà
 *                                                        // retiré → absent de TOUTE période
 * - Couverture : nombre de minutes distinctes couvertes + durée de la période
 *   (comme leqOnRegPeriod) → un indice sur 9 h de nuit sur 9 h attendues n'a pas
 *   le même statut qu'un calculé sur 2 h.
 */
import { REG_PERIODS, type RegPeriod } from './acoustics'

export interface RegPeriodSubset<T> {
  /** Points de `data` appartenant à la période (déjà filtrés par catégorie en amont). */
  data: T[]
  /** Minutes distinctes (mod 1440) couvertes par la mesure dans la période. */
  coveredMin: number
  /** Durée de la période en minutes : jour 720 / soir 180 / nuit 540. */
  periodMin: number
}

const norm = (t: number): number => (((t % 1440) + 1440) % 1440)

export function dataInRegPeriod<T extends { t: number }>(
  data: T[],
  period: RegPeriod,
): RegPeriodSubset<T> {
  const { startH, endH } = REG_PERIODS[period]
  const sMin = startH * 60
  const eMin = endH * 60
  // Durée modulo 24 h ; 0 ⇒ journée pleine 1440 (comme leqOnRegPeriod).
  const periodMin = (((eMin - sMin) % 1440) + 1440) % 1440 || 1440
  // Début inclusif, fin exclusive ; wrap si eMin < sMin (nuit).
  const inRange = (t: number): boolean =>
    eMin > sMin ? t >= sMin && t < eMin : t >= sMin || t < eMin

  const out: T[] = []
  const minutes = new Set<number>()
  for (const d of data) {
    const t = norm(d.t)
    if (!inRange(t)) continue
    out.push(d)
    minutes.add(Math.floor(t))
  }
  return { data: out, coveredMin: minutes.size, periodMin }
}
