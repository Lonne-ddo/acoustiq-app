/**
 * Gestionnaire de sauvegarde et chargement de projets AcoustiQ
 * Sérialise l'état de l'application en JSON (métadonnées uniquement, pas de données brutes)
 */
import type {
  MeasurementFile,
  SourceEvent,
  ConcordanceState,
  ProjectData,
} from '../types'

const PROJECT_VERSION = '1.0'

/**
 * Sauvegarde le projet courant en fichier JSON
 */
export function saveProject(
  files: MeasurementFile[],
  pointMap: Record<string, string>,
  events: SourceEvent[],
  concordance: Record<string, ConcordanceState>,
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
