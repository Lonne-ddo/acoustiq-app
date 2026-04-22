/**
 * Composant de visualisation temporelle des niveaux LAeq
 *
 * Une courbe par point de mesure, agrégation configurable (1 s → 1 h).
 * - Molette : zoom centré sur le curseur
 * - Clic + glisser : pan
 * - Shift + glisser : sélection d'une plage temporelle (popup LAeq/L90)
 * - Double-clic : retour à la vue complète
 * - Étiquettes de point « collantes » au bord droit visible
 * - Axe Y auto-ajusté quand on zoome (±5 dB de marge)
 * - Badge « ×n zoom » en haut à droite
 */
import { useMemo, useRef, useCallback, useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts'
import html2canvas from 'html2canvas'
import { drawQrBadge } from '../utils/qrBadge'
import { Download, ZoomIn, ZoomOut, Maximize2, Plus, X, AlertTriangle, GitCompare, Layers, Maximize, Minimize, Wind, Copy, StickyNote, Flag, Trash2, Edit3, Play, ChevronDown } from 'lucide-react'
import ContextMenu from './ContextMenu'
import { ReferenceDot } from 'recharts'
import type { MeasurementFile, SourceEvent, ZoomRange, AppSettings, CandidateEvent, ChartAnnotation, MeteoData, Period, PeriodStatus } from '../types'
import { PERIOD_PALETTE } from '../types'
import type { AudioCoverageRange } from '../hooks/useAudioSync'
import { findCoveringRange } from '../hooks/useAudioSync'
import AudioTimelineBar from './audio/AudioTimelineBar'
import type { ClassifiedSegment } from '../utils/yamnetProcessor'
import { laeqAvg, computeL90 } from '../utils/acoustics'

// Palette de couleurs par point de mesure
const POINT_COLORS: Record<string, string> = {
  'BV-94':  '#10b981',
  'BV-98':  '#3b82f6',
  'BV-105': '#f59e0b',
  'BV-106': '#ef4444',
  'BV-37':  '#8b5cf6',
  'BV-107': '#06b6d4',
}
const FALLBACK_COLORS = ['#ec4899', '#84cc16', '#f97316', '#a78bfa']

function getPointColor(point: string, index: number, custom?: Record<string, string>): string {
  return custom?.[point] ?? POINT_COLORS[point] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

/** Convertit des minutes depuis minuit en chaîne HH:MM */
function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = Math.round(minutes % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Convertit minutes (float) en HH:MM:SS */
function minutesToHHMMSS(minutes: number): string {
  const totalSec = Math.round(minutes * 60)
  const h = Math.floor(totalSec / 3600) % 24
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Durée d'une plage en minutes (float) → chaîne « Xh Ym Zs » compacte. */
function formatDurationMin(minutes: number): string {
  const totalSec = Math.max(0, Math.round(Math.abs(minutes) * 60))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0 || h > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

/**
 * Arrondit une heure HH:MM au bucket d'agrégation inférieur (en secondes)
 * pour aligner les événements avec les données du graphique
 */
function snapToBucket(time: string, aggSec: number): string {
  const [h = '0', m = '0'] = time.split(':')
  const totalSec = (parseInt(h, 10) * 60 + parseInt(m, 10)) * 60
  const snappedSec = Math.floor(totalSec / aggSec) * aggSec
  return minutesToHHMM(snappedSec / 60)
}

/** Convertit HH:MM en minutes depuis minuit */
function hhmmToMin(time: string): number {
  const [h = '0', m = '0'] = time.split(':')
  return parseInt(h, 10) * 60 + parseInt(m, 10)
}

/** Arrondit un nombre de minutes au bucket d'agrégation inférieur (en s) */
function snapBucketMin(totalMin: number, aggSec: number): number {
  const totalSec = totalMin * 60
  return (Math.floor(totalSec / aggSec) * aggSec) / 60
}

const DOW_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
const MON_FR = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']

/** "2026-03-09" → "Lun 09 mars" (date en fuseau local) */
function longFrDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
  return `${DOW_FR[d.getDay()]} ${m[3]} ${MON_FR[parseInt(m[2], 10) - 1]}`
}

/** Epoch ms à minuit local pour une date ISO YYYY-MM-DD */
function dateMsMidnight(iso: string): number {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return NaN
  return new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10),
  ).getTime()
}

/** "2026-03-09" → "09/03" */
function shortSlashDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  return `${m[3]}/${m[2]}`
}


/**
 * Calcule des ticks adaptatifs pour l'axe X selon la plage visible.
 * Retourne la liste des labels (sous-ensemble de ceux présents dans visibleData)
 * et un formatter qui supprime ":00" final pour les labels HH:MM:SS.
 *
 * Règles :
 *  - > 4h     : HH:MM, pas de 30 ou 60 min
 *  - 1h – 4h  : HH:MM, pas de 15 ou 30 min
 *  - 15min–1h : HH:MM, pas de 5 ou 10 min
 *  - < 15min  : HH:MM:SS, pas de 1 ou 2 min
 *  - Toujours au moins 4 ticks
 */
function computeAdaptiveTicks(
  visibleData: ChartEntry[],
  rangeMin: number,
  aggSec: number,
): { ticks: string[]; formatter: (s: string) => string } {
  const formatter = (s: string): string => {
    // Strip trailing :00 from HH:MM:SS labels
    if (typeof s === 'string' && s.length === 8 && s.endsWith(':00')) return s.slice(0, 5)
    return s
  }
  if (visibleData.length === 0) return { ticks: [], formatter }

  // Pas idéal en secondes selon la plage visible
  let idealStepSec: number
  if (rangeMin > 240) idealStepSec = 3600       // 1 h
  else if (rangeMin > 120) idealStepSec = 1800  // 30 min
  else if (rangeMin > 60) idealStepSec = 900    // 15 min
  else if (rangeMin > 30) idealStepSec = 600    // 10 min
  else if (rangeMin > 15) idealStepSec = 300    // 5 min
  else if (rangeMin > 5) idealStepSec = 120     // 2 min
  else idealStepSec = 60                        // 1 min

  // Le pas doit être au moins égal à l'agrégation pour aligner sur les buckets
  let stepSec = Math.max(idealStepSec, aggSec)

  // Sélection des labels alignés sur le pas
  const pickByStep = (sec: number): string[] => {
    const out: string[] = []
    const seen = new Set<number>()
    for (const row of visibleData) {
      const tSec = Math.round(row.t * 60)
      if (tSec % sec !== 0) continue
      const k = Math.floor(tSec / sec)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(row.label as string)
    }
    return out
  }

  let ticks = pickByStep(stepSec)

  // Garantir au moins 4 ticks : réduire le pas progressivement
  const fallbackSteps = [stepSec / 2, stepSec / 3, aggSec]
  for (const s of fallbackSteps) {
    if (ticks.length >= 4) break
    if (s > 0 && Number.isFinite(s)) {
      ticks = pickByStep(Math.max(1, Math.round(s)))
      stepSec = Math.max(1, Math.round(s))
    }
  }

  // Dernier recours : échantillonnage uniforme sur visibleData
  if (ticks.length < 4 && visibleData.length >= 4) {
    ticks = []
    const n = Math.min(8, visibleData.length)
    for (let i = 0; i < n; i++) {
      const idx = Math.round((i * (visibleData.length - 1)) / (n - 1))
      ticks.push(visibleData[idx].label as string)
    }
  }

  // Anti-chevauchement : limite la densité (~1 tick / 60 px → max ~12 ticks pour
  // une largeur typique de chart). On dégrade en gardant 1 tick sur N.
  const MAX_TICKS = 12
  if (ticks.length > MAX_TICKS) {
    const stride = Math.ceil(ticks.length / MAX_TICKS)
    ticks = ticks.filter((_, i) => i % stride === 0)
  }

  return { ticks, formatter }
}

interface ChartEntry {
  t: number          // minutes (float possible)
  label: string
  [point: string]: number | string
}

/** Options d'agrégation proposées dans la barre d'outils (en secondes) */
export const AGGREGATION_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: '1 s',   seconds: 1 },
  { label: '5 s',   seconds: 5 },
  { label: '10 s',  seconds: 10 },
  { label: '30 s',  seconds: 30 },
  { label: '1 min', seconds: 60 },
  { label: '5 min', seconds: 300 },
  { label: '15 min', seconds: 900 },
  { label: '1 h',   seconds: 3600 },
]

interface Props {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  availableDates: string[]
  onDateChange: (date: string) => void
  events: SourceEvent[]
  zoomRange: ZoomRange | null
  onZoomChange: (range: ZoomRange | null) => void
  /** Paramètres de l'application (couleurs, axe Y) */
  settings?: AppSettings
  /** Pas d'agrégation en secondes (lifté dans App pour partage avec le spectrogramme) */
  aggregationSeconds: number
  onAggregationChange: (seconds: number) => void
  /** Permet à la popup de sélection d'ajouter un événement */
  onAddEvent: (event: SourceEvent) => void
  /** Jour superposé (max 1) — affiché en pointillé sur le même axe temporel */
  overlayDate: string | null
  onOverlayDateChange: (date: string | null) => void
  /** Candidats détectés automatiquement à afficher en pointillé orange */
  candidates: CandidateEvent[]
  /** Annotations textuelles ancrées sur le graphique */
  annotations: ChartAnnotation[]
  /** Texte d'annotation en attente : si défini, le prochain clic sur le graphique la place */
  pendingAnnotationText: string | null
  onAnnotationPlace: (a: ChartAnnotation) => void
  onPendingAnnotationCleared: () => void
  /** Mode présentation : affiche un titre projet et un bouton Quitter */
  presentationMode?: boolean
  onPresentationToggle?: () => void
  projectName?: string
  /** Conditions météo (pour overlay vent invalide + courbe vent) */
  meteo?: MeteoData
  /** Segments audio classifiés YAMNet — surimpression colorée */
  audioSegments?: ClassifiedSegment[]
  /** Décalage de l'audio en minutes depuis minuit (pour positionner les segments) */
  audioOffsetMin?: number
  /** Labels personnalisés par point (ex: { "BV-94": "Récepteur Nord" }) */
  pointLabels?: Record<string, string>
  /** Points masqués (toggle global légende/sidebar) */
  hiddenPoints?: Set<string>
  /** Toggle visibilité d'un point (légende cliquable) */
  onTogglePointVisibility?: (pt: string) => void
  /** Périodes nommées (affichées comme bandes vertes/rouges) */
  periods?: Period[]
  onPeriodAdd?: (p: Period) => void
  onPeriodUpdate?: (id: string, patch: Partial<Period>) => void
  onPeriodRemove?: (id: string) => void
  /** Plages de couverture audio pour la barre sous l'axe X et le curseur de lecture */
  audioCoverage?: AudioCoverageRange[]
  /** Noms des fichiers audio (pour le tooltip de la timeline) */
  audioLabels?: Record<string, string>
  /** Position actuelle de lecture (minutes absolues axe X) */
  audioPlayheadMin?: number | null
  /** Vrai pendant la lecture audio — bascule le clic en mode « seek » */
  audioPlaying?: boolean
  /** Demande à jouer une entrée audio à une position donnée */
  onAudioPlayAt?: (entryId: string, minutes: number) => void
  /** Seek de l'entrée actuellement chargée à une minute absolue */
  onAudioSeekMin?: (minutes: number) => void
  /** Mode "pick" pour le calage audio (feature calage) : le prochain clic
   *  remonte la minute absolue au callback au lieu de créer une période. */
  chartPickArmed?: boolean
  onChartPicked?: (tMin: number) => void
  /** Mode "pick range" pour le calage audio Auto RMS : le prochain drag
   *  remonte [startMin, endMin] au callback au lieu de créer une période. */
  chartRangePickArmed?: boolean
  onChartRangePicked?: (startMin: number, endMin: number) => void
  /** Fenêtre surlignée de façon persistante sur le chart (bleu translucide). */
  chartHighlightRange?: { startMin: number; endMin: number } | null
}

/** Format court d'une date ISO en français : "2026-03-09" → "09 mars" */
function shortFrDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  const months = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin',
    'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
  return `${m[3]} ${months[parseInt(m[2], 10) - 1]}`
}

// Zoom minimum en minutes (selon spec)
const MIN_ZOOM_SPAN = 2

