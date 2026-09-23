/**
 * Types et helpers du module Météo, isolés de la page React pour permettre
 * un import statique léger depuis App.tsx (sans tirer maplibre/xlsx).
 */

import { makeMeteoPoint, type MeteoPoint } from '../components/meteo/PointsList'
import {
  isError,
  formatStationTrace,
  lstVersHeureToronto,
  FUSEAU_ECCC_LST_HISTORIQUE,
  type SourceId,
  type SourceOutcome,
  type SourceResult,
} from './meteoSources'
import {
  DEFAUT_MELCCFP,
  type RecevabiliteConfig,
  type RecevabiliteLevel,
} from './recevabilite'

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
  /** Seuils de recevabilité §3.6 effectifs (influencent le verdict → persistés). */
  recevabiliteConfig: RecevabiliteConfig
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
    recevabiliteConfig: { ...DEFAUT_MELCCFP },
  }
}

/**
 * Forme persistée du module météo (dans ProjectData).
 *
 * Toujours : la config reproductible — points, plage, sources, asphalte, choix
 * de station ECCC par point, seuils/filtres/critère d'humidité.
 *
 * `results` : les données horaires TELLES QUE RÉCUPÉRÉES, FIGÉES — succès
 * (lignes, dont dewpoint/pressureHpa tels quels), échecs (SourceError,
 * ecccFailure), et pour chacun `fetchedAt` + `request`. ERA5 est une
 * réanalyse révisée et ECCC corrige ses historiques : on fige, on ne
 * re-interroge pas, on ne recalcule rien au chargement. Écrits UNIQUEMENT sur
 * demande (`withResults`) : blob Dataverse et export fichier, JAMAIS les
 * projets récents du localStorage (quota).
 */
export interface PersistedMeteoModule {
  points: MeteoPoint[]
  startDate: string
  endDate: string
  selectedSources: SourceId[]
  asphalt: boolean
  eccStationByPoint: Record<string, string>
  recevabiliteConfig: RecevabiliteConfig
  /** Absent : projet antérieur au figeage, ou projet récent (localStorage). */
  results?: PointMeteoResults[]
}

export function serializeMeteoModule(
  state: MeteoModuleState,
  opts: { withResults?: boolean } = {},
): PersistedMeteoModule {
  const base: PersistedMeteoModule = {
    points: state.points,
    startDate: state.startDate,
    endDate: state.endDate,
    selectedSources: Array.from(state.selectedSources),
    asphalt: state.asphalt,
    eccStationByPoint: { ...state.eccStationByPoint },
    recevabiliteConfig: { ...state.recevabiliteConfig },
  }
  // Copie profonde : le blob ne doit pas partager de références avec l'état vivant.
  if (opts.withResults) base.results = structuredClone(state.results)
  return base
}

/** Provinces dont l'heure NORMALE est UTC−5 (écart LST connu pour la correction). */
const PROVINCES_LST_UTC_MOINS_5 = new Set(['QC', 'ON'])

/**
 * CORRECTION À LA LECTURE (pas de migration, pas de changement de version) des
 * résultats ECCC figés AVANT la correction de l'heure ECCC : leurs heures sont
 * en LST brut (marqueur timezone 'local (LST)'), donc une heure trop tôt en
 * été. Pour une station QC/ON (LST = UTC−5), chaque heure est ramenée en heure
 * légale America/Toronto. Autre province, ou province inconnue : laissé tel
 * quel (écart LST non sûr) — cf. docs/issues.md. Les échecs n'ont pas d'heures.
 */
