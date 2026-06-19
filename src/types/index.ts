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
  laftEq?: number     // LAImax / LAFTeq (proxy) — utilisé pour le terme Ki (cadre 2026)
  lafmax?: number     // LAFmax 1 s (Fast) — requis pour Ki (Note 98-01, LAFTM5)
  spectra?: number[]  // bandes tiers/octave LZeq si disponibles (aligné sur spectraFreqs)
  spectraMax?: number[] // LZFmax par bande (même ordre) si disponible
}

export interface SourceEvent {
  id: string
  label: string
  time: string
  day: string
  color: string
}

export type ConcordanceState = 'Confirmé' | 'Incertain' | 'Non visible'

/** Ancien statut d'une période — conservé uniquement pour la migration douce
 *  des projets au format pré-catégories. */
export type PeriodStatus = 'include' | 'exclude' | 'annotate'

/** Palette de couleurs proposée pour les catégories de périodes. */
export const PERIOD_PALETTE: string[] = [
  '#22c55e', // vert
  '#3b82f6', // bleu
  '#ef4444', // rouge
  '#eab308', // jaune
  '#f97316', // orange
  '#a855f7', // violet
  '#14b8a6', // teal
  '#ec4899', // rose
  '#6b7280', // gris
]

/** Mode de contribution d'une catégorie au calcul des indices.
 *  'reference' = inclus dans le calcul (comme 'include') mais marqué comme
 *  bruit de fond de référence (rôle organisationnel ; unique par projet). */
export type CategoryMode = 'include' | 'exclude' | 'annotation' | 'reference'

/**
 * Catégorie de périodes — nommable, colorable. `mode` définit sa contribution
 * au calcul (inclure / exclure / annotation). `visible` (la case à cocher du
 * panneau) contrôle à la fois l'affichage des bandes sur le graphique et
 * l'activation dans les calculs : une catégorie masquée est neutralisée
 * (ni affichée, ni prise en compte) sans que ses périodes soient supprimées.
 */
export interface Category {
  id: string
  name: string
  color: string
  mode: CategoryMode
  visible: boolean
}

/** Identifiants stables des 4 catégories par défaut (clé de migration). */
export const DEFAULT_CATEGORY_IDS = {
  ambiant: 'cat-ambiant',
  residuel: 'cat-residuel',
  exclure: 'cat-exclure',
  annotation: 'cat-annotation',
} as const

/** Crée les 4 catégories par défaut d'un nouveau projet. */
export function makeDefaultCategories(): Category[] {
  return [
    { id: DEFAULT_CATEGORY_IDS.ambiant, name: 'Ambiant', color: '#22c55e', mode: 'include', visible: true },
    { id: DEFAULT_CATEGORY_IDS.residuel, name: 'Résiduel', color: '#3b82f6', mode: 'reference', visible: true },
    { id: DEFAULT_CATEGORY_IDS.exclure, name: 'À exclure', color: '#ef4444', mode: 'exclude', visible: true },
    { id: DEFAULT_CATEGORY_IDS.annotation, name: 'Annotation', color: '#eab308', mode: 'annotation', visible: true },
  ]
}

/**
 * Période nommée — assignée à une catégorie. Les timestamps sont stockés en
 * epoch ms pour gérer les plages qui traversent minuit.
 */
export interface Period {
  id: string
  name: string
  /** Epoch ms (inclus) */
  startMs: number
  /** Epoch ms (exclus) */
  endMs: number
  /** Référence à une Category */
  categoryId: string
  /** Commentaire / note libre (optionnel) */
  notes?: string
}

/** Migre une période ancien format (status) vers le format catégorie. */
function migratePeriodRaw(p: Record<string, unknown>): Period | null {
  const startMs = Number(p.startMs)
  const endMs = Number(p.endMs)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  const id = typeof p.id === 'string' && p.id ? p.id : crypto.randomUUID()
  const name = typeof p.name === 'string' ? p.name : 'Période'
  const notes = typeof p.notes === 'string' ? p.notes
    : typeof p.comment === 'string' ? p.comment : undefined
  if (typeof p.categoryId === 'string' && p.categoryId) {
    return { id, name, startMs, endMs, categoryId: p.categoryId, notes }
  }
  const map: Record<string, string> = {
    include: DEFAULT_CATEGORY_IDS.ambiant,
    exclude: DEFAULT_CATEGORY_IDS.exclure,
    annotate: DEFAULT_CATEGORY_IDS.annotation,
  }
  const status = typeof p.status === 'string' ? p.status : 'include'
  return { id, name, startMs, endMs, categoryId: map[status] ?? DEFAULT_CATEGORY_IDS.ambiant, notes }
}

/**
 * Normalise catégories + périodes au chargement d'un projet (migration douce) :
 *   - périodes ancien format (status) → categoryId via les ids par défaut ;
 *   - catégories absentes → les 4 par défaut ;
 *   - ajoute toute catégorie par défaut référencée mais manquante ;
 *   - réaffecte les périodes orphelines à la 1re catégorie.
 */