export default function TimeSeriesChart({
  files,
  pointMap,
  selectedDate,
  availableDates,
  onDateChange,
  events,
  zoomRange,
  onZoomChange,
  settings,
  aggregationSeconds,
  onAggregationChange,
  onAddEvent,
  overlayDate,
  onOverlayDateChange,
  candidates,
  annotations,
  pendingAnnotationText,
  onAnnotationPlace,
  onPendingAnnotationCleared,
  presentationMode,
  onPresentationToggle,
  projectName,
  meteo,
  audioSegments,
  audioOffsetMin = 0,
  pointLabels = {},
  hiddenPoints,
  onTogglePointVisibility,
  periods,
  onPeriodAdd,
  onPeriodUpdate,
  onPeriodRemove,
  audioCoverage,
  audioLabels,
  audioPlayheadMin,
  audioPlaying,
  onAudioPlayAt,
  onAudioSeekMin,
  chartPickArmed,
  onChartPicked,
  chartRangePickArmed,
  onChartRangePicked,
  chartHighlightRange,
}: Props) {
  // Affichage des données météo (vent) sur le graphique
  const [showWind, setShowWind] = useState(false)
  // Couleurs personnalisées depuis les paramètres
  const pointColors = settings?.pointColors ?? POINT_COLORS
  const settingsYMin = settings?.yAxisMin ?? 30
  const settingsYMax = settings?.yAxisMax ?? 90
  const aggSec = aggregationSeconds
  const chartRef = useRef<HTMLDivElement>(null)
  const chartAreaRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  // Compteur de Shift+drag réussis — l'astuce est masquée à partir de 3 usages,
  // persisté dans localStorage pour ne pas réapparaître à chaque session.
  const SHIFT_HINT_KEY = 'acoustiq_shift_hint_count'
  const [shiftHintCount, setShiftHintCount] = useState<number>(() => {
    try {
      const v = localStorage.getItem(SHIFT_HINT_KEY)
      const n = v ? parseInt(v, 10) : 0
      return Number.isFinite(n) ? n : 0
    } catch {
      return 0
    }
  })
  const bumpShiftHint = useCallback(() => {
    setShiftHintCount((prev) => {
      const next = prev + 1
      try { localStorage.setItem(SHIFT_HINT_KEY, String(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  // ── Sélection non-Shift : création d'une période nommée ─────────────────
  const [periodPx, setPeriodPx] = useState<{ startX: number; endX: number } | null>(null)
  const periodStartRef = useRef<number | null>(null)
  const [periodPopup, setPeriodPopup] = useState<
    | {
        tStart: number
        tEnd: number
        name: string
        status: PeriodStatus
        color: string
        comment: string
        x: number
        y: number
      }
    | null
  >(null)
  /** Hover sur une période existante — pour afficher le commentaire d'une annotation */
  const [periodHover, setPeriodHover] = useState<
    | { period: Period; x: number; y: number }
    | null
  >(null)

  const [localHiddenLines, setLocalHiddenLines] = useState<Set<string>>(new Set())

  // ── Sélection Shift+drag ──────────────────────────────────────────────────
  const [selectionPx, setSelectionPx] = useState<{ startX: number; endX: number } | null>(null)
  const selectionStartRef = useRef<number | null>(null)
  const [selectionPopup, setSelectionPopup] = useState<
    | {
        tStart: number
        tEnd: number
        laeq: number | null
        l90: number | null
        x: number   // position pixel pour la popup
        y: number
      }
    | null
  >(null)

  // ── Menu contextuel (clic droit) ──────────────────────────────────────────
  const [chartMenu, setChartMenu] = useState<
    | { x: number; y: number; tMin: number; inSelection: boolean; nearestLaeqByPoint: Record<string, number> }
    | null
  >(null)

  // ── Comparaison ON/OFF (drag×2 dans le graphique) ─────────────────────────
  type CompPhase = 'idle' | 'pickON' | 'pickOFF' | 'done'
  type CompRange = { tStart: number; tEnd: number; laeq: number }
  const [compPhase, setCompPhase] = useState<CompPhase>('idle')
  const [compOn, setCompOn] = useState<CompRange | null>(null)
  const [compOff, setCompOff] = useState<CompRange | null>(null)
  const [compPx, setCompPx] = useState<{ startX: number; endX: number } | null>(null)
  const compStartRef = useRef<number | null>(null)

  function resetComparison() {
    setCompPhase('idle')
    setCompOn(null)
    setCompOff(null)
    setCompPx(null)
    compStartRef.current = null
  }

  // Refs miroirs pour les valeurs utilisées dans handleExportPNG (évite les
  // dépendances circulaires : effectiveRange est déclaré plus bas).
  const exportStateRef = useRef<{
    effectiveRange: ZoomRange
    aggSec: number
  }>({ effectiveRange: { startMin: 0, endMin: 1440 }, aggSec: 300 })

  // Export PNG via html2canvas — capture chart + spectrogramme embarqué (s'il est visible),
  // empile dans un canvas composite avec en-tête (projet/points/date/plage) + watermark.
  const handleExportPNG = useCallback(async () => {
    const target = chartAreaRef.current ?? chartRef.current
    if (!target) return
    setExporting(true)
    try {
      const SCALE = 2
      const opts: Parameters<typeof html2canvas>[1] = {
        backgroundColor: '#030712',
        scale: SCALE,
        useCORS: true,
        allowTaint: true,
        logging: false,
      }

      const chartCanvas = await html2canvas(target, opts)

      // Capture du spectrogramme embarqué s'il est visible dans le DOM
      const spectroEl = document.querySelector<HTMLElement>('[data-acoustiq-spectrogram="compact"]')
      let spectroCanvas: HTMLCanvasElement | null = null
      if (spectroEl && spectroEl.offsetParent !== null) {
        try {
          spectroCanvas = await html2canvas(spectroEl, opts)
        } catch {
          spectroCanvas = null
        }
      }

      // En-tête : projet, points, date, plage temporelle
      const points = [...new Set(files.map((f) => pointMap[f.id]).filter(Boolean))].sort()
      const { effectiveRange: er, aggSec: as } = exportStateRef.current
      const headerLine1 = projectName || 'AcoustiQ'
      const headerLine2 = `${points.join(' · ') || '—'} — ${selectedDate}`
      const headerLine3 = `Plage : ${minutesToHHMM(er.startMin)} → ${minutesToHHMM(er.endMin)}` +
        `   ·   Agrégation : ${as < 60 ? as + ' s' : Math.round(as / 60) + ' min'}`

      const HEADER_H = 80 * SCALE
      const GAP = 12 * SCALE
      const totalW = Math.max(chartCanvas.width, spectroCanvas?.width ?? 0)
      const totalH =
        HEADER_H +
        chartCanvas.height +
        (spectroCanvas ? GAP + spectroCanvas.height : 0)

      const composite = document.createElement('canvas')
      composite.width = totalW
      composite.height = totalH
      const ctx = composite.getContext('2d')!

      // Fond
      ctx.fillStyle = '#030712'
      ctx.fillRect(0, 0, totalW, totalH)

      // En-tête textuel
      ctx.fillStyle = '#f3f4f6'
      ctx.font = `bold ${18 * SCALE}px system-ui, sans-serif`
      ctx.textBaseline = 'top'
      ctx.fillText(headerLine1, 20 * SCALE, 12 * SCALE)
      ctx.fillStyle = '#9ca3af'
      ctx.font = `${12 * SCALE}px system-ui, sans-serif`
      ctx.fillText(headerLine2, 20 * SCALE, 38 * SCALE)
      ctx.fillStyle = '#6b7280'
      ctx.fillText(headerLine3, 20 * SCALE, 56 * SCALE)

      // Chart
      const chartX = Math.floor((totalW - chartCanvas.width) / 2)
      ctx.drawImage(chartCanvas, chartX, HEADER_H)

      // Spectrogramme
      if (spectroCanvas) {
        const sx = Math.floor((totalW - spectroCanvas.width) / 2)
        ctx.drawImage(spectroCanvas, sx, HEADER_H + chartCanvas.height + GAP)
      }

      // Watermark QR + label en bas à droite
      await drawQrBadge(composite, { scale: SCALE })

      const link = document.createElement('a')
      link.download = `acoustiq_${points.join('_') || 'chart'}_${selectedDate}.png`
      link.href = composite.toDataURL('image/png')
      link.click()
    } catch (err) {
      console.error('Export PNG échoué :', err)
    } finally {
      setExporting(false)
    }
  }, [files, pointMap, selectedDate, projectName])

  /** Mode multi-jours continu : concatène toutes les dates disponibles sur un
   *  axe temporel absolu (dayOffset × 1440 min + t). Désactivé dès qu'un
   *  overlay manuel est sélectionné ou qu'il n'y a qu'une date. */
  const isMultiDay = availableDates.length > 1 && !overlayDate

  const sortedDates = useMemo(() => [...availableDates].sort(), [availableDates])

  /** Anchor : première date de la série multi-jours (ou selectedDate sinon) */
  const anchorDate = isMultiDay ? sortedDates[0] : selectedDate

  /** Index de jour pour une date ISO donnée (0 = anchor). Utilisé pour calculer
   *  les offsets en minutes sur l'axe X absolu. */
  const dayIndexOf = useCallback((date: string): number => {
    if (!isMultiDay) return 0
    const idx = sortedDates.indexOf(date)
    return idx < 0 ? 0 : idx
  }, [isMultiDay, sortedDates])

  /** Dates effectivement affichées : toutes en mode multi-jours, sinon la
   *  principale + l'overlay éventuel (max 2). */
  const renderedDates = useMemo(() => {
    if (isMultiDay) return sortedDates
    const out = [selectedDate]
    if (overlayDate && overlayDate !== selectedDate) out.push(overlayDate)
    return out
  }, [isMultiDay, sortedDates, selectedDate, overlayDate])

  /** Map clé `${pt}|${date}` → fichiers correspondants */
  const filesByPointDate = useMemo(() => {
    const map = new Map<string, MeasurementFile[]>()
    for (const f of files) {
      const pt = pointMap[f.id]
      if (!pt || !renderedDates.includes(f.date)) continue
      const key = `${pt}|${f.date}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(f)
    }
    return map
  }, [files, pointMap, renderedDates])

  /** Liste des points présents (toutes dates confondues) */
  const pointNames = useMemo(() => {
    const set = new Set<string>()
    for (const k of filesByPointDate.keys()) set.add(k.split('|')[0])
    return [...set].sort()
  }, [filesByPointDate])

  /** Spécifications de chaque ligne à dessiner (point × date). */
  type LineSpec = {
    key: string         // dataKey unique dans chartData
    pt: string
    date: string
    isOverlay: boolean
    displayName: string
    color: string
  }
  const lineSpecs = useMemo<LineSpec[]>(() => {
    const out: LineSpec[] = []
    // En mode multi-jours continu : une seule ligne par point (agrège toutes les dates).
    if (isMultiDay) {
      pointNames.forEach((pt, i) => {
        const color = getPointColor(pt, i, pointColors)
        const label = pointLabels[pt] || pt
        out.push({
          key: pt,
          pt,
          date: anchorDate,
          isOverlay: false,
          displayName: label,
          color,
        })
      })
      return out
    }
    pointNames.forEach((pt, i) => {
      const color = getPointColor(pt, i, pointColors)
      for (const d of renderedDates) {
        if (!filesByPointDate.has(`${pt}|${d}`)) continue
        const isOverlay = d !== selectedDate
        const label = pointLabels[pt] || pt
        out.push({
          key: renderedDates.length > 1 ? `${pt}__${d}` : pt,
          pt,
          date: d,
          isOverlay,
          displayName:
            renderedDates.length > 1 ? `${label} (${shortFrDate(d)})` : label,
          color,
        })
      }
    })
    return out
  }, [isMultiDay, anchorDate, pointNames, renderedDates, filesByPointDate, selectedDate, pointColors, pointLabels])

  // Set des keys masquées : dérivé du set "par point" lifté à App, fusionné
  // avec l'état local (legacy si pas de prop).
  const hiddenLines = useMemo<Set<string>>(() => {
    const s = new Set<string>(localHiddenLines)
    if (hiddenPoints) {
      for (const spec of lineSpecs) if (hiddenPoints.has(spec.pt)) s.add(spec.key)
    }
    return s
  }, [localHiddenLines, hiddenPoints, lineSpecs])

  /** Compatibilité : "filesByPoint" pour la date principale uniquement (utilisé par sélection/comparaison) */
  const filesByPoint = useMemo(() => {
    const map = new Map<string, MeasurementFile[]>()
    for (const pt of pointNames) {
      const fs = filesByPointDate.get(`${pt}|${selectedDate}`)
      if (fs) map.set(pt, fs)
    }
    return map
  }, [filesByPointDate, pointNames, selectedDate])

  /** Calcule LAeq sur la plage [tA, tB] (raw data, jour principal, tous points visibles) */
  const laeqOverRange = useCallback(
    (tA: number, tB: number): number | null => {
      const all: number[] = []
      for (const fs of filesByPoint.values()) {
        for (const f of fs) {
          for (const dp of f.data) {
            if (dp.t >= tA && dp.t <= tB) all.push(dp.laeq)
          }
        }
      }
      return all.length > 0 ? laeqAvg(all) : null
    },
    [filesByPoint],
  )

  /** Nombre total de points bruts pour la journée principale — pour l'avertissement haute résolution */
  const rawPointCount = useMemo(() => {
    let n = 0
    for (const fs of filesByPoint.values())
      for (const f of fs) n += f.data.length
    return n
  }, [filesByPoint])

  // Construction des données du graphique (buckets configurables, en secondes)
  // Chaque entrée porte un champ par LineSpec.key (point × date).
  const chartData = useMemo((): ChartEntry[] => {
    const buckets = new Map<number, Map<string, number[]>>()

    if (isMultiDay) {
      // Mode multi-jours : agrège toutes les dates sur un axe absolu (dayOffset*1440 + dp.t)
      for (const spec of lineSpecs) {
        for (const d of sortedDates) {
          const fs = filesByPointDate.get(`${spec.pt}|${d}`) ?? []
          const offset = dayIndexOf(d) * 1440
          for (const f of fs) {
            for (const dp of f.data) {
              if (!Number.isFinite(dp.t) || !Number.isFinite(dp.laeq)) continue
              const tSec = Math.round((dp.t + offset) * 60)
              const bucketSec = Math.floor(tSec / aggSec) * aggSec
              if (!buckets.has(bucketSec)) buckets.set(bucketSec, new Map())
              const keyBucket = buckets.get(bucketSec)!
              if (!keyBucket.has(spec.key)) keyBucket.set(spec.key, [])
              keyBucket.get(spec.key)!.push(dp.laeq)
            }
          }
        }
      }
    } else {
      for (const spec of lineSpecs) {
        const fs = filesByPointDate.get(`${spec.pt}|${spec.date}`) ?? []
        for (const f of fs) {
          for (const dp of f.data) {
            // Garde défensive : ignorer les datapoints sans temps ou laeq valides
            if (!Number.isFinite(dp.t) || !Number.isFinite(dp.laeq)) continue
            const tSec = Math.round(dp.t * 60)
            const bucketSec = Math.floor(tSec / aggSec) * aggSec
            if (!buckets.has(bucketSec)) buckets.set(bucketSec, new Map())
            const keyBucket = buckets.get(bucketSec)!
            if (!keyBucket.has(spec.key)) keyBucket.set(spec.key, [])
            keyBucket.get(spec.key)!.push(dp.laeq)
          }
        }
      }
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([bucketSec, keyMap]) => {
        const tMin = bucketSec / 60
        const entry: ChartEntry = {
          t: tMin,
          label: aggSec < 60 ? minutesToHHMMSS(tMin) : minutesToHHMM(tMin),
        }
        for (const [k, vals] of keyMap) {
          entry[k] = Math.round(laeqAvg(vals) * 10) / 10
        }
        return entry
      })
  }, [lineSpecs, filesByPointDate, aggSec, isMultiDay, sortedDates, dayIndexOf])

  // ── Données vent injectées dans chartData (clé "_wind") ──────────────────
  // Modèle simple : une seule valeur saisie → ligne plate sur toute la période.
  // (Une future version pourra accepter meteo.windEntries[] pour des plages.)
  const windSpeed = meteo?.windSpeed ?? null
  const windInvalid = windSpeed !== null && windSpeed >= 20

  const chartDataWithWind = useMemo<ChartEntry[]>(() => {
    if (windSpeed === null) return chartData
    return chartData.map((row) => ({ ...row, _wind: windSpeed } as ChartEntry))
  }, [chartData, windSpeed])

  // Plage temporelle globale des données (en minutes).
  // En mode multi-jours, étend à l'intervalle complet [0, N*1440] pour que
  // les séparateurs de minuit et les zones de gap soient toujours visibles.
  const fullRange = useMemo((): ZoomRange => {
    if (isMultiDay) {
      const span = Math.max(1, sortedDates.length) * 1440
      return { startMin: 0, endMin: span }
    }
    if (chartData.length === 0) return { startMin: 0, endMin: 1440 }
    return {
      startMin: chartData[0].t,
      endMin: chartData[chartData.length - 1].t,
    }
  }, [chartData, isMultiDay, sortedDates.length])

  // Plage effective (zoom ou pleine)
  const effectiveRange = zoomRange ?? fullRange

  // Synchronisation des refs pour l'export PNG (déclaré plus haut)
  exportStateRef.current.effectiveRange = effectiveRange
  exportStateRef.current.aggSec = aggSec

  // Données filtrées par la plage de zoom, sous-échantillonnées à max 2000 points
  // Décimation min/max pour conserver les pics et les creux
  const visibleData = useMemo(() => {
    const filtered = chartDataWithWind.filter(
      (d) => d.t >= effectiveRange.startMin && d.t <= effectiveRange.endMin,
    )
    const MAX_DISPLAY = 2000
    if (filtered.length <= MAX_DISPLAY) return filtered

    const binCount = Math.floor(MAX_DISPLAY / 2)
    const binSize = filtered.length / binCount
    const sampled: ChartEntry[] = []

    for (let b = 0; b < binCount; b++) {
      const start = Math.floor(b * binSize)
      const end = Math.min(Math.floor((b + 1) * binSize), filtered.length)
      if (start >= end) continue

      let minIdx = start, maxIdx = start
      const firstKey = lineSpecs[0]?.key
      if (firstKey) {
        let minVal = Infinity, maxVal = -Infinity
        for (let i = start; i < end; i++) {
          const v = filtered[i][firstKey]
          const n = typeof v === 'number' ? v : 0
          if (n < minVal) { minVal = n; minIdx = i }
          if (n > maxVal) { maxVal = n; maxIdx = i }
        }
      }

      if (minIdx <= maxIdx) {
        sampled.push(filtered[minIdx])
        if (minIdx !== maxIdx) sampled.push(filtered[maxIdx])
      } else {
        sampled.push(filtered[maxIdx])
        if (minIdx !== maxIdx) sampled.push(filtered[minIdx])
      }
    }

    return sampled
  }, [chartDataWithWind, effectiveRange, lineSpecs])

  // ── Axe Y auto-ajusté ────────────────────────────────────────────────────
  const isZoomed = zoomRange !== null
  const yDomain = useMemo<[number, number]>(() => {
    if (!isZoomed || visibleData.length === 0) return [settingsYMin, settingsYMax]
    let lo = Infinity, hi = -Infinity
    for (const row of visibleData) {
      for (const spec of lineSpecs) {
        if (hiddenLines.has(spec.key)) continue
        const v = row[spec.key]
        if (typeof v === 'number') {
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [settingsYMin, settingsYMax]
    // ±5 dB de marge selon la spec
    return [Math.floor(lo - 5), Math.ceil(hi + 5)]
  }, [isZoomed, visibleData, lineSpecs, hiddenLines, settingsYMin, settingsYMax])

  // Ticks adaptatifs sur l'axe X
  const adaptiveTicks = useMemo(
    () => computeAdaptiveTicks(visibleData, effectiveRange.endMin - effectiveRange.startMin, aggSec),
    [visibleData, effectiveRange, aggSec],
  )

  /** Formate un temps absolu (minutes) en HH:MM ou DD/MM HH:MM selon le mode
   *  et la portée visible. En multi-jours et vue large (> 1 j) : DD/MM HH:MM.
   *  Sinon : HH:MM. */
  const formatAxisLabel = useCallback((tMin: number): string => {
    const hhmm = minutesToHHMM(((tMin % 1440) + 1440) % 1440)
    if (!isMultiDay) return hhmm
    const spanMin = effectiveRange.endMin - effectiveRange.startMin
    if (spanMin <= 1440 * 1.1) return hhmm
    const dayIdx = Math.floor(tMin / 1440)
    const dateIso = sortedDates[dayIdx] ?? sortedDates[0]
    return `${shortSlashDate(dateIso)} ${hhmm}`
  }, [isMultiDay, sortedDates, effectiveRange])

  /** Ticks numériques (minutes absolues) pour l'axe numeric. Fallback sur les
   *  ticks adaptatifs HH:MM si pas en multi-jours. */
  const numericTicks = useMemo<number[]>(() => {
    if (!isMultiDay) return []
    const span = effectiveRange.endMin - effectiveRange.startMin
    // Stride en minutes : 1h, 3h, 6h, 12h, 24h selon la portée
    let stride: number
    if (span <= 60 * 2) stride = 10
    else if (span <= 60 * 6) stride = 30
    else if (span <= 60 * 12) stride = 60
    else if (span <= 60 * 24) stride = 120
    else if (span <= 60 * 72) stride = 360
    else stride = 720
    const out: number[] = []
    const start = Math.ceil(effectiveRange.startMin / stride) * stride
    for (let t = start; t <= effectiveRange.endMin; t += stride) out.push(t)
    if (out.length > 16) return out.filter((_, i) => i % Math.ceil(out.length / 16) === 0)
    return out
  }, [isMultiDay, effectiveRange])

  /** Zones de discontinuité : périodes > 60 min sans données entre deux buckets.
   *  Ne s'applique qu'en mode multi-jours (utile typiquement pour les gaps de
   *  nuit entre des sessions consécutives). */
  const gapZones = useMemo<Array<{ start: number; end: number; gapMin: number }>>(() => {
    if (!isMultiDay || chartData.length < 2) return []
    const GAP_THRESHOLD = 60 // minutes
    const out: Array<{ start: number; end: number; gapMin: number }> = []
    for (let i = 1; i < chartData.length; i++) {
      const delta = chartData[i].t - chartData[i - 1].t
      if (delta > GAP_THRESHOLD) {
        out.push({
          start: chartData[i - 1].t + aggSec / 60,
          end: chartData[i].t,
          gapMin: delta,
        })
      }
    }
    return out
  }, [isMultiDay, chartData, aggSec])

  // Dernière valeur visible par ligne — pour les étiquettes "collantes"
  const lastValueByKey = useMemo(() => {
    const out: Record<string, number> = {}
    for (const spec of lineSpecs) {
      for (let i = visibleData.length - 1; i >= 0; i--) {
        const v = visibleData[i][spec.key]
        if (typeof v === 'number') {
          out[spec.key] = v
          break
        }
      }
    }
    return out
  }, [visibleData, lineSpecs])

  /** Ancre epoch ms correspondant à l'axe X du graphique (minute 0 = ancre). */
  const chartAnchorMs = useMemo(() => {
    const iso = isMultiDay ? anchorDate : selectedDate
    return dateMsMidnight(iso)
  }, [isMultiDay, anchorDate, selectedDate])

  /** Pour une période, retourne ses bornes dans la coord X du graphique, ou null. */
  const periodBounds = useCallback((p: Period): [number, number] | null => {
    if (!Number.isFinite(chartAnchorMs)) return null
    const startMin = (p.startMs - chartAnchorMs) / 60_000
    const endMin = (p.endMs - chartAnchorMs) / 60_000
    if (endMin < fullRange.startMin || startMin > fullRange.endMin) return null
    return [Math.max(fullRange.startMin, startMin), Math.min(fullRange.endMin, endMin)]
  }, [chartAnchorMs, fullRange])

  /** Retourne la période couvrant un temps (en minutes chart X), ou null. */
  const periodAtChartMin = useCallback((tMin: number): Period | null => {
    if (!periods || !Number.isFinite(chartAnchorMs)) return null
    const ts = chartAnchorMs + tMin * 60_000
    for (const p of periods) {
      if (ts >= p.startMs && ts < p.endMs) return p
    }
    return null
  }, [periods, chartAnchorMs])

  // Événements filtrés pour la journée affichée (multi-jours : toutes les dates visibles)
  const activeEvents = useMemo(
    () => isMultiDay
      ? events.filter((ev) => sortedDates.includes(ev.day))
      : events.filter((ev) => ev.day === selectedDate),
    [events, selectedDate, isMultiDay, sortedDates],
  )

  // Niveau de zoom (×n) — global span / visible span
  const zoomLevel = useMemo(() => {
    const globalSpan = fullRange.endMin - fullRange.startMin
    const visibleSpan = effectiveRange.endMin - effectiveRange.startMin
    if (visibleSpan <= 0) return 1
    return globalSpan / visibleSpan
  }, [fullRange, effectiveRange])

  // ── Helpers de conversion pixel ↔ minute ─────────────────────────────────
  /** Convertit une coordonnée X (relative à chartAreaRef) en minute */
  const xPxToMinutes = useCallback(
    (xPx: number): number => {
      const rect = chartAreaRef.current?.getBoundingClientRect()
      if (!rect) return effectiveRange.startMin
      // Recharts utilise une marge interne (~64 px gauche pour Y axis et ~24 droite).
      // On approxime grossièrement avec les marges visuelles.
      const PAD_LEFT = 64
      const PAD_RIGHT = 24
      const usable = Math.max(1, rect.width - PAD_LEFT - PAD_RIGHT)
      const frac = Math.max(0, Math.min(1, (xPx - PAD_LEFT) / usable))
      return effectiveRange.startMin + frac * (effectiveRange.endMin - effectiveRange.startMin)
    },
    [effectiveRange],
  )

  // --- Gestionnaires zoom/pan ---

  // Zoom centré sur la position du curseur (Ctrl + molette uniquement)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey) return  // molette seule = scroll normal de la page
    e.preventDefault()
    const rect = chartAreaRef.current?.getBoundingClientRect()
    if (!rect) return

    const range = effectiveRange
    const span = range.endMin - range.startMin
    const cursorFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const cursorMin = range.startMin + cursorFrac * span

    const factor = e.deltaY > 0 ? 1.3 : 0.7
    const globalSpan = fullRange.endMin - fullRange.startMin
    const newSpan = Math.max(MIN_ZOOM_SPAN, Math.min(globalSpan, span * factor))

    if (newSpan >= globalSpan) {
      onZoomChange(null)
      return
    }

    let newStart = cursorMin - cursorFrac * newSpan
    let newEnd = cursorMin + (1 - cursorFrac) * newSpan

    if (newStart < fullRange.startMin) {
      newStart = fullRange.startMin
      newEnd = newStart + newSpan
    }
    if (newEnd > fullRange.endMin) {
      newEnd = fullRange.endMin
      newStart = newEnd - newSpan
    }

    onZoomChange({
      startMin: Math.max(fullRange.startMin, newStart),
      endMin: Math.min(fullRange.endMin, newEnd),
    })
  }, [effectiveRange, fullRange, onZoomChange])

  // Mouse down : délègue au handler selon le mode d'interaction courant.
  // Priorités (du plus prioritaire au plus bas) :
  //   1. Calage audio POINTAGE armé   → clic simple = capture minute
  //   2. Calage audio RANGE armé      → drag = capture [start, end]
  //      (doit passer AVANT audio-seek pour ne pas être intercepté)
  //   3. Annotation en attente        → clic = place annotation
  //   4. Comparaison ON/OFF en cours  → drag
  //   5. Audio en lecture + couvert   → clic simple = seek
  //   6. Shift + drag                  → mesure LAeq/L90
  //   7. Drag simple                   → création de période (défaut)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    const rect = chartAreaRef.current?.getBoundingClientRect()
    if (!rect) return
    const xLocal = e.clientX - rect.left

    // 1. Calage audio Pointage armé : simple clic = capture minute
    if (chartPickArmed && onChartPicked) {
      const tMin = xPxToMinutes(xLocal)
      onChartPicked(tMin)
      return
    }

    // 2. Calage audio Auto RMS armé : drag = capture une plage
    //    ⚠ doit être traité AVANT l'audio-seek pour que le drag ne soit pas
    //    préempté quand l'audio est en lecture sur un fichier couvrant.
    if (chartRangePickArmed) {
      periodStartRef.current = xLocal
      setPeriodPx({ startX: xLocal, endX: xLocal })
      setPeriodPopup(null)
      return
    }

    // Placement d'annotation en attente : transformer le clic en placement
    if (pendingAnnotationText) {
      const tMin = xPxToMinutes(xLocal)
      // Trouver le point de données le plus proche pour caler le Y sur la courbe
      let nearestY = (yDomain[0] + yDomain[1]) / 2
      let bestDist = Infinity
      for (const row of chartData) {
        const dt = Math.abs(row.t - tMin)
        if (dt < bestDist) {
          bestDist = dt
          // Premier point disponible
          for (const spec of lineSpecs) {
            const v = row[spec.key]
            if (typeof v === 'number') { nearestY = v; break }
          }
        }
      }
      const h = Math.floor(tMin / 60) % 24
      const m = Math.round(tMin % 60)
      const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      onAnnotationPlace({
        id: crypto.randomUUID(),
        text: pendingAnnotationText,
        time,
        day: selectedDate,
        laeq: Math.round(nearestY * 10) / 10,
        color: '#fbbf24',
      })
      onPendingAnnotationCleared()
      return
    }

    // Mode comparaison : drag = sélection ON puis OFF
    if (compPhase === 'pickON' || compPhase === 'pickOFF') {
      compStartRef.current = xLocal
      setCompPx({ startX: xLocal, endX: xLocal })
      return
    }

    // Audio en lecture sur une plage couverte → clic simple = seek
    if (audioPlaying && audioCoverage && audioCoverage.length > 0 && !e.shiftKey) {
      const tMin = xPxToMinutes(xLocal)
      const r = findCoveringRange(audioCoverage, tMin)
      if (r && onAudioSeekMin) {
        onAudioSeekMin(tMin)
        return
      }
    }

    if (e.shiftKey) {
      selectionStartRef.current = xLocal
      setSelectionPx({ startX: xLocal, endX: xLocal })
      setSelectionPopup(null)
      return
    }

    // Drag sans Shift : création d'une période nommée
    periodStartRef.current = xLocal
    setPeriodPx({ startX: xLocal, endX: xLocal })
    setPeriodPopup(null)
  }, [compPhase, pendingAnnotationText, xPxToMinutes, chartData, lineSpecs, yDomain, selectedDate, onAnnotationPlace, onPendingAnnotationCleared, chartPickArmed, onChartPicked, chartRangePickArmed, audioPlaying, audioCoverage, onAudioSeekMin])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = chartAreaRef.current?.getBoundingClientRect()
    if (!rect) return
    const xLocal = e.clientX - rect.left
    const yLocal = e.clientY - rect.top

    // Comparaison ON/OFF en cours ?
    if (compStartRef.current !== null) {
      setCompPx({
        startX: compStartRef.current,
        endX: xLocal,
      })
      return
    }

    // En cours de sélection Shift (mesure LAeq/L90) ?
    if (selectionStartRef.current !== null) {
      setSelectionPx({
        startX: selectionStartRef.current,
        endX: xLocal,
      })
      return
    }

    // En cours de sélection de période (drag sans Shift) ?
    if (periodStartRef.current !== null) {
      setPeriodPx({
        startX: periodStartRef.current,
        endX: xLocal,
      })
      return
    }

    // Survol d'une période annotée → affichage du commentaire
    const tMin = xPxToMinutes(xLocal)
    const p = periodAtChartMin(tMin)
    if (p && p.status === 'annotate') {
      setPeriodHover({ period: p, x: xLocal, y: yLocal })
    } else if (periodHover) {
      setPeriodHover(null)
    }
  }, [xPxToMinutes, periodAtChartMin, periodHover])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Finaliser une sélection ON/OFF
    if (compStartRef.current !== null && compPx) {
      const xA = compPx.startX
      const xB = compPx.endX
      compStartRef.current = null
      if (Math.abs(xB - xA) < 4) {
        setCompPx(null)
        return
      }
      const tA = xPxToMinutes(Math.min(xA, xB))
      const tB = xPxToMinutes(Math.max(xA, xB))
      const laeq = laeqOverRange(tA, tB)
      setCompPx(null)
      if (laeq === null) return
      const range: CompRange = { tStart: tA, tEnd: tB, laeq }
      if (compPhase === 'pickON') {
        setCompOn(range)
        setCompPhase('pickOFF')
      } else if (compPhase === 'pickOFF') {
        setCompOff(range)
        setCompPhase('done')
      }
      return
    }

    // Finaliser une sélection
    if (selectionStartRef.current !== null && selectionPx) {
      const rect = chartAreaRef.current?.getBoundingClientRect()
      const xA = selectionPx.startX
      const xB = selectionPx.endX
      selectionStartRef.current = null

      // Sélection trop courte → annuler
      if (Math.abs(xB - xA) < 4) {
        setSelectionPx(null)
        return
      }

      const tA = xPxToMinutes(Math.min(xA, xB))
      const tB = xPxToMinutes(Math.max(xA, xB))

      // Calcul LAeq / L90 sur les données BRUTES dans la plage
      const allLaeq: number[] = []
      for (const fs of filesByPoint.values()) {
        for (const f of fs) {
          for (const dp of f.data) {
            if (dp.t >= tA && dp.t <= tB) allLaeq.push(dp.laeq)
          }
        }
      }
      const laeq = allLaeq.length > 0 ? laeqAvg(allLaeq) : null
      const l90 = allLaeq.length > 0 ? computeL90(allLaeq) : null

      // Position popup : milieu de la sélection, juste sous la barre supérieure
      const midX = (xA + xB) / 2
      const popupY = rect ? Math.max(8, e.clientY - rect.top - 4) : 40
      setSelectionPopup({ tStart: tA, tEnd: tB, laeq, l90, x: midX, y: popupY })
      bumpShiftHint()
      return
    }

    // Finaliser une sélection de période (ou un pick de plage armé)
    if (periodStartRef.current !== null && periodPx) {
      const rect = chartAreaRef.current?.getBoundingClientRect()
      const xA = periodPx.startX
      const xB = periodPx.endX
      periodStartRef.current = null
      if (Math.abs(xB - xA) < 4) {
        setPeriodPx(null)
        return
      }
      const tA = xPxToMinutes(Math.min(xA, xB))
      const tB = xPxToMinutes(Math.max(xA, xB))

      // Si le chart est armé pour un pick de plage (Auto RMS du calage),
      // court-circuite la création de période et remonte directement [tA, tB]
      // au demandeur.
      if (chartRangePickArmed && onChartRangePicked) {
        setPeriodPx(null)
        onChartRangePicked(tA, tB)
        return
      }

      const midX = (xA + xB) / 2
      const popupY = rect ? Math.max(8, e.clientY - rect.top - 4) : 40
      setPeriodPopup({
        tStart: tA, tEnd: tB,
        name: `Période ${(periods?.length ?? 0) + 1}`,
        status: 'include',
        color: PERIOD_PALETTE[((periods?.length ?? 0)) % PERIOD_PALETTE.length],
        comment: '',
        x: midX, y: popupY,
      })
      return
    }
  }, [selectionPx, periodPx, xPxToMinutes, filesByPoint, compPx, compPhase, laeqOverRange, periods, chartRangePickArmed, onChartRangePicked])

  const handleMouseLeave = useCallback(() => {
    // Ne pas annuler une sélection en cours : l'utilisateur peut sortir de la zone
    setPeriodHover(null)
  }, [])

  // Double-clic = lecture audio si couvert, sinon reset zoom
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (audioCoverage && audioCoverage.length > 0 && onAudioPlayAt) {
      const rect = chartAreaRef.current?.getBoundingClientRect()
      if (rect) {
        const xLocal = e.clientX - rect.left
        const tMin = xPxToMinutes(xLocal)
        const r = findCoveringRange(audioCoverage, tMin)
        if (r) {
          // Saute 5 s avant (si possible) pour laisser le contexte
          const offsetMin = Math.max(r.startMin, tMin - 5 / 60)
          onAudioPlayAt(r.entryId, offsetMin)
          return
        }
      }
    }
    onZoomChange(null)
  }, [onZoomChange, audioCoverage, onAudioPlayAt, xPxToMinutes])

  // Boutons zoom +/-
  const handleZoomIn = useCallback(() => {
    const range = effectiveRange
    const span = range.endMin - range.startMin
    const newSpan = Math.max(MIN_ZOOM_SPAN, span * 0.6)
    const center = (range.startMin + range.endMin) / 2
    onZoomChange({
      startMin: Math.max(fullRange.startMin, center - newSpan / 2),
      endMin: Math.min(fullRange.endMin, center + newSpan / 2),
    })
  }, [effectiveRange, fullRange, onZoomChange])

  const handleZoomOut = useCallback(() => {
    const range = effectiveRange
    const span = range.endMin - range.startMin
    const newSpan = span * 1.5
    const globalSpan = fullRange.endMin - fullRange.startMin
    if (newSpan >= globalSpan) {
      onZoomChange(null)
      return
    }
    const center = (range.startMin + range.endMin) / 2
    let newStart = center - newSpan / 2
    let newEnd = center + newSpan / 2
    if (newStart < fullRange.startMin) {
      newStart = fullRange.startMin
      newEnd = newStart + newSpan
    }
    if (newEnd > fullRange.endMin) {
      newEnd = fullRange.endMin
      newStart = newEnd - newSpan
    }
    onZoomChange({
      startMin: Math.max(fullRange.startMin, newStart),
      endMin: Math.min(fullRange.endMin, newEnd),
    })
  }, [effectiveRange, fullRange, onZoomChange])

  const handleReset = useCallback(() => {
    onZoomChange(null)
  }, [onZoomChange])

  // Écouter les événements de zoom clavier depuis App
  useEffect(() => {
    const onZoomInE = () => handleZoomIn()
    const onZoomOutE = () => handleZoomOut()
    document.addEventListener('acoustiq:zoom-in', onZoomInE)
    document.addEventListener('acoustiq:zoom-out', onZoomOutE)
    return () => {
      document.removeEventListener('acoustiq:zoom-in', onZoomInE)
      document.removeEventListener('acoustiq:zoom-out', onZoomOutE)
    }
  }, [handleZoomIn, handleZoomOut])

  // Auto-scroll : si le curseur de lecture sort de la plage visible (zoomée),
  // recentrer la plage autour du curseur en préservant le span.
  useEffect(() => {
    if (!isZoomed || audioPlayheadMin === null || audioPlayheadMin === undefined) return
    if (audioPlayheadMin >= effectiveRange.startMin && audioPlayheadMin <= effectiveRange.endMin) return
    const span = effectiveRange.endMin - effectiveRange.startMin
    let newStart = audioPlayheadMin - span / 2
    let newEnd = newStart + span
    if (newStart < fullRange.startMin) { newStart = fullRange.startMin; newEnd = newStart + span }
    if (newEnd > fullRange.endMin) { newEnd = fullRange.endMin; newStart = newEnd - span }
    onZoomChange({ startMin: newStart, endMin: newEnd })
  }, [audioPlayheadMin, effectiveRange.startMin, effectiveRange.endMin, fullRange.startMin, fullRange.endMin, isZoomed, onZoomChange])

  // Fermer la popup au clic extérieur ou à Échap
  useEffect(() => {
    if (!selectionPopup) return
    function handleDocClick(e: MouseEvent) {
      const popup = document.getElementById('acoustiq-selection-popup')
      if (popup && !popup.contains(e.target as Node)) {
        setSelectionPopup(null)
        setSelectionPx(null)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSelectionPopup(null)
        setSelectionPx(null)
      }
    }
    document.addEventListener('mousedown', handleDocClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDocClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [selectionPopup])

  // Avertissement haute résolution
  const HIGH_RES_THRESHOLD = 10000
  const showHighResWarning = aggSec <= 5 && rawPointCount > HIGH_RES_THRESHOLD

  if (pointNames.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Aucune donnée à afficher pour la journée sélectionnée.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Barre de contrôle : sélecteur de jour + agrégation + zoom + export */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-800 shrink-0 flex-wrap">
        {availableDates.length > 1 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <label className="text-xs text-gray-400 font-medium mr-1">Journée</label>
            {availableDates.map((d) => {
              const isPrimary = d === selectedDate
              const isOverlay = d === overlayDate && !isPrimary
              return (
                <div
                  key={d}
                  className={`flex items-center rounded border transition-colors ${
                    isPrimary
                      ? 'bg-emerald-700 border-emerald-600 text-white'
                      : isOverlay
                      ? 'bg-gray-800 border-emerald-700/60 text-emerald-300'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <button
                    onClick={() => {
                      if (!isPrimary) {
                        if (overlayDate === d) onOverlayDateChange(null)
                        onDateChange(d)
                      }
                    }}
                    className="text-xs px-2 py-1"
                    title={isPrimary ? 'Journée principale' : 'Sélectionner comme journée principale'}
                  >
                    {shortFrDate(d)}
                  </button>
                  {!isPrimary && (
                    <button
                      onClick={() => {
                        if (isOverlay) onOverlayDateChange(null)
                        else onOverlayDateChange(d)
                      }}
                      className="px-1 py-1 border-l border-gray-700/70 hover:bg-gray-700/40"
                      title={isOverlay ? 'Retirer la superposition' : 'Superposer ce jour'}
                      aria-label={isOverlay ? `Retirer ${d} de la superposition` : `Superposer ${d}`}
                    >
                      <Layers size={11} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <span className="text-xs text-gray-500">{selectedDate}</span>
        )}

        {/* Info instrument : modèle + n° de série (principal) — utile pour
            retrouver un fichier en un coup d'œil. */}
        {(() => {
          const primary = files.find((f) => f.date === selectedDate) ?? files[0]
          if (!primary) return null
          const label = primary.model && primary.serial
            ? `${primary.model} ${primary.serial}`
            : primary.serial || primary.model || '—'
          return (
            <span
              className="text-xs text-gray-300 font-medium px-2 py-0.5 rounded bg-gray-800/60 border border-gray-700"
              title={`Modèle : ${primary.model || '—'} · N° de série : ${primary.serial || '—'}`}
            >
              {label}
              <span className="ml-1 text-gray-500 font-normal">(série)</span>
            </span>
          )
        })()}

        {/* Sélecteur d'agrégation */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-gray-500">Agrégation</label>
          <select
            value={aggSec}
            onChange={(e) => onAggregationChange(Number(e.target.value))}
            className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                       px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            title="Pas d'agrégation des données affichées"
          >
            {AGGREGATION_OPTIONS.map((opt) => (
              <option key={opt.seconds} value={opt.seconds}>{opt.label}</option>
            ))}
          </select>
          {showHighResWarning && (
            <span
              className="flex items-center gap-1 text-[10px] text-amber-400 ml-1"
              title={`${rawPointCount.toLocaleString('fr-FR')} points bruts — l'affichage peut être lent`}
            >
              <AlertTriangle size={11} />
              rendu lent possible
            </span>
          )}
        </div>

        {/* Durée totale + plage visible (se met à jour avec le zoom). */}
        {(() => {
          const fullSpanMin = fullRange.endMin - fullRange.startMin
          const visSpanMin = effectiveRange.endMin - effectiveRange.startMin
          const fmt = (m: number) => {
            const h = Math.floor(m / 60)
            const mm = Math.round(m % 60)
            return h > 0 ? `${h}h ${String(mm).padStart(2, '0')}m` : `${mm}m`
          }
          return (
            <span className="text-xs text-gray-400">
              <span className="text-gray-500">Durée :</span>{' '}
              <span className="font-mono text-gray-300" title={`Plage complète : ${minutesToHHMM(fullRange.startMin)} → ${minutesToHHMM(fullRange.endMin)}`}>
                {fmt(fullSpanMin)}
              </span>
              {' · '}
              <span className="text-gray-500">Plage :</span>{' '}
              <span className={`font-mono ${isZoomed ? 'text-emerald-300' : 'text-gray-300'}`}>
                {minutesToHHMM(effectiveRange.startMin)} → {minutesToHHMM(effectiveRange.endMin)}
              </span>
              {isZoomed && (
                <span className="ml-1 text-[10px] text-gray-500">
                  ({fmt(visSpanMin)})
                </span>
              )}
              {activeEvents.length > 0 && (
                <span className="ml-2 text-gray-500">· {activeEvents.length} évén.</span>
              )}
            </span>
          )
        })()}

        {/* Zone « Navigation » : zoom + plein écran (groupée à droite) */}
        <div className="ml-auto flex items-center gap-1 border-r border-gray-800 pr-2 mr-1">
          <button
            onClick={handleZoomIn}
            className="p-1 rounded text-gray-400 hover:text-gray-100 hover:bg-gray-800
                       border border-transparent hover:border-gray-600 transition-colors"
            title="Zoom +"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1 rounded text-gray-400 hover:text-gray-100 hover:bg-gray-800
                       border border-transparent hover:border-gray-600 transition-colors"
            title="Zoom −"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={handleReset}
            disabled={!isZoomed}
            className={`p-1 rounded border transition-colors ${
              isZoomed
                ? 'text-emerald-400 hover:text-emerald-300 hover:bg-gray-800 border-transparent hover:border-gray-600'
                : 'text-gray-700 border-transparent cursor-default'
            }`}
            title="Réinitialiser le zoom"
          >
            <Maximize2 size={14} />
          </button>
          {onPresentationToggle && (
            <button
              onClick={onPresentationToggle}
              className="p-1 rounded text-gray-400 hover:text-gray-100 hover:bg-gray-800
                         border border-transparent hover:border-gray-600 transition-colors"
              title={presentationMode ? 'Quitter le mode plein écran (Échap)' : 'Plein écran'}
              aria-label={presentationMode ? 'Quitter' : 'Plein écran'}
            >
              {presentationMode ? <Minimize size={14} /> : <Maximize size={14} />}
            </button>
          )}
        </div>

        {/* Zone « Actions » : Comparer ON/OFF + Météo + Exporter ▼ */}
        <div className="flex items-center gap-1.5">
          {/* Toggle Météo (vent) */}
          {windSpeed !== null && (
            <button
              onClick={() => setShowWind((v) => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors ${
                showWind
                  ? 'bg-gray-700 text-gray-100 border-gray-500'
                  : 'bg-gray-800 text-gray-400 hover:text-gray-200 border-gray-600'
              }`}
              title={
                windInvalid
                  ? `Vent : ${windSpeed} km/h — ≥ 20 km/h, mesures potentiellement invalides`
                  : `Vent : ${windSpeed} km/h — conforme MELCCFP (< 20 km/h)`
              }
              aria-pressed={showWind}
            >
              <Wind size={12} className={windInvalid ? 'text-rose-400' : 'text-emerald-400'} />
              Météo
            </button>
          )}
          {compPhase === 'idle' ? (
            <button
              onClick={() => setCompPhase('pickON')}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                         bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                         border border-gray-600 transition-colors"
              title="Compare deux plages temporelles (Source ON vs OFF)"
            >
              <GitCompare size={12} />
              Comparer ON/OFF
            </button>
          ) : (
            <button
              onClick={resetComparison}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                         bg-rose-900/40 text-rose-300 hover:bg-rose-900/60
                         border border-rose-800/60 transition-colors"
            >
              <X size={12} />
              Annuler comparaison
            </button>
          )}

          {/* Dropdown Exporter — regroupe PNG + Excel + Rapport */}
          <div className="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              disabled={exporting}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                         bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                         border border-gray-600 transition-colors disabled:opacity-50"
              aria-haspopup="menu"
              aria-expanded={exportOpen}
            >
              <Download size={12} />
              {exporting ? 'Export…' : 'Exporter'}
              <ChevronDown size={11} className="text-gray-500" />
            </button>
            {exportOpen && !exporting && (
              <>
                {/* Zone de clic extérieur pour fermer */}
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 w-64 rounded-md border border-gray-700
                             bg-gray-900 shadow-xl z-20 py-1"
                >
                  <button
                    onClick={() => { setExportOpen(false); void handleExportPNG() }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 flex items-center gap-2"
                    role="menuitem"
                  >
                    <Download size={12} className="text-emerald-400" />
                    Exporter le graphique en PNG
                  </button>
                  <button
                    onClick={() => {
                      setExportOpen(false)
                      document.dispatchEvent(new CustomEvent('acoustiq:export-indices'))
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 flex items-center gap-2"
                    role="menuitem"
                  >
                    <Download size={12} className="text-emerald-400" />
                    Exporter les indices en Excel
                  </button>
                  <button
                    onClick={() => {
                      setExportOpen(false)
                      document.dispatchEvent(new CustomEvent('acoustiq:export-raw-data'))
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 flex items-center gap-2"
                    role="menuitem"
                  >
                    <Download size={12} className="text-emerald-400" />
                    Exporter les données brutes en Excel
                  </button>
                  <div className="border-t border-gray-800 my-1" />
                  <button
                    onClick={() => {
                      setExportOpen(false)
                      document.dispatchEvent(new CustomEvent('acoustiq:open-report'))
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-800 flex items-center gap-2"
                    role="menuitem"
                  >
                    <Download size={12} className="text-blue-400" />
                    Générer le rapport complet…
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Indice : Shift+drag — masqué après 3 utilisations (persisté localStorage) */}
      {shiftHintCount < 3 && (
        <div className="px-6 pt-1 text-[10px] text-gray-600 select-none shrink-0">
          Astuce : <kbd className="px-1 py-0.5 bg-gray-800 border border-gray-700 rounded">Shift</kbd>+glisser pour mesurer LAeq/L90 sur une plage.
        </div>
      )}

      {/* Graphique avec zoom/pan/sélection interactif */}
      <div
        ref={chartAreaRef}
        className={`relative flex-1 min-h-0 ${
          pendingAnnotationText || compPhase === 'pickON' || compPhase === 'pickOFF' || chartPickArmed || chartRangePickArmed
            ? 'cursor-crosshair'
            : periodStartRef.current !== null || selectionStartRef.current !== null
            ? 'cursor-col-resize'
            : 'cursor-default'
        }`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault()
          const rect = chartAreaRef.current?.getBoundingClientRect()
          if (!rect) return
          const xLocal = e.clientX - rect.left
          const yLocal = e.clientY - rect.top
          const tMin = xPxToMinutes(xLocal)
          // Plage sélectionnée courante ?
          const inSelection = !!selectionPopup &&
            tMin >= selectionPopup.tStart && tMin <= selectionPopup.tEnd
          // LAeq proche par point
          const nearestLaeqByPoint: Record<string, number> = {}
          if (visibleData.length > 0) {
            let best = visibleData[0]
            let bestDist = Math.abs(best.t - tMin)
            for (const d of visibleData) {
              const dist = Math.abs(d.t - tMin)
              if (dist < bestDist) { best = d; bestDist = dist }
            }
            for (const spec of lineSpecs) {
              const v = (best as unknown as Record<string, unknown>)[spec.key]
              if (typeof v === 'number') nearestLaeqByPoint[spec.pt] = v
            }
          }
          setChartMenu({ x: xLocal, y: yLocal, tMin, inSelection, nearestLaeqByPoint })
        }}
      >
        <div ref={chartRef} className="h-full px-4 py-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visibleData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />

              {/* Multi-jours : fond alterné subtil un jour sur deux (jours pairs = transparent, impairs = blanc 2%) */}
              {isMultiDay && sortedDates.map((_, i) => {
                if (i % 2 === 0) return null
                return (
                  <ReferenceArea
                    key={`day-bg-${i}`}
                    yAxisId="left"
                    x1={i * 1440}
                    x2={(i + 1) * 1440}
                    fill="#ffffff"
                    fillOpacity={0.02}
                    stroke="none"
                    ifOverflow="hidden"
                  />
                )
              })}

              {/* Multi-jours : zones grisées pour les discontinuités > 1h sans données */}
              {isMultiDay && gapZones.map((g, i) => {
                const hours = Math.floor(g.gapMin / 60)
                const mins = Math.round(g.gapMin % 60)
                const dur = hours > 0 ? `${hours}h${mins > 0 ? String(mins).padStart(2, '0') : ''}` : `${mins} min`
                return (
                  <ReferenceArea
                    key={`gap-${i}`}
                    yAxisId="left"
                    x1={g.start}
                    x2={g.end}
                    fill="#6b7280"
                    fillOpacity={0.3}
                    stroke="none"
                    ifOverflow="hidden"
                    label={{
                      value: `↕ ${dur} sans données`,
                      position: 'insideTop',
                      fill: '#d1d5db',
                      fontSize: 10,
                    }}
                  />
                )
              })}

              {isMultiDay ? (
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={[effectiveRange.startMin, effectiveRange.endMin]}
                  allowDataOverflow
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                  ticks={numericTicks}
                  tickFormatter={(v) => formatAxisLabel(Number(v))}
                  scale="linear"
                />
              ) : (
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                  interval={0}
                  ticks={adaptiveTicks.ticks}
                  tickFormatter={adaptiveTicks.formatter}
                />
              )}

              <YAxis
                yAxisId="left"
                domain={yDomain}
                allowDataOverflow
                tickCount={7}
                unit=" dB"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={{ stroke: '#374151' }}
                width={56}
              />

              {/* Axe Y secondaire pour la vitesse du vent (km/h) */}
              {showWind && windSpeed !== null && (
                <YAxis
                  yAxisId="wind"
                  orientation="right"
                  domain={[0, 50]}
                  allowDataOverflow
                  tickCount={6}
                  unit=" km/h"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  tickLine={false}
                  axisLine={{ stroke: '#374151' }}
                  width={60}
                />
              )}

              <Tooltip
                contentStyle={{
                  backgroundColor: '#111827',
                  border: '1px solid #374151',
                  borderRadius: 6,
                  fontSize: 12,
                }}
                labelStyle={{ color: '#e5e7eb', marginBottom: 4 }}
                itemStyle={{ color: '#d1d5db' }}
                formatter={(value) => [`${value} dB(A)`, undefined]}
                labelFormatter={(label) => {
                  if (!isMultiDay) return String(label)
                  const t = typeof label === 'number' ? label : Number(label)
                  if (!Number.isFinite(t)) return String(label)
                  const dayIdx = Math.floor(t / 1440)
                  const dateIso = sortedDates[dayIdx] ?? sortedDates[0]
                  return `${longFrDate(dateIso)} · ${minutesToHHMM(((t % 1440) + 1440) % 1440)}`
                }}
              />

              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 4, cursor: 'pointer' }}
                onClick={(e) => {
                  // Recharts passe la valeur dans `dataKey` ou `value` selon les versions
                  const key =
                    (typeof e === 'object' && e && 'dataKey' in e && (e as { dataKey?: string }).dataKey) ||
                    (typeof e === 'object' && e && 'value' in e ? String((e as { value?: string }).value) : '')
                  if (!key) return
                  if (onTogglePointVisibility) {
                    const spec = lineSpecs.find((s) => s.key === key)
                    if (spec) onTogglePointVisibility(spec.pt)
                    return
                  }
                  setLocalHiddenLines((prev) => {
                    const next = new Set(prev)
                    if (next.has(key)) next.delete(key)
                    else next.add(key)
                    return next
                  })
                }}
                formatter={(value, entry) => {
                  const k = (entry && (entry as { dataKey?: string }).dataKey) || String(value)
                  return (
                    <span style={{
                      color: hiddenLines.has(String(k)) ? '#4b5563' : '#d1d5db',
                      textDecoration: hiddenLines.has(String(k)) ? 'line-through' : 'none',
                    }}>
                      {value}
                    </span>
                  )
                }}
              />

              {/* Lignes de données — une par (point × date) */}
              {lineSpecs.map((spec) => (
                <Line
                  key={spec.key}
                  yAxisId="left"
                  type="monotone"
                  dataKey={spec.key}
                  name={spec.displayName}
                  stroke={spec.color}
                  strokeWidth={spec.isOverlay ? 1.5 : 2}
                  strokeDasharray={spec.isOverlay ? '5 4' : undefined}
                  strokeOpacity={spec.isOverlay ? 0.55 : 1}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                  hide={hiddenLines.has(spec.key)}
                  isAnimationActive={false}
                />
              ))}

              {/* Vent : ligne pointillée grise sur l'axe Y secondaire */}
              {showWind && windSpeed !== null && (
                <Line
                  yAxisId="wind"
                  type="linear"
                  dataKey="_wind"
                  name="Vent (km/h)"
                  stroke="#9ca3af"
                  strokeWidth={1.25}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              )}

              {/* Seuil 20 km/h : trait rouge pointillé */}
              {showWind && windSpeed !== null && (
                <ReferenceLine
                  yAxisId="wind"
                  y={20}
                  stroke="#ef4444"
                  strokeDasharray="2 4"
                  strokeWidth={1}
                  ifOverflow="extendDomain"
                  label={{
                    value: '20 km/h',
                    position: 'insideTopRight',
                    fill: '#ef4444',
                    fontSize: 9,
                  }}
                />
              )}

              {/* Overlay rouge : conditions météo invalides (vent ≥ 20 km/h) */}
              {windInvalid && visibleData.length > 0 && (
                <ReferenceArea
                  yAxisId="left"
                  x1={visibleData[0].label}
                  x2={visibleData[visibleData.length - 1].label}
                  fill="#ef4444"
                  fillOpacity={0.08}
                  stroke="#ef4444"
                  strokeOpacity={0.35}
                  strokeDasharray="3 3"
                  ifOverflow="extendDomain"
                  label={{
                    value: 'Conditions météo invalides',
                    position: 'insideTop',
                    fill: '#fca5a5',
                    fontSize: 10,
                  }}
                />
              )}

              {/* Fenêtre sélectionnée pour le calage Auto RMS — surlignage
                  bleu translucide persistant tant que le panneau reste ouvert. */}
              {chartHighlightRange && (() => {
                const xMin = isMultiDay
                  ? chartHighlightRange.startMin
                  : Math.max(fullRange.startMin, chartHighlightRange.startMin)
                const xMax = isMultiDay
                  ? chartHighlightRange.endMin
                  : Math.min(fullRange.endMin, chartHighlightRange.endMin)
                if (xMax <= xMin) return null
                return (
                  <ReferenceArea
                    yAxisId="left"
                    x1={xMin}
                    x2={xMax}
                    fill="#3b82f6"
                    fillOpacity={0.2}
                    stroke="#3b82f6"
                    strokeOpacity={0.75}
                    strokeDasharray="4 3"
                    ifOverflow="hidden"
                    label={{
                      value: 'Fenêtre Auto RMS',
                      position: 'insideTop',
                      fill: '#93c5fd',
                      fontSize: 10,
                      offset: 4,
                    }}
                  />
                )
              })()}

              {/* Périodes nommées :
                   - include  → vert
                   - exclude  → rouge
                   - annotate → couleur choisie (p.color) */}
              {periods && periods.map((p) => {
                const bounds = periodBounds(p)
                if (!bounds) return null
                const [s, eMin] = bounds
                const isInclude = p.status === 'include'
                const isExclude = p.status === 'exclude'
                const isAnnotate = p.status === 'annotate'
                const baseColor = isInclude
                  ? '#10b981'
                  : isExclude
                  ? '#ef4444'
                  : (p.color ?? '#3b82f6')
                const fillOp = isAnnotate ? 0.12 : 0.15
                const labelPrefix = isExclude ? '✕ ' : isAnnotate ? '✎ ' : ''
                return (
                  <ReferenceArea
                    key={`period-${p.id}`}
                    yAxisId="left"
                    x1={s}
                    x2={eMin}
                    fill={baseColor}
                    fillOpacity={fillOp}
                    stroke={baseColor}
                    strokeOpacity={0.55}
                    strokeDasharray={isAnnotate ? '4 3' : '3 3'}
                    ifOverflow="hidden"
                    label={{
                      value: `${labelPrefix}${p.name}`,
                      position: 'insideTop',
                      fill: baseColor,
                      fontSize: 10,
                      offset: 4,
                    }}
                  />
                )
              })}

              {/* Multi-jours : séparateurs de minuit + label du jour */}
              {isMultiDay && sortedDates.map((iso, i) => {
                // Une ligne à chaque minuit (sauf la première qui est le début)
                const xMidnight = i * 1440
                const label = longFrDate(iso)
                // Label centré sur la zone du jour (au début du jour + 12h approx, mais on utilise insideTop sur la ligne)
                // Pour centrer le label, on ajoute une ReferenceLine invisible à day+12h.
                return (
                  <ReferenceLine
                    key={`midnight-${i}`}
                    yAxisId="left"
                    x={xMidnight}
                    stroke={i === 0 ? 'transparent' : '#ffffff'}
                    strokeOpacity={i === 0 ? 0 : 0.4}
                    strokeDasharray="3 4"
                    strokeWidth={1}
                    label={{
                      value: label,
                      position: 'insideTopLeft',
                      fill: '#d1d5db',
                      fontSize: 11,
                      offset: 8,
                    }}
                    ifOverflow="hidden"
                  />
                )
              })}

              {/* Lignes verticales des événements */}
              {activeEvents.map((ev) => {
                const xVal = isMultiDay
                  ? snapBucketMin(dayIndexOf(ev.day) * 1440 + hhmmToMin(ev.time), aggSec)
                  : snapToBucket(ev.time, aggSec)
                return (
                  <ReferenceLine
                    key={ev.id}
                    yAxisId="left"
                    x={xVal}
                    stroke={ev.color}
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    label={{
                      value: ev.label,
                      position: 'insideTopRight',
                      fill: ev.color,
                      fontSize: 9,
                      offset: 4,
                    }}
                  />
                )
              })}

              {/* Candidats détectés (orange pointillé) */}
              {candidates
                .filter((c) => isMultiDay ? sortedDates.includes(c.day) : c.day === selectedDate)
                .map((c) => {
                  const xVal = isMultiDay
                    ? snapBucketMin(dayIndexOf(c.day) * 1440 + hhmmToMin(c.time), aggSec)
                    : snapToBucket(c.time, aggSec)
                  return (
                    <ReferenceLine
                      key={`cand-${c.id}`}
                      yAxisId="left"
                      x={xVal}
                      stroke="#fb923c"
                      strokeDasharray="2 3"
                      strokeWidth={1.25}
                      label={{
                        value: `+${c.delta.toFixed(0)}dB`,
                        position: 'insideBottomRight',
                        fill: '#fb923c',
                        fontSize: 9,
                        offset: 4,
                      }}
                    />
                  )
                })}

              {/* Annotations textuelles (ReferenceDot + label) */}
              {annotations
                .filter((a) => isMultiDay ? sortedDates.includes(a.day) : a.day === selectedDate)
                .map((a) => {
                  const xVal = isMultiDay
                    ? snapBucketMin(dayIndexOf(a.day) * 1440 + hhmmToMin(a.time), aggSec)
                    : snapToBucket(a.time, aggSec)
                  return (
                    <ReferenceDot
                      key={`ann-${a.id}`}
                      yAxisId="left"
                      x={xVal}
                      y={a.laeq}
                      r={3.5}
                      fill={a.color ?? '#fbbf24'}
                      stroke="#fff"
                      strokeWidth={1}
                      ifOverflow="extendDomain"
                      label={{
                        value: a.text,
                        position: 'top',
                        fill: a.color ?? '#fbbf24',
                        fontSize: 10,
                        offset: 6,
                      }}
                    />
                  )
                })}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Overlay : barre des segments audio classifiés (YAMNet) */}
        {audioSegments && audioSegments.length > 0 && (
          <AudioSegmentsBar
            segments={audioSegments}
            offsetMin={audioOffsetMin}
            effectiveRange={effectiveRange}
          />
        )}

        {/* Curseur de lecture audio — ligne 1px blanc translucide + disque
            au sommet + label HH:MM:SS. Suit audioPlayheadMin converti en
            pixels via la même conversion que xPxToMinutes (inverse). */}
        {audioPlayheadMin !== null && audioPlayheadMin !== undefined &&
         audioPlayheadMin >= effectiveRange.startMin && audioPlayheadMin <= effectiveRange.endMin &&
         chartAreaRef.current && (() => {
           const W = chartAreaRef.current.clientWidth
           const PAD_LEFT = 64
           const PAD_RIGHT = 24
           const usable = Math.max(1, W - PAD_LEFT - PAD_RIGHT)
           const span = Math.max(0.0001, effectiveRange.endMin - effectiveRange.startMin)
           const px = PAD_LEFT + ((audioPlayheadMin - effectiveRange.startMin) / span) * usable
           return (
             <div
               key="audio-playhead"
               className="pointer-events-none absolute top-0 bottom-0"
               style={{
                 left: px,
                 width: 0,
                 borderLeft: '1px solid rgba(255, 255, 255, 0.8)',
                 zIndex: 5,
               }}
             >
               {/* Disque au sommet */}
               <div
                 className="absolute"
                 style={{
                   top: 0,
                   left: 0,
                   width: 8,
                   height: 8,
                   borderRadius: 9999,
                   backgroundColor: 'white',
                   transform: 'translate(-50%, -2px)',
                   boxShadow: '0 0 0 2px rgba(0, 0, 0, 0.4)',
                 }}
               />
               {/* Label HH:MM:SS */}
               <div
                 className="absolute -top-5 left-0 px-1.5 py-0.5 rounded bg-gray-900/95 border border-white/30 text-[10px] text-white font-mono tabular-nums whitespace-nowrap"
                 style={{ transform: 'translateX(-50%)' }}
               >
                 {minutesToHHMMSS(((audioPlayheadMin % 1440) + 1440) % 1440)}
               </div>
             </div>
           )
         })()}

        {/* Barre de disponibilité audio sous l'axe X */}
        {audioCoverage && audioCoverage.length > 0 && (
          <div className="absolute left-0 right-0 bottom-0 pointer-events-auto">
            <AudioTimelineBar
              coverage={audioCoverage}
              effectiveRange={effectiveRange}
              labels={audioLabels}
            />
          </div>
        )}

        {/* Overlay : étiquettes "collantes" des points (haut-droite) */}
        <div className="pointer-events-none absolute top-2 right-8 flex flex-col items-end gap-0.5">
          {lineSpecs.filter((spec) => !hiddenLines.has(spec.key)).map((spec) => {
            const v = lastValueByKey[spec.key]
            return (
              <div
                key={spec.key}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded
                           bg-gray-900/85 border border-gray-700/70"
                style={{
                  fontSize: 10,
                  opacity: spec.isOverlay ? 0.85 : 1,
                  borderStyle: spec.isOverlay ? 'dashed' : 'solid',
                }}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: spec.color }}
                />
                <span style={{ color: spec.color }} className="font-semibold">
                  {spec.displayName}
                </span>
                {typeof v === 'number' && (
                  <span className="text-gray-300 tabular-nums">
                    {v.toFixed(1)} dB
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Overlays comparaison ON/OFF */}
        {compOn && compPhase !== 'idle' && (
          <CompOverlay
            chartAreaRef={chartAreaRef}
            effectiveRange={effectiveRange}
            range={compOn}
            color="#10b981"
            label="ON"
          />
        )}
        {compOff && compPhase !== 'idle' && (
          <CompOverlay
            chartAreaRef={chartAreaRef}
            effectiveRange={effectiveRange}
            range={compOff}
            color="#9ca3af"
            label="OFF"
          />
        )}
        {compPx && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 border-l border-r"
            style={{
              left: Math.min(compPx.startX, compPx.endX),
              width: Math.abs(compPx.endX - compPx.startX),
              backgroundColor:
                compPhase === 'pickON'
                  ? 'rgba(16,185,129,0.18)'
                  : 'rgba(156,163,175,0.18)',
              borderColor:
                compPhase === 'pickON' ? 'rgba(16,185,129,0.7)' : 'rgba(156,163,175,0.7)',
            }}
          />
        )}

        {/* Titre projet en mode présentation */}
        {presentationMode && (projectName || pointNames.length > 0) && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2
                          text-center select-none">
            {projectName && (
              <div className="text-base font-semibold text-gray-100 tracking-wide">
                {projectName}
              </div>
            )}
            {pointNames.length > 0 && (
              <div className="text-xs text-gray-400 mt-0.5">
                {pointNames.join(' · ')} {selectedDate ? `— ${selectedDate}` : ''}
              </div>
            )}
          </div>
        )}

        {/* Bandeau d'instructions pendant la comparaison */}
        {(compPhase === 'pickON' || compPhase === 'pickOFF') && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2
                          px-3 py-1 rounded bg-gray-900/90 border border-gray-700
                          text-xs text-gray-200">
            {compPhase === 'pickON'
              ? 'Glissez pour sélectionner la plage Source ON (verte)'
              : 'Glissez pour sélectionner la plage Source OFF (grise)'}
          </div>
        )}

        {/* Bandeau : cliquez sur le chart pour remonter un instant (calage
            audio mode Pointage) */}
        {chartPickArmed && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2
                          px-3 py-1 rounded bg-amber-900/80 border border-amber-600
                          text-xs text-amber-100 animate-pulse">
            Cliquez sur le graphique LAeq au même instant que le marqueur audio
          </div>
        )}

        {/* Bandeau : cliquez-glissez pour définir une fenêtre (calage Auto RMS) */}
        {chartRangePickArmed && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2
                          px-3 py-1 rounded bg-blue-900/80 border border-blue-500
                          text-xs text-blue-100 animate-pulse">
            Cliquez-glissez sur le graphique LAeq pour définir la fenêtre de recherche
          </div>
        )}

        {/* Badge niveau de zoom */}
        {isZoomed && zoomLevel > 1.05 && (
          <div
            className="pointer-events-none absolute top-2 left-20 px-1.5 py-0.5 rounded
                       bg-emerald-900/70 border border-emerald-700/60 text-[10px] font-semibold
                       text-emerald-300"
          >
            ×{zoomLevel < 10 ? zoomLevel.toFixed(1) : Math.round(zoomLevel)} zoom
          </div>
        )}

        {/* Overlay sélection Shift (rectangle) */}
        {selectionPx && (
          <div
            className="pointer-events-none absolute top-0 bottom-0 bg-emerald-400/15
                       border-l border-r border-emerald-400/70"
            style={{
              left: Math.min(selectionPx.startX, selectionPx.endX),
              width: Math.abs(selectionPx.endX - selectionPx.startX),
            }}
          />
        )}

        {/* Tooltip au survol d'une période « Annoter » — affiche le commentaire */}
        {periodHover && (
          <div
            className="pointer-events-none absolute px-2 py-1.5 rounded-md bg-gray-900/95
                       border shadow-lg z-30 max-w-[280px] select-none"
            style={{
              left: Math.min(periodHover.x + 12, (chartAreaRef.current?.clientWidth ?? 500) - 290),
              top: Math.max(8, periodHover.y - 16),
              borderColor: periodHover.period.color ?? '#3b82f6',
            }}
          >
            <div
              className="flex items-center gap-1 text-[11px] font-semibold mb-0.5"
              style={{ color: periodHover.period.color ?? '#93c5fd' }}
            >
              <StickyNote size={11} />
              {periodHover.period.name}
            </div>
            {periodHover.period.comment ? (
              <p className="text-[11px] text-gray-200 whitespace-pre-wrap leading-snug">
                {periodHover.period.comment}
              </p>
            ) : (
              <p className="text-[11px] text-gray-500 italic">Aucun commentaire</p>
            )}
            <div className="mt-1 text-[9px] text-gray-500 font-mono">
              {minutesToHHMMSS((periodHover.period.startMs - chartAnchorMs) / 60_000)} → {minutesToHHMMSS((periodHover.period.endMs - chartAnchorMs) / 60_000)}
            </div>
          </div>
        )}

        {/* Overlay période en cours de création : bandeau bleu 0.20 + bordures
            verticales pointillées 2px + label flottant avec début/fin/durée */}
        {periodPx && (() => {
          const left = Math.min(periodPx.startX, periodPx.endX)
          const width = Math.abs(periodPx.endX - periodPx.startX)
          const tA = xPxToMinutes(Math.min(periodPx.startX, periodPx.endX))
          const tB = xPxToMinutes(Math.max(periodPx.startX, periodPx.endX))
          return (
            <>
              {/* Fond bleu semi-transparent */}
              <div
                className="pointer-events-none absolute top-0 bottom-0"
                style={{
                  left,
                  width,
                  backgroundColor: 'rgba(59, 130, 246, 0.20)',
                }}
              />
              {/* Bordure verticale gauche — pointillés 2px */}
              <div
                className="pointer-events-none absolute top-0 bottom-0"
                style={{
                  left,
                  width: 0,
                  borderLeft: '2px dashed #3b82f6',
                }}
              />
              {/* Bordure verticale droite — pointillés 2px */}
              <div
                className="pointer-events-none absolute top-0 bottom-0"
                style={{
                  left: left + width,
                  width: 0,
                  borderLeft: '2px dashed #3b82f6',
                }}
              />
              {/* Label flottant au centre de la zone */}
              {width > 40 && (
                <div
                  className="pointer-events-none absolute top-1 px-2 py-0.5 rounded
                             bg-gray-900/90 border border-blue-500/60 text-[11px]
                             font-mono text-blue-100 whitespace-nowrap select-none"
                  style={{
                    left: left + width / 2,
                    transform: 'translateX(-50%)',
                  }}
                >
                  {minutesToHHMMSS(tA)} → {minutesToHHMMSS(tB)}
                  <span className="ml-2 text-blue-300">
                    · {formatDurationMin(tB - tA)}
                  </span>
                </div>
              )}
            </>
          )
        })()}

        {/* Popup création de période — Nom + Statut (3) + Couleur + Valider/Annuler */}
        {periodPopup && (
          <div
            className="absolute bg-gray-900 border border-gray-700 rounded-md shadow-xl p-3 z-30 w-[300px]"
            style={{
              left: Math.min(
                Math.max(8, periodPopup.x - 150),
                (chartAreaRef.current?.clientWidth ?? 500) - 308,
              ),
              top: Math.max(8, periodPopup.y),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Nouvelle période</p>
            <input
              autoFocus
              value={periodPopup.name}
              onChange={(e) => setPeriodPopup((prev) => prev && { ...prev, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setPeriodPopup(null); setPeriodPx(null) }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (!onPeriodAdd) { setPeriodPopup(null); setPeriodPx(null); return }
                  const base = chartAnchorMs
                  if (!Number.isFinite(base)) { setPeriodPopup(null); setPeriodPx(null); return }
                  onPeriodAdd({
                    id: crypto.randomUUID(),
                    name: periodPopup.name.trim() || `Période ${(periods?.length ?? 0) + 1}`,
                    startMs: base + periodPopup.tStart * 60_000,
                    endMs: base + periodPopup.tEnd * 60_000,
                    status: periodPopup.status,
                    color: periodPopup.color,
                    comment: periodPopup.status === 'annotate' ? periodPopup.comment : undefined,
                  })
                  setPeriodPopup(null)
                  setPeriodPx(null)
                }
              }}
              className="w-full text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <div className="mt-1.5 text-[10px] text-gray-500 font-mono">
              {minutesToHHMMSS(periodPopup.tStart)} → {minutesToHHMMSS(periodPopup.tEnd)}
              <span className="ml-2 text-gray-600">· {formatDurationMin(periodPopup.tEnd - periodPopup.tStart)}</span>
            </div>

            {/* Statut : Inclure / Exclure / Annoter */}
            <div className="mt-2 grid grid-cols-3 gap-1">
              <button
                onClick={() => setPeriodPopup((p) => p && { ...p, status: 'include' })}
                className={`text-[10px] rounded px-1 py-1 border transition-colors ${
                  periodPopup.status === 'include'
                    ? 'bg-emerald-700 border-emerald-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                }`}
              >
                Inclure
              </button>
              <button
                onClick={() => setPeriodPopup((p) => p && { ...p, status: 'exclude' })}
                className={`text-[10px] rounded px-1 py-1 border transition-colors ${
                  periodPopup.status === 'exclude'
                    ? 'bg-rose-700 border-rose-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                }`}
              >
                Exclure
              </button>
              <button
                onClick={() => setPeriodPopup((p) => p && { ...p, status: 'annotate' })}
                className={`text-[10px] rounded px-1 py-1 border transition-colors ${
                  periodPopup.status === 'annotate'
                    ? 'bg-blue-700 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                }`}
              >
                Annoter
              </button>
            </div>

            {/* Palette de couleurs — utilisée pour les annotations */}
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                Couleur {periodPopup.status !== 'annotate' && (
                  <span className="normal-case text-gray-600">(non utilisée pour inclure/exclure)</span>
                )}
              </p>
              <div className="flex gap-1.5">
                {PERIOD_PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => setPeriodPopup((p) => p && { ...p, color: c })}
                    className={`w-5 h-5 rounded-full border-2 transition-transform ${
                      periodPopup.color === c
                        ? 'border-white scale-110'
                        : 'border-gray-700 hover:border-gray-500'
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`Couleur ${c}`}
                  />
                ))}
              </div>
            </div>

            {/* Commentaire — uniquement pour les annotations */}
            {periodPopup.status === 'annotate' && (
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
                  Commentaire (optionnel)
                </p>
                <textarea
                  value={periodPopup.comment}
                  onChange={(e) => setPeriodPopup((p) => p && { ...p, comment: e.target.value })}
                  rows={2}
                  placeholder="Note libre qui apparaîtra au survol…"
                  className="w-full text-[11px] bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>
            )}

            <div className="flex gap-1.5 mt-2.5">
              <button
                onClick={() => { setPeriodPopup(null); setPeriodPx(null) }}
                className="flex-1 text-[11px] text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded px-2 py-1"
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  if (!onPeriodAdd) { setPeriodPopup(null); setPeriodPx(null); return }
                  const base = chartAnchorMs
                  if (!Number.isFinite(base)) { setPeriodPopup(null); setPeriodPx(null); return }
                  onPeriodAdd({
                    id: crypto.randomUUID(),
                    name: periodPopup.name.trim() || `Période ${(periods?.length ?? 0) + 1}`,
                    startMs: base + periodPopup.tStart * 60_000,
                    endMs: base + periodPopup.tEnd * 60_000,
                    status: periodPopup.status,
                    color: periodPopup.color,
                    comment: periodPopup.status === 'annotate' ? periodPopup.comment.trim() || undefined : undefined,
                  })
                  setPeriodPopup(null)
                  setPeriodPx(null)
                }}
                className="flex-1 text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white rounded px-2 py-1 flex items-center justify-center gap-1"
              >
                <Plus size={11} />
                Valider
              </button>
            </div>
          </div>
        )}

        {/* Popup résultats sélection */}
        {selectionPopup && (
          <SelectionPopup
            popup={selectionPopup}
            selectedDate={selectedDate}
            onClose={() => {
              setSelectionPopup(null)
              setSelectionPx(null)
            }}
            onAddEvent={(label) => {
              const minute = selectionPopup.tStart
              const h = Math.floor(minute / 60) % 24
              const m = Math.round(minute % 60)
              const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
              onAddEvent({
                id: crypto.randomUUID(),
                label,
                time,
                day: selectedDate,
                color: '#f43f5e',
              })
              setSelectionPopup(null)
              setSelectionPx(null)
            }}
          />
        )}

        {/* Menu contextuel clic droit */}
        {chartMenu && (
          <ContextMenu
            x={chartMenu.x}
            y={chartMenu.y}
            items={(() => {
              const tMin = chartMenu.tMin
              const timeHHMM = minutesToHHMM(tMin)
              const timeHHMMSS = minutesToHHMMSS(tMin)
              const firstPoint = Object.keys(chartMenu.nearestLaeqByPoint)[0]
              const firstLaeq = firstPoint !== undefined ? chartMenu.nearestLaeqByPoint[firstPoint] : undefined
              if (chartMenu.inSelection && selectionPopup) {
                return [
                  {
                    label: `Ajouter comme événement (${minutesToHHMM(selectionPopup.tStart)}–${minutesToHHMM(selectionPopup.tEnd)})`,
                    icon: <Flag size={12} />,
                    action: () => {
                      const label = window.prompt('Nom de l\'événement :')
                      if (!label || !label.trim()) return
                      onAddEvent({
                        id: crypto.randomUUID(),
                        label: label.trim(),
                        time: minutesToHHMM(selectionPopup.tStart),
                        day: selectedDate,
                        color: '#f43f5e',
                      })
                      setSelectionPopup(null)
                      setSelectionPx(null)
                    },
                  },
                  {
                    label: 'Effacer la sélection',
                    icon: <Trash2 size={12} />,
                    danger: true,
                    action: () => { setSelectionPopup(null); setSelectionPx(null) },
                  },
                ]
              }
              const hoveredPeriod = periodAtChartMin(tMin)
              const baseMs = chartAnchorMs
              if (hoveredPeriod && onPeriodUpdate && onPeriodRemove) {
                return [
                  {
                    label: `Renommer « ${hoveredPeriod.name} »`,
                    icon: <Edit3 size={12} />,
                    action: () => {
                      const name = window.prompt('Nouveau nom :', hoveredPeriod.name)
                      if (!name || !name.trim()) return
                      onPeriodUpdate(hoveredPeriod.id, { name: name.trim() })
                    },
                  },
                  {
                    label: hoveredPeriod.status === 'include' ? 'Exclure du calcul' : 'Inclure au calcul',
                    icon: <Flag size={12} />,
                    action: () => onPeriodUpdate(hoveredPeriod.id, {
                      status: hoveredPeriod.status === 'include' ? 'exclude' : 'include',
                    }),
                  },
                  {
                    label: 'Supprimer cette période',
                    icon: <Trash2 size={12} />,
                    danger: true,
                    action: () => onPeriodRemove(hoveredPeriod.id),
                  },
                ]
              }
              const audioRange = audioCoverage ? findCoveringRange(audioCoverage, tMin) : null
              const audioItems = audioRange && onAudioPlayAt
                ? [{
                    label: `▶ Écouter à ${timeHHMMSS}`,
                    icon: <Play size={12} />,
                    action: () => onAudioPlayAt(audioRange.entryId, Math.max(audioRange.startMin, tMin - 5 / 60)),
                  }]
                : []
              return [
                ...audioItems,
                {
                  label: `Ajouter une période à partir de ${timeHHMMSS}`,
                  icon: <Edit3 size={12} />,
                  disabled: !onPeriodAdd || !Number.isFinite(baseMs),
                  action: () => {
                    if (!onPeriodAdd || !Number.isFinite(baseMs)) return
                    const durStr = window.prompt('Durée (minutes) :', '60')
                    if (!durStr) return
                    const dur = parseFloat(durStr)
                    if (!Number.isFinite(dur) || dur <= 0) return
                    const statusStr = window.confirm('OK = Inclure, Annuler = Exclure')
                    onPeriodAdd({
                      id: crypto.randomUUID(),
                      name: `Période ${(periods?.length ?? 0) + 1}`,
                      startMs: baseMs + tMin * 60_000,
                      endMs: baseMs + (tMin + dur) * 60_000,
                      status: statusStr ? 'include' : 'exclude',
                    })
                  },
                },
                {
                  label: `Annoter ce moment (${timeHHMMSS})`,
                  icon: <StickyNote size={12} />,
                  action: () => {
                    const text = window.prompt('Texte de l\'annotation :')
                    if (!text || !text.trim()) return
                    onAnnotationPlace({
                      id: crypto.randomUUID(),
                      text: text.trim(),
                      time: timeHHMMSS,
                      day: selectedDate,
                      laeq: firstLaeq !== undefined ? Math.round(firstLaeq * 10) / 10 : 0,
                      color: '#fbbf24',
                    })
                  },
                },
                {
                  label: `Marquer comme événement ici (${timeHHMM})`,
                  icon: <Flag size={12} />,
                  action: () => {
                    const label = window.prompt('Nom de l\'événement :')
                    if (!label || !label.trim()) return
                    onAddEvent({
                      id: crypto.randomUUID(),
                      label: label.trim(),
                      time: timeHHMM,
                      day: selectedDate,
                      color: '#f43f5e',
                    })
                  },
                },
                {
                  label: firstPoint
                    ? `Copier LAeq (${firstPoint} : ${firstLaeq?.toFixed(1)} dB)`
                    : 'Copier la valeur LAeq',
                  icon: <Copy size={12} />,
                  disabled: firstLaeq === undefined,
                  action: () => {
                    const parts = Object.entries(chartMenu.nearestLaeqByPoint)
                      .map(([p, v]) => `${p}: ${v.toFixed(1)} dB`)
                      .join(' · ')
                    const text = `${selectedDate} ${timeHHMMSS} · ${parts}`
                    navigator.clipboard?.writeText(text).catch(() => { /* ignore */ })
                  },
                },
              ]
            })()}
            onClose={() => setChartMenu(null)}
          />
        )}
      </div>

      {/* Carte résultat ON/OFF */}
      {compPhase === 'done' && compOn && compOff && (
        <ComparisonResultCard
          on={compOn}
          off={compOff}
          onClose={resetComparison}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// AudioSegmentsBar — bandeau coloré YAMNet sous la courbe
// ────────────────────────────────────────────────────────────────────────────

function AudioSegmentsBar({
  segments,
  offsetMin,
  effectiveRange,
}: {
  segments: ClassifiedSegment[]
  offsetMin: number
  effectiveRange: ZoomRange
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ seg: ClassifiedSegment; x: number } | null>(null)

  // Suivre la largeur du conteneur
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)))
    obs.observe(el)
    setWidth(Math.floor(el.clientWidth))
    return () => obs.disconnect()
  }, [])

  // Dessiner les segments
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width === 0) return
    const dpr = window.devicePixelRatio || 1
    const H = 14
    canvas.width = Math.max(1, width * dpr)
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, H)

    const PAD_LEFT = 64
    const PAD_RIGHT = 24
    const usable = Math.max(1, width - PAD_LEFT - PAD_RIGHT)
    const span = Math.max(0.0001, effectiveRange.endMin - effectiveRange.startMin)

    for (const seg of segments) {
      const segStartMin = offsetMin + seg.timeStart / 60
      const segEndMin = offsetMin + seg.timeEnd / 60
      if (segEndMin < effectiveRange.startMin || segStartMin > effectiveRange.endMin) continue
      const x0 = PAD_LEFT + ((segStartMin - effectiveRange.startMin) / span) * usable
      const x1 = PAD_LEFT + ((segEndMin - effectiveRange.startMin) / span) * usable
      ctx.fillStyle = seg.color
      ctx.fillRect(Math.max(PAD_LEFT, x0), 1, Math.max(1, x1 - x0), H - 2)
    }
    // Cadre
    ctx.strokeStyle = 'rgba(75, 85, 99, 0.6)'
    ctx.strokeRect(PAD_LEFT - 0.5, 0.5, usable + 1, H - 1)
  }, [segments, offsetMin, effectiveRange, width])

  // Tooltip au survol
  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const PAD_LEFT = 64
    const PAD_RIGHT = 24
    const usable = Math.max(1, rect.width - PAD_LEFT - PAD_RIGHT)
    const span = Math.max(0.0001, effectiveRange.endMin - effectiveRange.startMin)
    const frac = (px - PAD_LEFT) / usable
    if (frac < 0 || frac > 1) {
      setHover(null)
      return
    }
    const tMin = effectiveRange.startMin + frac * span
    // Trouver le segment correspondant
    for (const seg of segments) {
      const segStart = offsetMin + seg.timeStart / 60
      const segEnd = offsetMin + seg.timeEnd / 60
      if (tMin >= segStart && tMin <= segEnd) {
        setHover({ seg, x: px })
        return
      }
    }
    setHover(null)
  }

  return (
    <div
      ref={containerRef}
      className="pointer-events-auto absolute left-0 right-0 bottom-7"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: 14 }} />
      {hover && (
        <div
          className="pointer-events-none absolute -top-7 px-1.5 py-0.5 rounded
                     bg-gray-900/95 border border-gray-700 text-[10px] text-gray-100
                     whitespace-nowrap shadow-lg"
          style={{ left: Math.min(Math.max(hover.x - 60, 4), (containerRef.current?.clientWidth ?? 200) - 140) }}
        >
          <span className="font-semibold" style={{ color: hover.seg.color }}>
            {hover.seg.category}
          </span>
          <span className="text-gray-500 ml-1.5">
            {(hover.seg.score * 100).toFixed(0)} %
          </span>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// CompOverlay — rectangle persistant pour ON/OFF déjà sélectionnés
// ────────────────────────────────────────────────────────────────────────────

function CompOverlay({
  chartAreaRef,
  effectiveRange,
  range,
  color,
  label,
}: {
  chartAreaRef: React.RefObject<HTMLDivElement | null>
  effectiveRange: ZoomRange
  range: { tStart: number; tEnd: number }
  color: string
  label: string
}) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    function update() {
      const rect = chartAreaRef.current?.getBoundingClientRect()
      if (rect) setWidth(rect.width)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [chartAreaRef])

  if (width === 0) return null
  const PAD_LEFT = 64
  const PAD_RIGHT = 24
  const usable = Math.max(1, width - PAD_LEFT - PAD_RIGHT)
  const span = Math.max(1, effectiveRange.endMin - effectiveRange.startMin)
  const xA = PAD_LEFT + ((range.tStart - effectiveRange.startMin) / span) * usable
  const xB = PAD_LEFT + ((range.tEnd - effectiveRange.startMin) / span) * usable
  const left = Math.min(xA, xB)
  const w = Math.max(2, Math.abs(xB - xA))

  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 border-l border-r"
      style={{
        left,
        width: w,
        backgroundColor: color === '#10b981' ? 'rgba(16,185,129,0.18)' : 'rgba(156,163,175,0.18)',
        borderColor: color,
      }}
    >
      <span
        className="absolute top-1 left-1 px-1 rounded text-[10px] font-semibold"
        style={{ backgroundColor: color, color: '#0b1220' }}
      >
        {label}
      </span>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// ComparisonResultCard — affichée sous le graphique en mode "done"
// ────────────────────────────────────────────────────────────────────────────

function fmtRange(r: { tStart: number; tEnd: number }): string {
  return `${minutesToHHMM(r.tStart)}–${minutesToHHMM(r.tEnd)}`
}

function ComparisonResultCard({
  on,
  off,
  onClose,
}: {
  on: { tStart: number; tEnd: number; laeq: number }
  off: { tStart: number; tEnd: number; laeq: number }
  onClose: () => void
}) {
  const delta = on.laeq - off.laeq
  // Lsource énergétique : L_on et L_off doivent satisfaire L_on > L_off
  let lsource: number | null = null
  if (delta > 0) {
    const diff = Math.pow(10, on.laeq / 10) - Math.pow(10, off.laeq / 10)
    if (diff > 0) lsource = 10 * Math.log10(diff)
  }

  // Couleur de confiance
  const confColor =
    delta >= 3 ? 'text-emerald-300 border-emerald-700/70 bg-emerald-950/40' :
    delta >= 1 ? 'text-amber-300 border-amber-700/70 bg-amber-950/40' :
    'text-rose-300 border-rose-700/70 bg-rose-950/40'
  const confLabel =
    delta >= 3 ? 'Bonne' : delta >= 1 ? 'Faible' : 'Insuffisante'

  return (
    <div className="border-t border-gray-800 bg-gray-900/60 shrink-0">
      <div className="px-6 py-2 flex items-center gap-4 flex-wrap text-xs">
        <span className="font-semibold text-gray-300">Comparaison ON/OFF</span>

        <div className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-gray-400">ON</span>
          <span className="text-gray-500">{fmtRange(on)}</span>
          <span className="font-semibold text-emerald-300 tabular-nums">
            {on.laeq.toFixed(1)} dB(A)
          </span>
        </div>

        <span className="text-gray-700">|</span>

        <div className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
          <span className="text-gray-400">OFF</span>
          <span className="text-gray-500">{fmtRange(off)}</span>
          <span className="font-semibold text-gray-200 tabular-nums">
            {off.laeq.toFixed(1)} dB(A)
          </span>
        </div>

        <span className="text-gray-700">|</span>

        <div className="flex items-center gap-1">
          <span className="text-gray-400">Δ</span>
          <span className="font-semibold text-gray-200 tabular-nums">
            {delta >= 0 ? '+' : ''}{delta.toFixed(1)} dB
          </span>
        </div>

        <span className="text-gray-700">|</span>

        <div className="flex items-center gap-1">
          <span className="text-gray-400">L<sub>source</sub></span>
          <span className="font-semibold text-emerald-300 tabular-nums">
            {lsource !== null ? `${lsource.toFixed(1)} dB(A)` : '—'}
          </span>
        </div>

        <div
          className={`ml-2 px-2 py-0.5 rounded border text-[10px] font-semibold tracking-wide uppercase ${confColor}`}
          title="Confiance basée sur Δ : ≥3 dB bonne, 1–3 faible, <1 insuffisante"
        >
          Confiance : {confLabel}
        </div>

        <button
          onClick={onClose}
          className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium
                     bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700
                     border border-gray-700 transition-colors"
        >
          <X size={11} />
          Annuler
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// SelectionPopup — affichée après un Shift+drag
// ────────────────────────────────────────────────────────────────────────────

interface SelectionPopupProps {
  popup: {
    tStart: number
    tEnd: number
    laeq: number | null
    l90: number | null
    x: number
    y: number
  }
  selectedDate: string
  onClose: () => void
  onAddEvent: (label: string) => void
}

function SelectionPopup({ popup, onClose, onAddEvent }: SelectionPopupProps) {
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const durationMin = popup.tEnd - popup.tStart
  const durationStr =
    durationMin < 1
      ? `${Math.round(durationMin * 60)} s`
      : durationMin < 60
      ? `${durationMin.toFixed(1)} min`
      : `${(durationMin / 60).toFixed(2)} h`

  // Position : éviter les bords
  const left = Math.max(8, Math.min(popup.x - 130, 9999))

  return (
    <div
      id="acoustiq-selection-popup"
      className="absolute z-30 bg-gray-900 border border-gray-700 rounded-md shadow-2xl
                 p-3 text-xs text-gray-200 w-64"
      style={{ left, top: popup.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="font-semibold text-emerald-400">Sélection</div>
        <button
          onClick={onClose}
          className="text-gray-600 hover:text-gray-300"
          title="Fermer (Échap)"
        >
          <X size={12} />
        </button>
      </div>
      <div className="space-y-0.5 mb-2">
        <div className="flex justify-between">
          <span className="text-gray-500">Début</span>
          <span className="tabular-nums">{minutesToHHMMSS(popup.tStart)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Fin</span>
          <span className="tabular-nums">{minutesToHHMMSS(popup.tEnd)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Durée</span>
          <span className="tabular-nums">{durationStr}</span>
        </div>
        <div className="flex justify-between border-t border-gray-800 pt-1 mt-1">
          <span className="text-gray-400">LAeq</span>
          <span className="font-semibold text-emerald-300 tabular-nums">
            {popup.laeq !== null ? `${popup.laeq.toFixed(1)} dB(A)` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">L90</span>
          <span className="font-semibold text-emerald-300 tabular-nums">
            {popup.l90 !== null ? `${popup.l90.toFixed(1)} dB(A)` : '—'}
          </span>
        </div>
      </div>
      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded
                     bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium
                     transition-colors"
        >
          <Plus size={11} />
          Ajouter comme événement
        </button>
      ) : (
        <div className="flex gap-1">
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && label.trim()) onAddEvent(label.trim())
              if (e.key === 'Escape') setAdding(false)
            }}
            placeholder="Étiquette de l'événement"
            className="flex-1 text-xs bg-gray-800 text-gray-100 border border-gray-600
                       rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button
            onClick={() => label.trim() && onAddEvent(label.trim())}
            disabled={!label.trim()}
            className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40
                       text-white text-xs font-medium transition-colors"
          >
            OK
          </button>
        </div>
      )}
    </div>
  )
}
