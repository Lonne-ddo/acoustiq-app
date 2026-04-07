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
  lceq?: number       // LCeq (pondération C) — utilisé pour le terme Kb
  laftEq?: number     // LAImax / LAFTeq (proxy) — utilisé pour le terme Ki
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

/** Résumé partageable des résultats Conformité 2026 (pour le rapport) */
export interface ConformiteSummary {
  receptor: 'I' | 'II' | 'III' | 'IV'
  receptorLabel: string
  period: 'jour' | 'nuit'
  evalHour: string         // HH:MM
  date: string
  limit: number            // dB(A)
  points: Array<{
    point: string
    ba: number | null
    br: number | null
    bp: number | null
    lar: number | null
    criterion: number
    appliedKLabel: string
    pass: boolean | null
  }>
}

/** Plage de zoom partagée entre le graphique et le spectrogramme */
export interface ZoomRange {
  startMin: number
  endMin: number
}

/** Paramètres de l'application persistés en localStorage */
export interface AppSettings {
  /** Couleurs personnalisées par point de mesure */
  pointColors: Record<string, string>
  /** Plage Y par défaut du graphique (dBA) */
  yAxisMin: number
  yAxisMax: number
  /** Intervalle d'agrégation par défaut (minutes) */
  aggregationInterval: number
  /** Nom de l'entreprise (affiché dans les rapports) */
  companyName: string
  /** Langue de l'interface : fr ou en */
  language: 'fr' | 'en'
}

/** Entrée d'un projet récent dans localStorage */
export interface RecentProject {
  id: string
  name: string
  savedAt: string
  /** État sérialisé du projet (sans données brutes) */
  state: string
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
