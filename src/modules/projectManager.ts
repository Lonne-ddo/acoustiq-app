/**
 * Gestionnaire de sauvegarde et chargement de projets AcoustiQ
 * Sérialise l'état de l'application en JSON (métadonnées uniquement, pas de données brutes)
 */
import type {
  MeasurementFile,
  SourceEvent,
  ConcordanceState,
  ProjectData,
  MarkerPos,
  MeteoData,
  IndicesSnapshot,
  Scene3DData,
  Period,
  Category,
  ChecklistState,
} from '../types'
import type { PersistedMeteoModule } from '../utils/meteoModule'
import { filterDataByPeriods } from '../utils/acoustics'
import { computeIndexRow } from '../utils/reportIndices'

/**
 * Snapshot d'indices par (point × date) — reflète l'état FILTRÉ que l'utilisateur
 * voyait (mêmes catégories/périodes qu'IndicesPanel/ReportGenerator), pas les
 * données brutes. Filtrage per-fichier via filterDataByPeriods ; indices via la
 * brique commune computeIndexRow. Exporté : consommé aussi par la modal
 * « Comparer projets » (App), pour éviter deux implémentations divergentes.
 */
export function buildIndicesSnapshot(
  files: MeasurementFile[],
  pointMap: Record<string, string>,
  periods?: Period[],
  categories?: Category[],
): Record<string, IndicesSnapshot> {
  const groups = new Map<string, number[]>()
  for (const f of files) {
    const pt = pointMap[f.id]
    if (!pt) continue
    const key = `${pt}|${f.date}`
    const arr = groups.get(key) ?? []
    for (const dp of filterDataByPeriods(f.data, f.date, periods, categories)) arr.push(dp.laeq)
    groups.set(key, arr)
  }
  const out: Record<string, IndicesSnapshot> = {}
  for (const [key, vals] of groups) {
    const row = computeIndexRow(vals)
    if (row) out[key] = row
  }
  return out
}

const PROJECT_VERSION = '1.1'

/**
 * Sauvegarde le projet courant en fichier JSON
 */
export function saveProject(
  files: MeasurementFile[],
  pointMap: Record<string, string>,
  events: SourceEvent[],
  concordance: Record<string, ConcordanceState>,
  mapImage: string | null = null,
  mapMarkers: Record<string, MarkerPos> = {},
  meteo?: MeteoData,
  projectName?: string,
  checklist?: ChecklistState,
  scene3D?: Scene3DData,
  categories?: Category[],
  periods?: Period[],
  meteoModule?: PersistedMeteoModule,
  projectNumber?: string,
): void {
  const project: ProjectData = {
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      model: f.model,
      serial: f.serial,
      date: f.date,
      startTime: f.startTime,
      stopTime: f.stopTime,
      rowCount: f.rowCount,
    })),
    pointAssignments: { ...pointMap },
    events: events.map((ev) => ({ ...ev })),
    concordance: { ...concordance },
    mapImage,
    mapMarkers: { ...mapMarkers },
    meteo,
    indicesSnapshot: buildIndicesSnapshot(files, pointMap, periods, categories),
    projectName,
    projectNumber,
    checklist,
    scene3D,
    categories,
    periods,
    meteoModule,
  }

  const json = JSON.stringify(project, null, 2)
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  link.download = `acoustiq_project_${date}.json`
  link.href = url
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Charge un projet depuis un fichier JSON
 * Retourne les données du projet et la liste des fichiers manquants
 */
export function loadProject(
  json: string,
  currentFiles: MeasurementFile[],
): {
  project: ProjectData
  missingFiles: string[]
} {
  const project = JSON.parse(json) as ProjectData

  if (!project.version || !project.files) {
    throw new Error('Format de projet invalide')
  }

  // Vérifier quels fichiers référencés ne sont pas chargés
  const loadedNames = new Set(currentFiles.map((f) => `${f.name}|${f.date}`))
  const missingFiles = project.files
    .filter((f) => !loadedNames.has(`${f.name}|${f.date}`))
    .map((f) => f.name)

  return { project, missingFiles }
}

