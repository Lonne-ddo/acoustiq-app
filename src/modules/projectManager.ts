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
} from '../types'
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
  checklist?: import('../types').ChecklistState,
  scene3D?: Scene3DData,
  categories?: import('../types').Category[],
  periods?: import('../types').Period[],
  meteoModule?: import('../utils/meteoModule').PersistedMeteoModule,
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
