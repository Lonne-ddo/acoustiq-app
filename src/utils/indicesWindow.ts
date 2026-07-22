/**
 * Fenêtrage temporel des indices selon le mode choisi dans IndicesPanel.
 *
 * - 'full' / 'custom' : comportement HISTORIQUE inchangé — filtre [startMin, endMin]
 *   (full = [-Infinity, +Infinity] ⇒ tous les points). Garantit la non-régression
 *   du mode « Pleine journée ».
 * - période réglementaire (jour/soir/nuit) : dataInRegPeriod (wrap-aware, source
 *   UNIQUE des bornes). Plus aucune logique de bornes de période ailleurs.
 *
 * S'applique aux données DÉJÀ filtrées par catégorie (filterDataByPeriods) →
 * composition : exclusions d'abord, fenêtre ensuite.
 */
import { dataInRegPeriod } from './regPeriod'
import type { RegPeriod } from './acoustics'
import type { DataPoint } from '../types'

export type IndicesMode = 'full' | 'custom' | RegPeriod

export const isRegPeriodMode = (m: IndicesMode): m is RegPeriod =>
  m === 'jour' || m === 'soir' || m === 'nuit'

export function windowData(
  cat: DataPoint[],
  mode: IndicesMode,
  startMin: number,
  endMin: number,
): DataPoint[] {
  if (isRegPeriodMode(mode)) return dataInRegPeriod(cat, mode).data
  return cat.filter((dp) => dp.t >= startMin && dp.t <= endMin)
}
