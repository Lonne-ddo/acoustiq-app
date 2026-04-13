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
} from '../types'
import {
  laeqAvg,
  computeL10,
  computeL50,
  computeL90,
  computeLAFmax,
  computeLAFmin,
} from '../utils/acoustics'

/** Calcule un snapshot d'indices par (point × date) pour la sauvegarde. */
function buildIndicesSnapshot(
  files: MeasurementFile[],
  pointMap: Record<string, string>,
): Record<string, IndicesSnapshot> {
  const groups = new Map<string, number[]>()
  for (const f of files) {
    const pt = pointMap[f.id]
    if (!pt) continue
    const key = `${pt}|${f.date}`
    if (!groups.has(key)) groups.set(key, [])
    const arr = groups.get(key)!
    for (const dp of f.data) arr.push(dp.laeq)
  }
  const out: Record<string, IndicesSnapshot> = {}
  for (const [key, vals] of groups) {
    if (vals.length === 0) continue
    out[key] = {
      laeq: laeqAvg(vals),
      l10: computeL10(vals),
      l50: computeL50(vals),
      l90: computeL90(vals),
      lafmax: computeLAFmax(vals),
      lafmin: computeLAFmin(vals),
    }
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
    indicesSnapshot: buildIndicesSnapshot(files, pointMap),
    projectName,
    checklist,
    scene3D,
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