/**
 * État applicatif nécessaire pour construire un ProjectData COMPLET (voie
 * Dataverse). Volontairement en objet (et non liste positionnelle comme
 * saveProject) : plus lisible et extensible côté appelant.
 */
export interface FullProjectInput {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  events: SourceEvent[]
  concordance: Record<string, ConcordanceState>
  mapImage?: string | null
  mapMarkers?: Record<string, MarkerPos>
  meteo?: MeteoData
  projectName?: string
  projectNumber?: string
  checklist?: ChecklistState
  scene3D?: Scene3DData
  categories?: Category[]
  periods?: Period[]
  meteoModule?: PersistedMeteoModule
  /** Injectable pour la testabilité (sinon horodatage courant). */
  savedAt?: string
}

/**
 * Construit le ProjectData COMPLET destiné au blob Dataverse.
 *
 * Différence essentielle avec `saveProject` (voie JSON/localStorage) : les
 * fichiers portent leurs DONNÉES BRUTES (`files[].data`), ce qui permet la
 * restauration par recalcul sans réimport. Reprend par ailleurs l'intégralité
 * des champs de ProjectData (assignations, événements, concordance, carte,
 * météo, catégories, périodes, checklist, scène 3D, module météo, nom + numéro
 * de projet).
 *
 * VOLONTAIREMENT SANS `indicesSnapshot` : la voie Dataverse est sources-only,
 * tout est recalculé au load par les useMemo. Figer un snapshot d'indices
 * réglementaires les rendrait faux si la logique de calcul évolue. (À l'inverse,
 * `saveProject` — export JSON instantané — conserve son snapshot, qui y a du sens.)
 *
 * Fonction PURE : aucune I/O, aucun accès à l'état React — tout via l'argument.
 */
export function buildFullProjectData(input: FullProjectInput): ProjectData {
  const { files, pointMap, events, concordance } = input
  return {
    version: PROJECT_VERSION,
    savedAt: input.savedAt ?? new Date().toISOString(),
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      model: f.model,
      serial: f.serial,
      date: f.date,
      startTime: f.startTime,
      stopTime: f.stopTime,
      rowCount: f.rowCount,
      // ← LA différence : on embarque les données brutes (omises par saveProject)
      // + l'alignement spectral (indispensable au recalcul spectro/Kt au load).
      data: f.data,
      spectraFreqs: f.spectraFreqs,
    })),
    pointAssignments: { ...pointMap },
    events: events.map((ev) => ({ ...ev })),
    concordance: { ...concordance },
    mapImage: input.mapImage ?? null,
    mapMarkers: { ...(input.mapMarkers ?? {}) },
    meteo: input.meteo,
    projectName: input.projectName,
    projectNumber: input.projectNumber,
    checklist: input.checklist,
    scene3D: input.scene3D,
    categories: input.categories,
    periods: input.periods,
    meteoModule: input.meteoModule,
  }
}

/**
 * Résumé lisible COURT du projet, destiné à la colonne `acq_notes` de Dataverse.
 * Objectif : lire l'essentiel au portail / depuis le budget app sans ouvrir le
 * blob. Ex. « 4 fichier(s), 2 point(s), 2026-07-07 → 2026-07-08 ».
 */
export function buildProjectNotes(
  files: MeasurementFile[],
  pointMap: Record<string, string>,
): string {
  const nbPoints = new Set(Object.values(pointMap).filter(Boolean)).size
  const dates = [...new Set(files.map((f) => f.date).filter(Boolean))].sort()
  const range =
    dates.length === 0 ? 'aucune date' : dates.length === 1 ? dates[0] : `${dates[0]} → ${dates[dates.length - 1]}`
  return `${files.length} fichier(s), ${nbPoints} point(s), ${range}`
}
