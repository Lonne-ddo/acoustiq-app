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
  /**
   * Fréquences centrales des bandes 1/3 d'octave présentes dans `data[i].spectra`,
   * dans le même ordre. Permet à la couche d'affichage (Spectrogram, analyseKt)
   * d'aligner correctement les bandes entre 831C (50 Hz – 20 kHz, 27 bandes)
   * et 821SE (31.5 Hz – 10 kHz, 26 bandes).
   * Si absent : ancien comportement (les N dernières bandes de FREQ_BANDS_ALL).
   */
  spectraFreqs?: number[]
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

/** Candidat d'événement issu de la détection automatique (rise ≥ 6 dB en 60 s) */
export interface CandidateEvent {
  id: string
  point: string  // nom du point de mesure (BV-94, etc.)
  day: string    // YYYY-MM-DD
  time: string   // HH:MM
  delta: number  // delta dB par rapport au plancher de la fenêtre
  laeq: number   // valeur LAeq au pic
}

/** Annotation textuelle ancrée à un instant et un niveau dB sur le graphique */
export interface ChartAnnotation {
  id: string
  text: string
  day: string    // YYYY-MM-DD
  time: string   // HH:MM
  laeq: number   // niveau dB(A) sur l'axe Y
  color?: string
}

/** Snapshot d'indices acoustiques pour un point/date — sauvegardé dans le projet
 *  pour permettre la comparaison sans recharger les données brutes. */
export interface IndicesSnapshot {
  laeq: number
  l10: number
  l50: number
  l90: number
  lafmax: number
  lafmin: number
}

/** Conditions météorologiques saisies manuellement par l'utilisateur. */
export interface MeteoData {
  windSpeed: number | null     // km/h
  windDirection: '' | 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SO' | 'O' | 'NO'
  temperature: number | null   // °C
  conditions: '' | 'Dégagé' | 'Nuageux' | 'Couvert' | 'Précipitations'
  note: string
}

export const DEFAULT_METEO: MeteoData = {
  windSpeed: null,
  windDirection: '',
  temperature: null,
  conditions: '',
  note: '',
}

/** Item d'une checklist terrain (case à cocher) */
export interface ChecklistItem {
  id: string
  text: string
  checked: boolean
  /** Vrai si l'item a été ajouté manuellement par l'utilisateur (suppressible) */
  custom?: boolean
}

/** État complet de la checklist terrain (3 sections + items custom) */
export interface ChecklistState {
  before: ChecklistItem[]
  during: ChecklistItem[]
  after: ChecklistItem[]
}

/** Modèle de configuration réutilisable (point names, conformité, plage Y) */
export interface ProjectTemplate {
  id: string
  name: string
  builtin?: boolean
  pointNames: string[]
  receptor: 'I' | 'II' | 'III' | 'IV'
  period: 'jour' | 'nuit'
  yMin: number
  yMax: number
}

/** Résumé partageable des résultats Conformité 2026 (pour le rapport) */
export interface ConformiteSummary {
  receptor: 'I' | 'II' | 'III' | 'IV'
  receptorLabel: string
  period: 'jour' | 'nuit'
  evalHour: string         // HH:MM
  date: string
  limit: number            // dB(A)
  /** Incertitude combinée appliquée (± dB) — ISO 9613-2 */
  uncertainty?: number
  points: Array<{
    point: string
    ba: number | null
    br: number | null
    bp: number | null
    lar: number | null
    criterion: number
    appliedKLabel: string
    pass: boolean | null
    /** LAr,1h + incertitude combinée (dB(A)), null si lar null */
    larPlusU?: number | null
    /** Vrai si la marge d'incertitude conduit au dépassement */
    margeNonConforme?: boolean
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

/** Position normalisée (0–1) d'un marqueur sur l'image de plan de site */
export interface MarkerPos {
  x: number  // fraction 0..1 — colonne
  y: number  // fraction 0..1 — ligne
}

/** Source Lw résumée (partagée entre l'onglet Calcul Lw et Vue 3D) */
export interface LwSourceSummary {
  id: string
  name: string
  lw: number        // Lw global (dBA)
  type: 'roof' | 'ground' | 'parallelepiped'
}

/** Données de la scène 3D sauvegardées dans le projet */
export interface Scene3DData {
  building: {
    width: number   // largeur en mètres (défaut: 120)
    depth: number   // profondeur en mètres (défaut: 70)
    height: number  // hauteur en mètres (défaut: 15)
  }
  sources: Array<{
    id: string      // référence à la source existante
    x: number
    y: number
    z: number
    placed: boolean
  }>
  /** Bounding box OSM utilisé pour générer le modèle 3D */
  bbox?: { south: number; west: number; north: number; east: number }
  /** Image satellite drapée sur le sol */
  satelliteImage?: {
    dataUrl: string        // image encodée en base64 data URL
    opacity: number        // 0.0 à 1.0, défaut 0.8
    bbox: {                // bbox de la zone OSM pour l'alignement
      south: number
      west: number
      north: number
      east: number
    }
  }
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
  /** Image du plan de site (data URL base64) — optionnel */
  mapImage?: string | null
  /** Positions des marqueurs par point de mesure */
  mapMarkers?: Record<string, MarkerPos>
  /** Conditions météorologiques saisies manuellement */
  meteo?: MeteoData
  /** État de la checklist terrain (cases cochées + items personnalisés) */
  checklist?: ChecklistState
  /** Snapshot d'indices par point — clé "BV-94" ou "BV-94|2026-03-09" si plusieurs jours */
  indicesSnapshot?: Record<string, IndicesSnapshot>
  /** Nom du projet (purement informatif, utilisé par la comparaison) */
  projectName?: string
  /** État de la scène 3D (bâtiment + positions des sources) */
  scene3D?: Scene3DData
}