export function corrigerEcccLstALaLecture(o: SourceOutcome): SourceOutcome {
  if (isError(o) || o.source !== 'eccc' || o.timezone !== FUSEAU_ECCC_LST_HISTORIQUE) return o
  const province =
    o.candidates?.find((c) => c.climateId === o.station.climateId)?.province ??
    /\(([A-Z]{2})\)\s*$/.exec(o.station.name)?.[1] ??
    null
  if (!province || !PROVINCES_LST_UTC_MOINS_5.has(province)) return o
  return {
    ...o,
    rows: o.rows.map((r) => ({ ...r, datetime: lstVersHeureToronto(r.datetime, 5) ?? r.datetime })),
    timezone: 'America/Toronto (corrigé à la lecture depuis LST)',
  }
}

/** Reconstruit un MeteoModuleState depuis la forme persistée (results restaurés tels quels s'ils y sont). */
export function deserializeMeteoModule(p: PersistedMeteoModule): MeteoModuleState {
  const base = makeDefaultMeteoState()
  return {
    points: p.points?.length ? p.points : base.points,
    startDate: p.startDate ?? base.startDate,
    endDate: p.endDate ?? base.endDate,
    selectedSources: new Set<SourceId>(p.selectedSources ?? Array.from(base.selectedSources)),
    results: Array.isArray(p.results)
      ? p.results.map((pr) => ({ ...pr, outcomes: pr.outcomes.map(corrigerEcccLstALaLecture) }))
      : [],
    asphalt: p.asphalt ?? base.asphalt,
    eccStationByPoint: p.eccStationByPoint ?? {},
    recevabiliteConfig: { ...DEFAUT_MELCCFP, ...(p.recevabiliteConfig ?? {}) },
  }
}

/**
 * État du module Météo à l'ouverture d'un projet — RÈGLE UNIQUE pour la
 * création et les trois voies de chargement (Dataverse, fichier JSON, projet
 * récent) : le module du projet s'il en a un, sinon un module VIERGE. Jamais
 * l'état du projet précédent (qui fuirait, config et résultats, dans le suivant).
 */
export function meteoModuleAuChargement(persisted?: PersistedMeteoModule | null): MeteoModuleState {
  return persisted ? deserializeMeteoModule(persisted) : makeDefaultMeteoState()
}

/**
 * Stations ECCC effectivement utilisées, une ligne « Point : trace » par point
 * ayant un résultat Env. Canada. Pour la traçabilité du rapport (verdict §3.6).
 */
export function ecccStationsUsed(state: MeteoModuleState): string[] {
  const out: string[] = []
  for (const r of state.results) {
    const eccc = r.outcomes.find(
      (o): o is SourceResult => !isError(o) && o.source === 'eccc',
    )
    if (!eccc) continue
    const label = state.points.find((p) => p.id === r.pointId)?.label ?? r.pointId
    out.push(`${label} : ${formatStationTrace(eccc.station)}`)
  }
  return out
}

/**
 * Sources ECCC TENTÉES et ÉCHOUÉES, une ligne « Point : indisponible — cause »
 * par point. Un rapport ne doit jamais être muet sur une source tentée.
 */
export function ecccFailuresUsed(state: MeteoModuleState): string[] {
  const out: string[] = []
  for (const r of state.results) {
    const eccc = r.outcomes.find((o) => o.source === 'eccc')
    if (!eccc || !isError(eccc)) continue
    const label = state.points.find((p) => p.id === r.pointId)?.label ?? r.pointId
    out.push(`${label} : indisponible — ${eccc.error}`)
  }
  return out
}

/**
 * Niveaux que la météo SUGGÈRE d'exclure (cf. utils/exclusionMeteo.ts) :
 *   - `bad`          : non recevable au §3.6 ;
 *   - `indetermine`  : donnée météo aberrante — la mesure ne peut pas être
 *                      justifiée, elle part aussi.
 * Restent : `ok` et `warn` (« à signaler » est RECEVABLE au §3.6 : il se
 * mentionne au rapport, il ne s'exclut pas).
 */
export const NIVEAUX_EXCLUS_PAR_METEO: ReadonlySet<RecevabiliteLevel> = new Set<RecevabiliteLevel>([
  'bad',
  'indetermine',
])

