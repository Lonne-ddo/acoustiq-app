/**
 * Indices acoustiques du rapport — SOURCE UNIQUE, filtrée par catégorie/période.
 *
 * Le tableau TEXTE (ReportGenerator) et la figure PNG (reportFigures) doivent
 * afficher les MÊMES valeurs : ils consomment tous deux `computeReportIndices`
 * (le rapport calcule une fois, puis passe l'objet à la figure). Aucun calcul
 * sur données brutes ici — `filterDataByPeriods` est appliqué par fichier,
 * exactement comme IndicesPanel.
 */
import {
  laeqAvg,
  computeL10,
  computeL50,
  computeL90,
  computeLAFmax,
  computeLAFmin,
  filterDataByPeriods,
} from './acoustics'
import type { MeasurementFile, IndicesSnapshot, Period, Category } from '../types'

/** Les 6 indices d'un jeu de LAeq — brique de calcul commune (null si vide). */
export function computeIndexRow(laeqValues: number[]): IndicesSnapshot | null {
  if (laeqValues.length === 0) return null
  return {
    laeq: laeqAvg(laeqValues),
    l10: computeL10(laeqValues),
    l50: computeL50(laeqValues),
    l90: computeL90(laeqValues),
    lafmax: computeLAFmax(laeqValues),
    lafmin: computeLAFmin(laeqValues),
  }
}

/**
 * Indices FILTRÉS par point, pour un jour. Filtrage per-fichier via
 * `filterDataByPeriods(f.data, f.date, periods, categories)` — même patron
 * qu'IndicesPanel/ReportGenerator (4 arguments : aucune exclusion ad-hoc).
 */
export function computeReportIndices(
  files: MeasurementFile[],
  pointMap: Record<string, string>,
  selectedDate: string,
  points: string[],
  periods: Period[] | undefined,
  categories: Category[] | undefined,
): Record<string, IndicesSnapshot | null> {
  const out: Record<string, IndicesSnapshot | null> = {}
  for (const pt of points) {
    const values = files
      .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
      .flatMap((f) => filterDataByPeriods(f.data, f.date, periods, categories))
      .map((dp) => dp.laeq)
    out[pt] = computeIndexRow(values)
  }
  return out
}
