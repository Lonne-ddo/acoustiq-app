/**
 * Types et helpers du module Météo, isolés de la page React pour permettre
 * un import statique léger depuis App.tsx (sans tirer maplibre/xlsx).
 */

import { makeMeteoPoint, type MeteoPoint } from '../components/meteo/PointsList'
import {
  isError,
  type SourceId,
  type SourceOutcome,
  type SourceResult,
} from './meteoSources'
import { evaluateRecevabilite, parseHourTimestamp } from './recevabilite'

export interface PointMeteoResults {
  pointId: string
  outcomes: SourceOutcome[]
}

export interface MeteoModuleState {
  points: MeteoPoint[]
  startDate: string
  endDate: string
  selectedSources: Set<SourceId>
  results: PointMeteoResults[]
}

export interface ProjectPointHint {
  /** Nom interne du point (BV-xx). */
  id: string
  /** Étiquette affichée. */
  label: string
  /** Coordonnées si connues (depuis Scene3D). */
  lat?: number
  lng?: number
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function makeDefaultMeteoState(): MeteoModuleState {
  const today = new Date()
  const end = isoDate(today)
  const startD = new Date(today)
  startD.setDate(startD.getDate() - 6)
  return {
    points: [makeMeteoPoint('Point 1')],
    startDate: isoDate(startD),
    endDate: end,
    selectedSources: new Set<SourceId>(['openmeteo', 'gem', 'eccc']),
    results: [],
  }
}

/**
 * Heures de recevabilité du premier point / première source non-erreur,
 * filtrées sur `selectedDate` (YYYY-MM-DD).
 */
export function recevabiliteForDate(
  state: MeteoModuleState,
  selectedDate: string,
): { startMin: number; endMin: number; recevable: boolean }[] {
  if (state.results.length === 0) return []
  const first = state.results[0]
  if (!first) return []
  const firstOk = first.outcomes.find((o): o is SourceResult => !isError(o))
  if (!firstOk) return []
  const ev = evaluateRecevabilite(firstOk.rows)
  const out: { startMin: number; endMin: number; recevable: boolean }[] = []
  for (const h of ev) {
    const d = h.date instanceof Date ? h.date : parseHourTimestamp(h.datetime)
    const dateStr = isoDate(d)
    if (dateStr !== selectedDate) continue
    const startMin = d.getHours() * 60 + d.getMinutes()
    out.push({
      startMin,
      endMin: Math.min(startMin + 60, 1440),
      recevable: h.recevable,
    })
  }
  return out
}
