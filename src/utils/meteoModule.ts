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
  /** « Asphalte à proximité » (§3.6) — active le critère de chaussée sèche. */
  asphalt: boolean
  /**
   * Choix MANUEL de station ECCC par point (id du point → CLIMATE_IDENTIFIER).
   * Absent = auto (station la plus proche exploitable). Ce choix influence le
   * verdict §3.6 → il est persisté avec le projet (cf. serializeMeteoModule).
   */
  eccStationByPoint: Record<string, string>
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
    asphalt: true,
    eccStationByPoint: {},
  }
}

/**
 * Forme persistée du module météo (dans ProjectData). On sauvegarde la config
 * REPRODUCTIBLE — points, plage, sources, asphalte, et surtout le choix de
 * station ECCC par point — mais PAS les `results` (données lourdes, re-fetchées
 * à la réouverture). Le choix de station devient ainsi défendable/reproductible.
 */
export interface PersistedMeteoModule {
  points: MeteoPoint[]
  startDate: string
  endDate: string
  selectedSources: SourceId[]
  asphalt: boolean
  eccStationByPoint: Record<string, string>
}

export function serializeMeteoModule(state: MeteoModuleState): PersistedMeteoModule {
  return {
    points: state.points,
    startDate: state.startDate,
    endDate: state.endDate,
    selectedSources: Array.from(state.selectedSources),
    asphalt: state.asphalt,
    eccStationByPoint: { ...state.eccStationByPoint },
  }
}

/** Reconstruit un MeteoModuleState depuis la forme persistée (results vidés). */
export function deserializeMeteoModule(p: PersistedMeteoModule): MeteoModuleState {
  const base = makeDefaultMeteoState()
  return {
    points: p.points?.length ? p.points : base.points,
    startDate: p.startDate ?? base.startDate,
    endDate: p.endDate ?? base.endDate,
    selectedSources: new Set<SourceId>(p.selectedSources ?? Array.from(base.selectedSources)),
    results: [],
    asphalt: p.asphalt ?? base.asphalt,
    eccStationByPoint: p.eccStationByPoint ?? {},
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
  const ev = evaluateRecevabilite(firstOk.rows, state.asphalt)
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