export function normalizeProjectPeriods(
  rawCategories: unknown,
  rawPeriods: unknown,
): { categories: Category[]; periods: Period[] } {
  const periods = Array.isArray(rawPeriods)
    ? rawPeriods.map((p) => migratePeriodRaw(p as Record<string, unknown>)).filter((p): p is Period => p !== null)
    : []
  let categories: Category[] = Array.isArray(rawCategories) && rawCategories.length
    ? (rawCategories as Array<Record<string, unknown>>).map((c) => {
        // Migration : ancien format {included, isAnnotation} → {mode, visible}.
        let mode: CategoryMode
        if (c.mode === 'include' || c.mode === 'exclude' || c.mode === 'annotation' || c.mode === 'reference') {
          mode = c.mode
        } else if (c.isAnnotation) {
          mode = 'annotation'
        } else {
          mode = c.included === false ? 'exclude' : 'include'
        }
        return {
          id: String(c.id),
          name: typeof c.name === 'string' ? c.name : 'Catégorie',
          color: typeof c.color === 'string' ? c.color : PERIOD_PALETTE[0],
          mode,
          visible: c.visible !== false,
        }
      })
    : []
  if (categories.length === 0) categories = makeDefaultCategories()
  const have = new Set(categories.map((c) => c.id))
  const defaults = makeDefaultCategories()
  for (const p of periods) {
    if (have.has(p.categoryId)) continue
    const d = defaults.find((c) => c.id === p.categoryId)
    if (d) { categories.push(d); have.add(d.id) }
    else p.categoryId = categories[0].id
  }
  return { categories, periods }
}

/** Candidat d'événement issu de la détection automatique (émergence sur bruit de fond local) */
export interface CandidateEvent {
  id: string
  point: string  // nom du point de mesure (BV-94, etc.)
  day: string    // YYYY-MM-DD
  time: string   // HH:MM (début de l'événement)
  /** Heure de fin HH:MM */
  endTime?: string
  /** Durée de l'événement en secondes */
  durationSec?: number
  /** Émergence dB = LAeq événement − bruit de fond local */
  delta: number
  /** LAeq énergétique sur la durée de l'événement (dB(A)) */
  laeq: number
  /** LAFmax pendant l'événement (dB(A)) */
  lafmax?: number
  /** Bruit de fond local (moyenne glissante) au moment de l'événement (dB(A)) */
  baseline?: number
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

/**
 * Qualité de calage d'un fichier audio par rapport à la courbe LAeq :
 *   - calibrated : calage appliqué (horodatage manuel, pointage ou corrélation)
 *   - date_only  : date déduite du nom de façon plausible, heure à 00:00
 *   - uncertain  : date déduite mais format ambigu (ex: YYMMDD_NNNN des
 *                  enregistreurs Tascam où 180720 peut n'être qu'un numéro
 *                  interne et non 2018-07-20). À vérifier par l'utilisateur.
 *   - none       : rien d'exploitable, début forcé à 00:00 par défaut
 */
export type AudioCaleStatus = 'calibrated' | 'date_only' | 'uncertain' | 'none'

/**
 * Entrée audio en mode streaming — ne décode pas le fichier en AudioBuffer
 * (crucial pour les MP3 de plusieurs centaines de Mo). Chargée via blob URL
 * et HTMLAudioElement, associée à un point de mesure comme un fichier de
 * données. Utilisée par le lecteur intégré au graphique LAeq.
 */
export interface AudioFileEntry {
  id: string
  /** Nom original du fichier */
  name: string
  /** Taille en octets */
  size: number
  /** Extension normalisée : mp3 | wav | m4a | ogg */
  ext: 'mp3' | 'wav' | 'm4a' | 'ogg'
  /** Blob URL (URL.createObjectURL) — à révoquer au retrait */
  blobUrl: string
  /** Durée en secondes, probée via <audio> metadata */
  durationSec: number
  /** Date ISO YYYY-MM-DD de début de l'enregistrement */
  date: string
  /** Minutes depuis minuit du début de l'enregistrement (sur la date ci-dessus) */
  startMin: number
  /** Informations extraites du nom pour aider au regroupement si timestamp partiel */
  parserResult?: {
    fileIndex?: number
    detected: 'full' | 'dateOnly' | 'uncertain' | 'none'
  }
  /** Vrai si l'heure n'a pas pu être déduite → l'utilisateur a dû la saisir manuellement */
  manualStart?: boolean
  /** Qualité de calage (indicateur visuel ● vert/jaune/rouge) */
  caleStatus: AudioCaleStatus
  /** ISO datetime du dernier calage appliqué (utile pour la persistance / debug) */
  calibratedAt?: string
  /** Identifiant de session audio — fichiers d'un même enregistreur regroupés */
  sessionId?: string
  /** Dans une session, si vrai → les fichiers se suivent sans gap (heures dérivées des durées) */
  sessionContiguous?: boolean
}

/** Session audio regroupant plusieurs fichiers d'un même enregistreur. */
export interface AudioSession {
  id: string
  /** Nom affiché (ex: "Tascam 1") */
  name: string
  /** Vrai si l'utilisateur confirme que les fichiers sont contigus → propage le calage */
  contiguous: boolean
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
  /** Bâtiment simplifié — conservé pour compatibilité des anciens projets */
  building?: {
    width: number
    depth: number
    height: number
  }
  sources: Array<{
    id: string      // référence à la source existante
    lng?: number    // longitude (nouveau format MapLibre)
    lat?: number    // latitude (nouveau format MapLibre)
    /** Anciens champs Three.js (conservés pour compatibilité, non utilisés) */
    x?: number
    y?: number
    z?: number
    placed: boolean
  }>
  /** Centre de la carte et zoom sauvegardés */
  view?: {
    lng: number
    lat: number
    zoom: number
    pitch: number
    bearing: number
  }
  /** Bounding box (legacy) — conservé pour compatibilité */
  bbox?: { south: number; west: number; north: number; east: number }
  /** Image satellite (legacy) — conservé pour compatibilité, non affiché */
  satelliteImage?: {
    dataUrl: string
    opacity: number
    bbox: { south: number; west: number; north: number; east: number }
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
  /** Catégories de périodes (incluses/exclues/annotations) */
  categories?: Category[]
  /** Périodes nommées définies sur le graphique */
  periods?: Period[]
}
