// Interfaces TypeScript pour AcoustiQ

export interface MeasurementFile {
  id: string
  name: string
  model: string
  serial: string
  date: string        // YYYY-MM-DD
  startTime: string   // HH:MM
  stopTime: string    // HH:MM
  point: string | null
  data: DataPoint[]
  rowCount: number
}

export interface DataPoint {
  t: number           // minutes depuis minuit
  laeq: number
  spectra?: number[]  // bandes tiers d'octave si disponibles
}

export interface SourceEvent {
  id: string
  label: string
  time: string
  day: string
  color: string
}

export type ConcordanceState = 'Confirmé' | 'Incertain' | 'Non visible'

/** Plage de zoom partagée entre le graphique et le spectrogramme */
export interface ZoomRange {
  startMin: number
  endMin: number
}

/** Fichier audio associé à une journée de mesure */
export interface AudioFile {
  id: string
  name: string
  /** Date associée (YYYY-MM-DD), déduite du nom de fichier ou assignée manuellement */
  date: string
  /** Buffer audio décodé pour le Web Audio API */
  buffer: AudioBuffer
  /** Durée en secondes */
  duration: number
  /** Heure de début d'enregistrement en minutes depuis minuit (par défaut 0) */
  startOffsetMin: number
}

/** Structure d'un projet sauvegardé */
export interface ProjectData {
  version: string
  savedAt: string
  files: Array<{
    id: string
    name: string
    model: string
    serial: string
    date: string
    startTime: string
    stopTime: string
    rowCount: number
  }>
  pointAssignments: Record<string, string>
  events: SourceEvent[]
  concordance: Record<string, ConcordanceState>
}
