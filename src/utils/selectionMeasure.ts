/**
 * Mesure interactive shift+glisser : LAeq/L90 sur une plage [tA,tB] (minutes),
 * en DEUX jeux — brut (inspection) et filtré (exclusions de catégorie). Le
 * filtrage réutilise la brique partagée `filterDataByPeriods` (même patron que
 * computeReportIndices / buildIndicesSnapshot), pas un troisième chemin.
 */
import { laeqAvg, computeL90, filterDataByPeriods } from './acoustics'
import type { MeasurementFile, Period, Category } from '../types'

export interface RangeMeasure {
  laeq: number | null
  l90: number | null
}

export interface SelectionMeasures {
  /** Tous les points de la plage (comportement d'inspection, inchangé). */
  raw: RangeMeasure
  /** Points survivant à filterDataByPeriods (mêmes exclusions qu'IndicesPanel). */
  filtered: RangeMeasure
  /** Nb de points bruts retirés par le filtre dans la plage (0 = pas de chevauchement). */
  excludedCount: number
}

function measure(vals: number[]): RangeMeasure {
  return {
    laeq: vals.length > 0 ? laeqAvg(vals) : null,
    l90: vals.length > 0 ? computeL90(vals) : null,
  }
}

export function measureSelectionRange(
  files: Iterable<MeasurementFile>,
  tA: number,
  tB: number,
  periods: Period[] | undefined,
  categories: Category[] | undefined,
): SelectionMeasures {
  const rawLaeq: number[] = []
  const filteredLaeq: number[] = []
  for (const f of files) {
    for (const dp of f.data) {
      if (dp.t >= tA && dp.t <= tB) rawLaeq.push(dp.laeq)
    }
    for (const dp of filterDataByPeriods(f.data, f.date, periods, categories)) {
      if (dp.t >= tA && dp.t <= tB) filteredLaeq.push(dp.laeq)
    }
  }
  return {
    raw: measure(rawLaeq),
    filtered: measure(filteredLaeq),
    excludedCount: rawLaeq.length - filteredLaeq.length,
  }
}
