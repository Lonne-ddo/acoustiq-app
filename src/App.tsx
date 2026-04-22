/**
 * Composant racine d'AcoustiQ
 * Multi-projet, paramètres, raccourcis clavier, sidebar rétractable, états de chargement
 */
import { useState, useMemo, useRef, useCallback, useEffect, lazy, Suspense } from 'react'
import {
  FileAudio,
  BarChart2,
  Activity,
  Upload,
  AlertCircle,
  X,
  Layers,
  FileText,
  Shield,
  Save,
  FolderOpen,
  Settings as SettingsIcon,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  ChevronDown,
  ChevronUp,
  GitCompare,
  ClipboardCheck,
  Volume2,
  Play,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import type {
  MeasurementFile,
  SourceEvent,
  ConcordanceState,
  ZoomRange,
  AudioFile,
  AppSettings,
  RecentProject,
  ConformiteSummary,
  MarkerPos,
  CandidateEvent,
  ChartAnnotation,
  ProjectTemplate,
  MeteoData,
  IndicesSnapshot,
  ChecklistState,
  LwSourceSummary,
  Scene3DData,
  Period,
  AudioFileEntry,
  AudioCaleStatus,
} from './types'
import { DEFAULT_METEO } from './types'
import ChecklistModal, { DEFAULT_CHECKLIST } from './components/ChecklistModal'
import HistoryTab from './components/HistoryTab'
import RegulationTab from './components/RegulationTab'
// Modules lourds en lazy-load : sortis du bundle initial.
// - YamnetClassifier importe TFJS (~1 Mo) → chargé seulement à l'ouverture du tab
// - CarrierePage / EcmePage : ~50 kB chacun, code-splittés pour cohérence
const CarrierePage = lazy(() => import('./pages/CarrierePage'))
const EcmePage = lazy(() => import('./pages/EcmePage'))
const YamnetClassifier = lazy(() => import('./components/audio/YamnetClassifier'))
import { EMPTY_CARRIERE_STATE, type CarrierePageState } from './utils/carriereParser'
import { EMPTY_ECME_STATE, type EcmePageState } from './utils/ecmeParser'
import WorkflowGuide from './components/WorkflowGuide'
import type { ClassifiedSegment } from './utils/yamnetProcessor'
import {
  detectEmergenceEvents,
  laeqAvg,
  computeL10,
  computeL50,
  computeL90,
  computeLAFmax,
  computeLAFmin,
} from './utils/acoustics'
import {
  BUILTIN_TEMPLATES,
  loadUserTemplates,
  saveUserTemplates,
  MAX_USER_TEMPLATES,
} from './modules/templates'
import TemplatesSection from './components/TemplatesSection'
import MeteoSection from './components/MeteoSection'
import ComparisonModal from './components/ComparisonModal'
import { parse831C } from './modules/parser831C'
import { parse821SE, detect821SE } from './modules/parser821SE'
import { saveProject, loadProject } from './modules/projectManager'
import { loadSettings, saveSettings } from './modules/settings'
import { t, setLanguage } from './modules/i18n'
import TimeSeriesChart from './components/TimeSeriesChart'
import IndicesPanel from './components/IndicesPanel'
import PeriodsPanel from './components/PeriodsPanel'
import EventsPanel from './components/EventsPanel'
import ConcordanceTable from './components/ConcordanceTable'
import Spectrogram from './components/Spectrogram'
import LwCalculator from './components/LwCalculator'
const Vue3DTab = lazy(() => import('./components/Vue3DTab'))
const IsolementPage = lazy(() => import('./pages/IsolementPage'))
import ReportGenerator from './components/ReportGenerator'
import AudioPlayer from './components/AudioPlayer'
import StreamAudioPlayer from './components/audio/AudioPlayer'
import AudioCalagePanel from './components/audio/AudioCalagePanel'
import { useAudioSync, computeAudioCoverage, type AudioCoverageRange } from './hooks/useAudioSync'
import { parseAudioFilename, deriveStartTimesFromSequence } from './utils/audioFilenameParser'
import Conformite2026 from './components/Conformite2026'
import SiteMap from './components/SiteMap'
import Settings from './components/Settings'
import UserMenu from './components/UserMenu'
import { AUTH_ENABLED } from './config/auth'
import ShortcutsModal from './components/ShortcutsModal'
import Onboarding, { shouldShowOnboarding, resetOnboarding } from './components/Onboarding'
import Changelog from './components/Changelog'

// Injecté par Vite (vite.config.ts → define)
declare const __APP_VERSION__: string
const APP_VERSION = __APP_VERSION__
import { ToastProvider, showToast } from './components/Toast'
import { detectSessions, formatGap, GAP_STYLES } from './utils/sessionDetection'

// Couleurs par point pour la bordure des cartes
const POINT_COLORS: Record<string, string> = {
  'BV-94': '#10b981', 'BV-98': '#3b82f6', 'BV-105': '#f59e0b',
  'BV-106': '#ef4444', 'BV-37': '#8b5cf6', 'BV-107': '#06b6d4',
}

/** Fichier rejeté lors du parsing */
interface RejectedFile {
  name: string
  error: string
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function parseFile(buffer: ArrayBuffer, fileName: string): MeasurementFile {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })

  // Détection automatique du modèle 821SE
  if (detect821SE(workbook)) {
    return parse821SE(buffer, fileName)
  }

  // Essayer 831C en priorité, puis fallback 821SE avec le détail des erreurs
  let err831C: string | null = null
  try {
    return parse831C(buffer, fileName)
  } catch (e) {
    err831C = e instanceof Error ? e.message : String(e)
  }

  try {
    return parse821SE(buffer, fileName)
  } catch (e) {
    const err821SE = e instanceof Error ? e.message : String(e)
    throw new Error(`Échec de lecture de "${fileName}" :\n  Format A : ${err831C}\n  Format B : ${err821SE}`)
  }
}

function extractDateFromName(name: string): string | null {
  const match = name.match(/(\d{4}[-_]\d{2}[-_]\d{2})/)
  return match ? match[1].replace(/_/g, '-') : null
}

const MEASUREMENT_POINTS = ['BV-94', 'BV-98', 'BV-105', 'BV-106', 'BV-37', 'BV-107']

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target!.result as ArrayBuffer)
    reader.onerror = () => reject(new Error(`Impossible de lire : ${file.name}`))
    reader.readAsArrayBuffer(file)
  })
}

/** Extensions audio acceptées par le système de streaming */
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'ogg'] as const
type AudioExt = (typeof AUDIO_EXTS)[number]
function audioExtOf(name: string): AudioExt | null {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/)
  if (!m) return null
  const ext = m[1]
  return (AUDIO_EXTS as readonly string[]).includes(ext) ? (ext as AudioExt) : null
}

/**
 * Probe non-destructif d'un fichier audio : crée un blob URL + lit les
 * métadonnées via un HTMLAudioElement éphémère pour récupérer la durée.
 * Le blob URL est conservé (pas révoqué) pour servir ensuite au lecteur.
 */
function probeAudioFile(file: File): Promise<{ blobUrl: string; durationSec: number }> {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(file)
    const el = new Audio()
    el.preload = 'metadata'
    const cleanup = () => {
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('error', onErr)
    }
    const onMeta = () => {
      cleanup()
      resolve({ blobUrl, durationSec: Number.isFinite(el.duration) ? el.duration : 0 })
    }
    const onErr = () => {
      cleanup()
      URL.revokeObjectURL(blobUrl)
      reject(new Error(`Décodage métadonnées impossible : ${file.name}`))
    }
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('error', onErr)
    el.src = blobUrl
  })
}

// LocalStorage pour projets récents
const RECENT_KEY = 'acoustiq_recent_projects'
const SIDEBAR_KEY = 'acoustiq_sidebar_collapsed'
const MAX_RECENT = 5

function loadRecent(): RecentProject[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch { return [] }
}
function saveRecent(projects: RecentProject[]) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(projects.slice(0, MAX_RECENT)))
}

type Tab = 'chart' | 'map' | 'lw' | 'isolement' | 'concordance' | 'report' | 'reafie' | 'history' | 'regulation' | 'carriere' | 'yamnet' | 'ecme' | 'vue3d'

/**
 * Regroupement des onglets en 4 catégories principales pour réduire le bruit
 * visuel. Le spectrogramme est désormais uniquement embarqué sous le graphique
 * (l'ancien onglet « spectrogram » a été retiré — le composant Spectrogram
 * reste utilisé en mode compact dans l'onglet « Analyse »).
 */
type PrimaryTab = 'analyse' | 'conformite' | 'rapport' | 'outils'

const PRIMARY_TAB_OF: Record<Tab, PrimaryTab> = {
  chart: 'analyse',
  reafie: 'conformite',
  report: 'rapport',
  lw: 'analyse',
  isolement: 'analyse',
  concordance: 'analyse',
  map: 'outils',
  regulation: 'outils',
  history: 'outils',
  carriere: 'outils',
  yamnet: 'outils',
  ecme: 'outils',
  vue3d: 'outils',
}

// Feature flags — modules masqués temporairement sans suppression du code.
// Passer à `true` pour réactiver le module (+ décommenter l'entrée correspondante dans SUBTABS).
const ENABLED_CARRIERE = false

const SUBTABS: Record<PrimaryTab, Array<{ id: Tab; label: string }>> = {
  analyse: [
    { id: 'chart', label: 'Visualisation' },
    { id: 'lw', label: 'Calcul Lw' },
    { id: 'isolement', label: 'Isolement' },
    { id: 'concordance', label: 'Concordance' },
  ],
  conformite: [{ id: 'reafie', label: 'Conformité 2026' }],
  rapport: [
    { id: 'report', label: 'Rapport' },
  ],
  outils: [
    { id: 'vue3d', label: 'Vue 3D' },
    ...(ENABLED_CARRIERE ? [{ id: 'carriere' as Tab, label: 'Carrière / Sablière' }] : []),
    { id: 'yamnet', label: 'Audio IA' },
    { id: 'ecme', label: 'Parc ECME' },
    { id: 'map', label: 'Carte' },
    { id: 'regulation', label: 'Réglementation' },
    { id: 'history', label: 'Historique' },
  ],
}


/** Liste de fichiers groupée par date, avec bordure couleur du point */
/** Formate une durée en secondes en "Xh XXmin" */
function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  if (h > 0) return `${h}h${m > 0 ? String(m).padStart(2, '0') : '00'}`
  return `${m}min`
}

function FileList({
  files, pointMap, pointLabels, allPoints,
  onPointChange, onPointLabelChange, onFileRemove, onCreatePoint,
  hiddenPoints, onTogglePointVisibility,
  audioEntries, audioPointMap, onAudioEntryRemove, onAudioPlayAt, onOpenCalage,
}: {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  pointLabels: Record<string, string>
  allPoints: string[]
  onPointChange: (fileId: string, point: string) => void
  onPointLabelChange: (point: string, label: string) => void
  onFileRemove: (fileId: string) => void
  onCreatePoint: (name: string) => void
  hiddenPoints: Set<string>
  onTogglePointVisibility: (pt: string) => void
  audioEntries: AudioFileEntry[]
  audioPointMap: Record<string, string>
  onAudioEntryRemove: (id: string) => void
  onAudioPlayAt: (entryId: string, minutes: number) => void
  onOpenCalage: (entryId: string) => void
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [newPointInput, setNewPointInput] = useState<string | null>(null) // file ID awaiting new point

  // Group files by point (assigned) or "unassigned"
  const groups = useMemo(() => {
    const assigned = new Map<string, MeasurementFile[]>()
    const unassigned: MeasurementFile[] = []
    for (const f of files) {
      const pt = pointMap[f.id]
      if (pt) {
        if (!assigned.has(pt)) assigned.set(pt, [])
        assigned.get(pt)!.push(f)
      } else {
        unassigned.push(f)
      }
    }
    // Sort assigned groups by point name
    const sortedAssigned = [...assigned.entries()].sort(([a], [b]) => a.localeCompare(b))
    return { assigned: sortedAssigned, unassigned }
  }, [files, pointMap])

  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }))

  // Total duration for a group of files (using rowCount as proxy for seconds)
  const groupDuration = (fs: MeasurementFile[]) =>
    formatDuration(fs.reduce((sum, f) => sum + f.rowCount, 0))

  const renderFileCard = (f: MeasurementFile, showAssign: boolean) => {
    const pt = pointMap[f.id]
    return (
      <li key={f.id} className="rounded px-2 py-1 bg-gray-800/70 border border-gray-700/50">
        <div className="flex items-start gap-1">
          <p className="text-[10px] font-medium truncate flex-1 text-gray-300" title={f.name}>{f.name}</p>
          <button
            onClick={() => onFileRemove(f.id)}
            className="text-gray-600 hover:text-red-400 shrink-0 transition-colors"
            title={t('sidebar.remove')}
            aria-label={`Retirer ${f.name}`}
          >
            <X size={10} />
          </button>
        </div>
        <p
          className="text-[10px] text-gray-500 leading-tight"
          title={`Modèle ${f.model || '—'} · Série ${f.serial || '—'} · ${f.rowCount.toLocaleString('fr-FR')} mesures 1 s`}
        >
          {f.startTime} → {f.stopTime} · {f.rowCount.toLocaleString('fr-FR')} mes.
        </p>
        {showAssign && (
          <div className="mt-1.5 space-y-1">
            <select
              value={pt ?? ''}
              onChange={(e) => {
                if (e.target.value === '__new__') {
                  setNewPointInput(f.id)
                } else {
                  onPointChange(f.id, e.target.value)
                }
              }}
              className="w-full text-[11px] bg-gray-700 text-gray-100 border border-gray-600
                         rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">{t('sidebar.assignPoint')}</option>
              {allPoints.map((p) => (
                <option key={p} value={p}>{pointLabels[p] || p}</option>
              ))}
              <option value="__new__">+ Nouveau point…</option>
            </select>
            {newPointInput === f.id && (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const input = (e.currentTarget.elements.namedItem('np') as HTMLInputElement)
                  const name = input.value.trim()
                  if (name) {
                    onCreatePoint(name)
                    onPointChange(f.id, name)
                  }
                  setNewPointInput(null)
                }}
                className="flex gap-1"
              >
                <input
                  name="np"
                  autoFocus
                  placeholder="Nom du point"
                  className="flex-1 text-[11px] bg-gray-800 text-emerald-300 border border-gray-700
                             rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500
                             placeholder:text-gray-600"
                  onKeyDown={(e) => { if (e.key === 'Escape') setNewPointInput(null) }}
                />
                <button type="submit" className="text-[10px] text-emerald-400 hover:text-emerald-300 px-1">OK</button>
              </form>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="space-y-1.5">
      {/* Assigned point groups */}
      {groups.assigned.map(([pt, ptFiles]) => {
        const collapsed = collapsedGroups[pt] ?? false
        const color = POINT_COLORS[pt] ?? '#6b7280'
        const label = pointLabels[pt] || pt
        const hidden = hiddenPoints.has(pt)
        return (
          <div
            key={pt}
            className={`rounded-md border border-gray-700/60 overflow-hidden transition-opacity ${hidden ? 'opacity-30' : ''}`}
          >
            {/* Group header */}
            <div className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800/60 transition-colors">
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePointVisibility(pt) }}
                className="w-3 h-3 rounded-full shrink-0 border border-transparent hover:border-gray-400 transition-colors"
                style={{ backgroundColor: color, opacity: hidden ? 0.4 : 1 }}
                title={hidden ? `Afficher ${label}` : `Masquer ${label}`}
                aria-label={hidden ? `Afficher ${label}` : `Masquer ${label}`}
                aria-pressed={hidden}
              />
              <button
                onClick={() => toggleGroup(pt)}
                className="flex items-center gap-2 flex-1 text-left min-w-0"
              >
                <ChevronDown size={10} className={`text-gray-500 transition-transform shrink-0 ${collapsed ? '-rotate-90' : ''}`} />
                <span className="text-[11px] font-semibold text-gray-200 truncate flex-1" title={label}>
                  {label}
                </span>
                <span className="text-[10px] text-gray-500 shrink-0">
                  {ptFiles.length} fich. · {groupDuration(ptFiles)}
                </span>
              </button>
            </div>
            {/* Editable label row */}
            {!collapsed && (
              <div className="px-3 pb-1">
                <input
                  type="text"
                  key={pt}
                  defaultValue={label}
                  placeholder={pt}
                  onBlur={(e) => {
                    const v = e.currentTarget.value.trim()
                    onPointLabelChange(pt, v === pt ? '' : v)
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  className="w-full text-[10px] bg-transparent text-emerald-400/80 border-b border-gray-700/50
                             px-0 py-0.5 focus:outline-none focus:border-emerald-500
                             placeholder:text-gray-600"
                  title="Renommer ce point"
                />
              </div>
            )}
            {/* Fichiers audio associés au point */}
            {!collapsed && (() => {
              const ptAudios = audioEntries.filter((a) => audioPointMap[a.id] === pt)
              if (ptAudios.length === 0) return null
              return (
                <div className="px-2 pb-1 pt-1">
                  <div className="flex items-center gap-1 text-[10px] text-blue-400 mb-1 uppercase tracking-wider">
                    <Volume2 size={10} />
                    Audio ({ptAudios.length})
                  </div>
                  <ul className="space-y-0.5">
                    {ptAudios
                      .slice()
                      .sort((a, b) => a.startMin - b.startMin)
                      .map((a) => {
                        const endMin = a.startMin + a.durationSec / 60
                        const h = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`
                        const durMin = a.durationSec / 60
                        const durH = Math.floor(durMin / 60)
                        const durM = Math.round(durMin % 60)
                        const durLabel = durH > 0 ? `${durH}h${String(durM).padStart(2, '0')}` : `${durM} min`
                        const status = a.caleStatus
                        const dotColor = status === 'calibrated'
                          ? 'bg-emerald-500'
                          : status === 'date_only'
                          ? 'bg-amber-400'
                          : status === 'uncertain'
                          ? 'bg-orange-500'
                          : 'bg-rose-500'
                        const dotTitle = status === 'calibrated'
                          ? 'Calage appliqué'
                          : status === 'date_only'
                          ? 'Date estimée, heure à vérifier'
                          : status === 'uncertain'
                          ? 'Date estimée non fiable — à vérifier'
                          : 'Non calé (00:00 par défaut)'
                        return (
                          <li
                            key={a.id}
                            className="flex items-center gap-1 px-1.5 py-1 rounded bg-blue-950/20 border border-blue-900/40 text-[10px]"
                            title={`${a.name} — ${a.date} · ${h(a.startMin)} → ${h(endMin)}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`}
                              title={dotTitle}
                            />
                            <button
                              onClick={() => onAudioPlayAt(a.id, a.startMin)}
                              disabled={status === 'none'}
                              className="shrink-0 p-0.5 rounded hover:bg-blue-900/40 text-blue-300 hover:text-blue-200 disabled:opacity-40"
                              title={status === 'none' ? 'Calez le fichier avant de l\'écouter en synchro' : 'Lire ce fichier'}
                              aria-label="Lire"
                            >
                              <Play size={10} />
                            </button>
                            <span className="flex-1 truncate text-gray-300 font-mono" title={a.name}>
                              {a.name}
                            </span>
                            <span className="shrink-0 text-gray-500 font-mono">
                              {durLabel} · {h(a.startMin)} → {h(endMin)}
                            </span>
                            <button
                              onClick={() => onOpenCalage(a.id)}
                              className="shrink-0 text-[10px] text-amber-300 hover:text-amber-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-1 py-0 flex items-center gap-0.5"
                              title="Caler ce fichier sur la courbe LAeq"
                            >
                              ⏱ Caler
                            </button>
                            <button
                              onClick={() => onAudioEntryRemove(a.id)}
                              className="shrink-0 text-gray-600 hover:text-red-400"
                              title="Retirer ce fichier audio"
                              aria-label="Retirer"
                            >
                              <X size={10} />
                            </button>
                          </li>
                        )
                      })}
                  </ul>
                </div>
              )
            })()}
            {/* File cards groupés par session + séparateurs de discontinuité */}
            {!collapsed && (() => {
              const { sessions, gaps } = detectSessions(ptFiles)
              if (sessions.length <= 1) {
                return (
                  <ul className="px-2 pb-2 space-y-1">
                    {ptFiles.map((f) => renderFileCard(f, false))}
                  </ul>
                )
              }
              return (
                <div className="px-2 pb-2 space-y-1">
                  {sessions.map((sess, si) => {
                    const h = Math.floor(sess.durationMin / 60)
                    const m = Math.round(sess.durationMin % 60)
                    const dur = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`
                    return (
                      <div key={sess.index} className="space-y-0.5">
                        <div className="flex items-center gap-1.5 text-[10px] text-gray-500 pt-1">
                          <span className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400">
                            Session {si + 1}
                          </span>
                          <span>{sess.files[0].date} · {dur}</span>
                        </div>
                        <ul className="space-y-1 pl-2 border-l-2 border-gray-800">
                          {sess.files.map((f) => renderFileCard(f, false))}
                        </ul>
                        {gaps[si] && (() => {
                          const gap = gaps[si]
                          if (gap.severity === 'none') return null
                          const style = GAP_STYLES[gap.severity]
                          return (
                            <div className={`flex items-center gap-1.5 text-[10px] my-1 py-1 px-2 border rounded ${style.border} ${style.text} bg-gray-900/60`}>
                              <span className="shrink-0">⚠</span>
                              <span className="flex-1">
                                Discontinuité {style.label} — {formatGap(gap.gapMin)} sans données
                              </span>
                            </div>
                          )
                        })()}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        )
      })}

      {/* Unassigned files */}
      {groups.unassigned.length > 0 && (
        <div className="rounded-md border border-gray-700/40 overflow-hidden">
          <button
            onClick={() => toggleGroup('__unassigned')}
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/60 transition-colors"
          >
            <div className="w-2 h-2 rounded-full shrink-0 bg-gray-600" />
            <ChevronDown size={10} className={`text-gray-500 transition-transform shrink-0 ${collapsedGroups['__unassigned'] ? '-rotate-90' : ''}`} />
            <span className="text-[11px] font-semibold text-gray-400 flex-1">Non assignés</span>
            <span className="text-[10px] text-gray-500 shrink-0">{groups.unassigned.length} fich.</span>
          </button>
          {!collapsedGroups['__unassigned'] && (
            <ul className="px-2 pb-2 space-y-1">
              {groups.unassigned.map((f) => renderFileCard(f, true))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barre latérale rétractable
// ---------------------------------------------------------------------------
interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
  files: MeasurementFile[]
  pointMap: Record<string, string>
  events: SourceEvent[]
  availableDates: string[]
  errors: string[]
  audioFile: AudioFile | null
  chartTimeMin: number | null
  loading: boolean
  loadProgress: number
  rejectedFiles: RejectedFile[]
  candidates: CandidateEvent[]
  annotations: ChartAnnotation[]
  pendingAnnotationText: string | null
  onAnnotationAdd: (a: ChartAnnotation) => void
  onAnnotationRemove: (id: string) => void
  onAnnotationUpdate: (id: string, text: string) => void
  onPendingAnnotationChange: (text: string | null) => void
  onOpenComparison: () => void
  templates: ProjectTemplate[]
  userTemplateCount: number
  onSaveTemplate: (name: string) => void
  onApplyTemplate: (template: ProjectTemplate) => void
  onDeleteTemplate: (id: string) => void
  meteo: MeteoData
  onMeteoChange: (m: MeteoData) => void
  onOpenChecklist: () => void
  pointLabels: Record<string, string>
  allPoints: string[]
  onPointChange: (fileId: string, point: string) => void
  onPointLabelChange: (point: string, label: string) => void
  onCreatePoint: (name: string) => void
  onFileRemove: (fileId: string) => void
  onEventAdd: (ev: SourceEvent) => void
  onEventRemove: (id: string) => void
  onDetectCandidates: () => void
  onConfirmCandidate: (id: string) => void
  onDismissCandidate: (id: string) => void
  onClearError: (i: number) => void
  onSaveProject: () => void
  onLoadProject: (json: string) => void
  onParseFiles: (files: File[]) => void
  onAudioLoaded: (audio: AudioFile) => void
  onAudioRemove: () => void
  onAudioSeek: (timeMin: number) => void
  /** Nouveau système multi-fichiers en streaming (MP3/WAV/M4A/OGG) */
  audioEntries: AudioFileEntry[]
  audioPointMap: Record<string, string>
  audioCoverage: AudioCoverageRange[]
  onAudioEntriesLoad: (files: File[]) => Promise<void>
  onAudioEntryRemove: (id: string) => void
  onAudioEntryPointChange: (id: string, point: string) => void
  onAudioPlayAt: (entryId: string, minutes: number) => void
  onOpenCalage: (entryId: string) => void
  groupSuggestions: GroupSuggestion[]
  onAcceptSuggestion: (s: GroupSuggestion) => void
  onDismissSuggestion: (s: GroupSuggestion) => void
  onAcceptAllSuggestions: () => void
  hiddenPoints: Set<string>
  onTogglePointVisibility: (pt: string) => void
  detectParams: { emergenceDb: number; minDurationSec: number; mergeGapSec: number }
  onDetectParamsChange: (p: { emergenceDb: number; minDurationSec: number; mergeGapSec: number }) => void
}

export interface GroupSuggestion {
  serial: string
  model: string
  suggestedPoint: string
  fileIds: string[]
  continuousDurationMin: number
  startISO: string
  endISO: string
}

/**
 * Bloc accordéon utilisé dans la sidebar.
 * En-tête cliquable, contenu replié/déplié, pas de bordures inutiles.
 */
function SidebarSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-gray-800/70">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-left
                   hover:bg-gray-800/40 transition-colors"
      >
        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
          {title}
        </span>
        <ChevronDown
          size={11}
          className={`text-gray-600 transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  )
}

function Sidebar({
  collapsed, onToggle,
  files, pointMap, pointLabels, allPoints, events, availableDates, errors,
  audioFile, chartTimeMin, loading, loadProgress, rejectedFiles,
  candidates,
  annotations, pendingAnnotationText,
  onAnnotationAdd, onAnnotationRemove, onAnnotationUpdate, onPendingAnnotationChange,
  onOpenComparison,
  templates, userTemplateCount,
  onSaveTemplate, onApplyTemplate, onDeleteTemplate,
  meteo, onMeteoChange,
  onOpenChecklist,
  onPointChange, onPointLabelChange, onCreatePoint, onFileRemove,
  onEventAdd, onEventRemove, onClearError,
  onDetectCandidates, onConfirmCandidate, onDismissCandidate,
  onSaveProject, onLoadProject, onParseFiles,
  onAudioLoaded, onAudioRemove, onAudioSeek,
  audioEntries, audioPointMap, audioCoverage, onAudioEntriesLoad, onAudioEntryRemove, onAudioPlayAt, onOpenCalage,
  groupSuggestions, onAcceptSuggestion, onDismissSuggestion, onAcceptAllSuggestions,
  hiddenPoints, onTogglePointVisibility,
  detectParams, onDetectParamsChange,
}: SidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length === 0) return
    const xlsx = selected.filter((f) => /\.xlsx$/i.test(f.name))
    const audios = selected.filter((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f.name))
    if (xlsx.length > 0) onParseFiles(xlsx)
    if (audios.length > 0) void onAudioEntriesLoad(audios)
    e.target.value = ''
  }

  // Drag & drop sur toute la sidebar
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const droppedFiles = Array.from(e.dataTransfer.files)
    const xlsx = droppedFiles.filter((f) => /\.xlsx$/i.test(f.name))
    const audios = droppedFiles.filter((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f.name))
    const json = droppedFiles.filter((f) => /\.json$/i.test(f.name))
    if (xlsx.length > 0) onParseFiles(xlsx)
    if (audios.length > 0) {
      void onAudioEntriesLoad(audios)
    }
    if (json.length > 0 && json[0]) {
      json[0].text().then(onLoadProject)
    }
  }

  async function handleProjectLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    onLoadProject(await file.text())
    e.target.value = ''
  }

  async function handleAudioLoad(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const buf = await readAsArrayBuffer(file)
    const ctx = new AudioContext()
    const decoded = await ctx.decodeAudioData(buf)
    await ctx.close()
    onAudioLoaded({
      id: crypto.randomUUID(),
      name: file.name,
      date: extractDateFromName(file.name) ?? '',
      buffer: decoded,
      duration: decoded.duration,
      startOffsetMin: 0,
    })
    e.target.value = ''
  }

  // Mode rétracté : icônes seules
  if (collapsed) {
    return (
      <aside
        className={`w-12 min-h-screen bg-gray-900 text-gray-100 flex flex-col border-r shrink-0 items-center transition-colors ${
          dragOver ? 'border-emerald-500 bg-emerald-950/20' : 'border-gray-700'
        }`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="py-4">
          <Activity className="text-emerald-400" size={20} />
        </div>
        <button
          onClick={() => inputRef.current?.click()}
          className="p-2 rounded text-gray-400 hover:text-emerald-400 hover:bg-gray-800 transition-colors"
          title={t('sidebar.import')}
        >
          <Upload size={16} />
        </button>
        <input ref={inputRef} type="file" accept=".xlsx" multiple className="hidden" onChange={handleFileChange} />
        <button
          onClick={onSaveProject}
          className="p-2 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors mt-1"
          title={t('sidebar.save')}
        >
          <Save size={14} />
        </button>
        <input ref={projectInputRef} type="file" accept=".json" className="hidden" onChange={handleProjectLoad} />
        <button
          onClick={() => projectInputRef.current?.click()}
          className="p-2 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          title={t('sidebar.open')}
        >
          <FolderOpen size={14} />
        </button>
        {files.length > 0 && (
          <span className="text-xs text-gray-500 mt-2">{files.length}</span>
        )}
        <div className="mt-auto pb-3">
          <button onClick={onToggle} className="p-1 text-gray-600 hover:text-gray-300 transition-colors">
            <ChevronRight size={14} />
          </button>
        </div>
      </aside>
    )
  }

  return (
    <aside
      style={{ width: 180 }}
      className={`min-h-screen bg-gray-900 text-gray-100 flex flex-col border-r shrink-0 transition-colors ${
        dragOver ? 'border-emerald-500 bg-emerald-950/10' : 'border-gray-700'
      }`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* En-tête */}
      <div className="px-4 py-5 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="text-emerald-400" size={20} />
          <span className="font-bold text-lg tracking-tight">{t('sidebar.title')}</span>
          <button
            onClick={onOpenComparison}
            className="ml-auto p-1 text-gray-500 hover:text-emerald-400 hover:bg-gray-800 rounded transition-colors"
            title="Comparer projets"
            aria-label="Comparer projets"
          >
            <GitCompare size={13} />
          </button>
          <button onClick={onToggle} className="p-0.5 text-gray-600 hover:text-gray-300 transition-colors">
            <ChevronLeft size={14} />
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">{t('sidebar.subtitle')}</p>
      </div>

      {/* Actions rapides : projet + checklist */}
      <div className="px-3 py-2 border-b border-gray-800 shrink-0 flex gap-1.5">
        <input ref={projectInputRef} type="file" accept=".json" className="hidden" onChange={handleProjectLoad} />
        <button
          onClick={onSaveProject}
          disabled={files.length === 0}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded
                     bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-30
                     text-xs font-medium transition-colors"
        >
          <Save size={11} />
          {t('sidebar.save')}
        </button>
        <button
          onClick={() => projectInputRef.current?.click()}
          className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded
                     bg-gray-800 text-gray-300 hover:bg-gray-700
                     text-xs font-medium transition-colors"
        >
          <FolderOpen size={11} />
          {t('sidebar.open')}
        </button>
        <button
          onClick={onOpenChecklist}
          className="flex items-center justify-center px-2 py-1.5 rounded
                     bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-emerald-300
                     transition-colors"
          title="Checklist terrain"
          aria-label="Checklist terrain"
        >
          <ClipboardCheck size={12} />
        </button>
      </div>

      {/* Zone scrollable — 3 sections accordéon */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Erreurs */}
        {errors.length > 0 && (
          <div className="px-3 py-2 space-y-1 shrink-0">
            {errors.map((err, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5 text-xs text-red-400 bg-red-950/40
                           border border-red-800/50 rounded px-2 py-1.5"
              >
                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                <span className="flex-1">{err}</span>
                <button onClick={() => onClearError(i)} className="shrink-0 hover:text-red-200">
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ─── 📂 FICHIERS ─────────────────────────────────────────────── */}
        <SidebarSection title="📂 Fichiers" defaultOpen>
          <input ref={inputRef} type="file" accept=".xlsx,.mp3,.wav,.m4a,.ogg" multiple className="hidden" onChange={handleFileChange} />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md
                       bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50
                       text-sm font-medium transition-colors mb-3"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {loading ? t('sidebar.loading') : t('sidebar.import')}
          </button>
          {loading && loadProgress > 0 && (
            <div className="mb-2 w-full bg-gray-800 rounded-full h-1">
              <div
                className="bg-emerald-500 h-1 rounded-full transition-all duration-300"
                style={{ width: `${loadProgress}%` }}
              />
            </div>
          )}

          {groupSuggestions.length > 0 && (
            <div className="mb-3 rounded border border-emerald-700/50 bg-emerald-950/30 p-2 space-y-1.5">
              <p className="text-[11px] font-semibold text-emerald-300">
                {groupSuggestions.reduce((sum, s) => sum + s.fileIds.length, 0)} fichiers détectés →
                {' '}{groupSuggestions.length} point{groupSuggestions.length > 1 ? 's' : ''} de mesure
              </p>
              <div className="space-y-0.5">
                {groupSuggestions.map((s) => {
                  const h = Math.floor(s.continuousDurationMin / 60)
                  const m = Math.round(s.continuousDurationMin % 60)
                  const dur = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`
                  return (
                    <div key={s.serial} className="flex items-center gap-1.5 text-[10px] text-gray-300">
                      <span className="flex-1 truncate">
                        <span className="text-emerald-300 font-medium">{s.suggestedPoint}</span>
                        {' · '}{s.fileIds.length} fich. · {dur} continus
                      </span>
                      <button
                        onClick={() => onAcceptSuggestion(s)}
                        className="text-emerald-300 hover:text-emerald-200"
                        aria-label="Accepter le regroupement"
                        title="Accepter"
                      >✓</button>
                      <button
                        onClick={() => onDismissSuggestion(s)}
                        className="text-gray-500 hover:text-gray-300"
                        aria-label="Ignorer"
                        title="Ignorer"
                      >✕</button>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-1.5 pt-1 border-t border-emerald-900/40">
                <button
                  onClick={onAcceptAllSuggestions}
                  className="flex-1 text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white rounded px-2 py-1 transition-colors"
                >
                  Tout confirmer
                </button>
                <button
                  onClick={() => { for (const s of groupSuggestions) onDismissSuggestion(s) }}
                  className="flex-1 text-[10px] bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-400 rounded px-2 py-1 transition-colors"
                >
                  Tout ignorer
                </button>
              </div>
            </div>
          )}
          {files.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-3 px-2">
              <FileAudio size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-xs text-gray-600">{t('sidebar.filesEmpty')}</p>
            </div>
          ) : (
            <FileList
              files={files}
              pointMap={pointMap}
              pointLabels={pointLabels}
              allPoints={allPoints}
              onPointChange={onPointChange}
              onPointLabelChange={onPointLabelChange}
              onCreatePoint={onCreatePoint}
              onFileRemove={onFileRemove}
              hiddenPoints={hiddenPoints}
              onTogglePointVisibility={onTogglePointVisibility}
              audioEntries={audioEntries}
              audioPointMap={audioPointMap}
              onAudioEntryRemove={onAudioEntryRemove}
              onAudioPlayAt={onAudioPlayAt}
              onOpenCalage={onOpenCalage}
            />
          )}

          {rejectedFiles.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1.5">
                Fichiers non supportés
              </p>
              {rejectedFiles.map((rf, i) => (
                <div key={i} className="rounded px-2 py-1.5 mb-1 bg-red-950/30 border border-red-900/50">
                  <p className="text-xs text-red-300 truncate" title={rf.name}>{rf.name}</p>
                  <p className="text-xs text-red-500">{rf.error}</p>
                </div>
              ))}
            </div>
          )}
        </SidebarSection>

        {/* ─── 📍 ÉVÉNEMENTS ───────────────────────────────────────────── */}
        <SidebarSection title="📍 Événements" defaultOpen>
          <div className="-mx-3">
            <EventsPanel
              events={events}
              availableDates={availableDates}
              onAdd={onEventAdd}
              onRemove={onEventRemove}
              candidates={candidates}
              onDetect={onDetectCandidates}
              onConfirmCandidate={onConfirmCandidate}
              onDismissCandidate={onDismissCandidate}
              annotations={annotations}
              onAnnotationAdd={onAnnotationAdd}
              onAnnotationRemove={onAnnotationRemove}
              onAnnotationUpdate={onAnnotationUpdate}
              pendingAnnotationText={pendingAnnotationText}
              onPendingAnnotationChange={onPendingAnnotationChange}
              detectParams={detectParams}
              onDetectParamsChange={onDetectParamsChange}
              audioCoverage={audioCoverage}
              dayIndexOf={(d) => {
                const idx = availableDates.indexOf(d)
                return idx < 0 ? 0 : idx
              }}
              onAudioPlayAt={onAudioPlayAt}
            />
          </div>
        </SidebarSection>

        {/* ─── ⚙️ OPTIONS ──────────────────────────────────────────────── */}
        <SidebarSection title="⚙️ Options">
          <div className="-mx-3 space-y-0">
            <MeteoSection meteo={meteo} onChange={onMeteoChange} />
            <TemplatesSection
              templates={templates}
              userCount={userTemplateCount}
              maxUser={MAX_USER_TEMPLATES}
              onSave={onSaveTemplate}
              onApply={onApplyTemplate}
              onDelete={onDeleteTemplate}
            />
            {audioFile ? (
              <AudioPlayer
                audio={audioFile}
                chartTimeMin={chartTimeMin}
                onSeek={onAudioSeek}
                onRemove={onAudioRemove}
              />
            ) : (
              <div className="px-3 py-3 border-t border-gray-800">
                <input ref={audioInputRef} type="file" accept=".wav" className="hidden" onChange={handleAudioLoad} />
                <button
                  onClick={() => audioInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded
                             bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200
                             text-xs border border-dashed border-gray-600 transition-colors"
                >
                  <FileAudio size={12} />
                  {t('sidebar.loadWav')}
                </button>
              </div>
            )}
          </div>
        </SidebarSection>
      </div>

      <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-600 shrink-0 space-y-0.5">
        <p className="text-gray-500">AcoustiQ v{APP_VERSION}</p>
        <a
          href="https://acoustiq-app.pages.dev"
          target="_blank"
          rel="noreferrer"
          className="block text-gray-600 hover:text-emerald-400 transition-colors truncate"
        >
          acoustiq-app.pages.dev
        </a>
        <p className="text-gray-700 leading-tight pt-0.5">
          Basé sur les Lignes directrices MELCCFP 2026
        </p>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Panneau principal
// ---------------------------------------------------------------------------
interface MainPanelProps {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  pointLabels: Record<string, string>
  events: SourceEvent[]
  concordance: Record<string, ConcordanceState>
  selectedDate: string
  availableDates: string[]
  activeTab: Tab
  assignedPoints: string[]
  zoomRange: ZoomRange | null
  projectName: string
  recentProjects: RecentProject[]
  settings: AppSettings
  conformiteSummary: ConformiteSummary | null
  onConformiteSummaryChange: (summary: ConformiteSummary | null) => void
  aggregationSeconds: number
  onAggregationChange: (s: number) => void
  spectrogramExpanded: boolean
  onSpectrogramToggle: () => void
  onAddEvent: (event: SourceEvent) => void
  mapImage: string | null
  onMapImageChange: (image: string | null) => void
  mapMarkers: Record<string, MarkerPos>
  onMapMarkersChange: (markers: Record<string, MarkerPos>) => void
  overlayDate: string | null
  onOverlayDateChange: (d: string | null) => void
  candidates: CandidateEvent[]
  annotations: ChartAnnotation[]
  pendingAnnotationText: string | null
  onAnnotationAdd: (a: ChartAnnotation) => void
  onPendingAnnotationChange: (text: string | null) => void
  conformiteReceptor: 'I' | 'II' | 'III' | 'IV'
  conformitePeriod: 'jour' | 'nuit'
  onConformiteReceptorChange: (r: 'I' | 'II' | 'III' | 'IV') => void
  onConformitePeriodChange: (p: 'jour' | 'nuit') => void
  meteo: MeteoData
  audioFile: AudioFile | null
  audioSegments: ClassifiedSegment[]
  onAudioSegmentsChange: (segs: ClassifiedSegment[]) => void
  carriereState: CarrierePageState
  setCarriereState: React.Dispatch<React.SetStateAction<CarrierePageState>>
  ecmeState: EcmePageState
  setEcmeState: React.Dispatch<React.SetStateAction<EcmePageState>>
  lwSources: LwSourceSummary[]
  onLwSourcesChange: (sources: LwSourceSummary[]) => void
  scene3D: Scene3DData | undefined
  onScene3DChange: (data: Scene3DData) => void
  presentationMode: boolean
  onPresentationToggle: () => void
  hiddenPoints: Set<string>
  onTogglePointVisibility: (pt: string) => void
  periods: Period[]
  onPeriodAdd: (p: Period) => void
  onPeriodUpdate: (id: string, patch: Partial<Period>) => void
  onPeriodRemove: (id: string) => void
  audioEntries: AudioFileEntry[]
  audioPointMap: Record<string, string>
  audioSync: ReturnType<typeof useAudioSync>
  audioCoverage: AudioCoverageRange[]
  chartPickArmed: boolean
  onChartPicked: (tMin: number) => void
  chartRangePickArmed: boolean
  onChartRangePicked: (startMin: number, endMin: number) => void
  chartHighlightRange: { startMin: number; endMin: number } | null
  onOpenAudioCalage: (entryId: string) => void
  onDateChange: (date: string) => void
  onTabChange: (tab: Tab) => void
  onCellChange: (eventId: string, point: string, state: ConcordanceState) => void
  onZoomChange: (range: ZoomRange | null) => void
  onProjectNameChange: (name: string) => void
  onNewProject: () => void
  onSwitchProject: (project: RecentProject) => void
  onOpenSettings: () => void
  onOpenShortcuts: () => void
  onOpenOnboarding: () => void
  onOpenChangelog: () => void
}

function MainPanel({
  files, pointMap, pointLabels, events, concordance,
  selectedDate, availableDates, activeTab, assignedPoints, zoomRange,
  projectName, recentProjects, settings,
  conformiteSummary, onConformiteSummaryChange,
  aggregationSeconds, onAggregationChange,
  spectrogramExpanded, onSpectrogramToggle, onAddEvent,
  mapImage, onMapImageChange, mapMarkers, onMapMarkersChange,
  overlayDate, onOverlayDateChange, candidates,
  annotations, pendingAnnotationText,
  onAnnotationAdd, onPendingAnnotationChange,
  conformiteReceptor, conformitePeriod,
  onConformiteReceptorChange, onConformitePeriodChange,
  meteo, audioFile, audioSegments, onAudioSegmentsChange,
  carriereState, setCarriereState, ecmeState, setEcmeState,
  lwSources, onLwSourcesChange, scene3D, onScene3DChange,
  presentationMode, onPresentationToggle,
  hiddenPoints, onTogglePointVisibility,
  periods, onPeriodAdd, onPeriodUpdate, onPeriodRemove,
  audioEntries, audioPointMap, audioSync, audioCoverage,
  chartPickArmed, onChartPicked,
  chartRangePickArmed, onChartRangePicked, chartHighlightRange,
  onOpenAudioCalage,
  onDateChange, onTabChange, onCellChange, onZoomChange,
  onProjectNameChange, onNewProject, onSwitchProject,
  onOpenSettings, onOpenShortcuts, onOpenOnboarding, onOpenChangelog,
}: MainPanelProps) {
  const chartFiles = files.filter((f) => !!pointMap[f.id])
  const visibleChartFiles = chartFiles.filter((f) => !hiddenPoints.has(pointMap[f.id]))
  const hasChart = chartFiles.length > 0
  const [showRecent, setShowRecent] = useState(false)
  // Affichage forcé du bandeau « Démarrage guidé » après qu'il a été masqué
  // automatiquement au 1er import. Activé via le bouton ❓ « Aide » du header.
  const [forceShowWorkflow, setForceShowWorkflow] = useState(false)

  // --- Hauteur du spectrogramme en pixels (défaut 120, min 80, max 400) ---
  // Mémorisée pendant la session via sessionStorage pour survivre aux
  // changements d'onglet sans polluer localStorage.
  const SPECTRO_MIN = 80
  const SPECTRO_MAX = 400
  const SPECTRO_DEFAULT = 150
  const [spectrogramHeight, setSpectrogramHeight] = useState<number>(() => {
    try {
      const v = sessionStorage.getItem('acoustiq_spectro_height')
      if (v) {
        const n = parseInt(v, 10)
        if (Number.isFinite(n)) return Math.max(SPECTRO_MIN, Math.min(SPECTRO_MAX, n))
      }
    } catch { /* sessionStorage indisponible */ }
    return SPECTRO_DEFAULT
  })
  useEffect(() => {
    try { sessionStorage.setItem('acoustiq_spectro_height', String(spectrogramHeight)) } catch { /* ignore */ }
  }, [spectrogramHeight])

  const resizeRef = useRef<{ startY: number; startH: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { startY: e.clientY, startH: spectrogramHeight }
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      // Glisser vers le haut → spectrogramme plus grand (hauteur augmente)
      const deltaY = ev.clientY - resizeRef.current.startY
      const newH = resizeRef.current.startH - deltaY
      setSpectrogramHeight(Math.max(SPECTRO_MIN, Math.min(SPECTRO_MAX, newH)))
    }
    const onUp = () => {
      resizeRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [spectrogramHeight])

  // En mode présentation, on force l'onglet Visualisation
  const effectiveTab: Tab = presentationMode ? 'chart' : activeTab

  return (
    <main className={`flex-1 ${presentationMode ? 'bg-black' : 'bg-gray-950'} text-gray-100 flex flex-col min-w-0 overflow-hidden`}>
      {/* Barre de navigation — masquée en mode présentation */}
      {!presentationMode && (
      <header className="px-6 py-3 border-b border-gray-800 flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <BarChart2 size={18} className="text-emerald-400" />
          {/* Nom du projet éditable */}
          <input
            type="text"
            value={projectName}
            onChange={(e) => onProjectNameChange(e.target.value)}
            className="text-sm font-semibold text-gray-200 bg-transparent border-none
                       focus:outline-none focus:ring-0 w-40 truncate
                       hover:text-emerald-400 transition-colors"
            title={projectName}
          />
          {/* Sélecteur de projet */}
          <div className="relative">
            <button
              onClick={() => setShowRecent(!showRecent)}
              className="p-1 text-gray-600 hover:text-gray-300 transition-colors"
              title={t('project.recent')}
            >
              <ChevronLeft size={12} className="rotate-[-90deg]" />
            </button>
            {showRecent && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-gray-900 border border-gray-700
                             rounded-md shadow-xl z-40 py-1">
                <button
                  onClick={() => { onNewProject(); setShowRecent(false) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-emerald-400
                             hover:bg-gray-800 transition-colors"
                >
                  <Plus size={11} />
                  {t('project.new')}
                </button>
                {recentProjects.length > 0 && (
                  <div className="border-t border-gray-700 mt-1 pt-1">
                    <p className="px-3 py-1 text-xs text-gray-600 font-medium">
                      {t('project.recent')}
                    </p>
                    {recentProjects.map((rp) => (
                      <button
                        key={rp.id}
                        onClick={() => { onSwitchProject(rp); setShowRecent(false) }}
                        className="w-full flex flex-col items-start px-3 py-1.5 text-xs
                                   hover:bg-gray-800 transition-colors"
                      >
                        <span className="text-gray-300 truncate w-full text-left">{rp.name}</span>
                        <span className="text-gray-600">{new Date(rp.savedAt).toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Onglets primaires (4) — sous-onglets affichés en dessous si > 1 */}
        <nav className="flex gap-1 ml-4">
          {([
            ['analyse',    <BarChart2 size={13} key="a" />,  'Analyse'],
            ['conformite', <Shield size={13} key="c" />,     'Conformité'],
            ['rapport',    <FileText size={13} key="r" />,   'Rapport'],
            ['outils',     <Layers size={13} key="o" />,     'Outils'],
          ] as [PrimaryTab, React.ReactNode, string][]).map(([pid, icon, label]) => {
            const isActive = PRIMARY_TAB_OF[activeTab] === pid
            return (
              <TabButton
                key={pid}
                active={isActive}
                onClick={() => onTabChange(SUBTABS[pid][0].id)}
                icon={icon}
                label={label}
                aria-label={label}
              />
            )
          })}
        </nav>

        {/* Actions header */}
        <div className="flex items-center gap-1 ml-auto">
          {hasChart && activeTab === 'chart' && (
            <span className="text-xs text-gray-500 mr-2">
              {chartFiles.length} {t('chart.filesShown')}
            </span>
          )}
          <button
            onClick={onOpenChangelog}
            className="px-2 py-1 text-xs text-gray-600 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
            title="Changelog"
          >
            v{APP_VERSION}
          </button>
          {!AUTH_ENABLED && (
            <span
              className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-800 border border-gray-700 rounded"
              title="Authentification désactivée (src/config/auth.ts → AUTH_ENABLED)"
            >
              Dev mode
            </span>
          )}
          {files.length > 0 && (
            <button
              onClick={() => setForceShowWorkflow((v) => !v)}
              className={`p-1.5 rounded transition-colors ${
                forceShowWorkflow
                  ? 'text-emerald-300 bg-gray-800'
                  : 'text-gray-600 hover:text-emerald-400 hover:bg-gray-800'
              }`}
              title={forceShowWorkflow ? 'Masquer le bandeau de démarrage' : 'Afficher le bandeau de démarrage'}
              aria-pressed={forceShowWorkflow}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide">Aide</span>
            </button>
          )}
          <button
            onClick={onOpenOnboarding}
            className="p-1.5 text-gray-600 hover:text-emerald-400 hover:bg-gray-800 rounded transition-colors"
            title="Guide de démarrage"
          >
            <span className="text-xs font-bold">?</span>
          </button>
          <button
            onClick={onOpenShortcuts}
            className="p-1.5 text-gray-600 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
            title={t('shortcuts.title')}
          >
            <HelpCircle size={14} />
          </button>
          <button
            onClick={onOpenSettings}
            className="p-1.5 text-gray-600 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
            title={t('settings.title')}
          >
            <SettingsIcon size={14} />
          </button>
          <UserMenu />
        </div>
      </header>
      )}

      {/* Sous-onglets : visible uniquement quand l'onglet primaire en a > 1 */}
      {!presentationMode && (() => {
        const sub = SUBTABS[PRIMARY_TAB_OF[activeTab]]
        if (sub.length <= 1) return null
        return (
          <nav className="flex items-center gap-1 px-6 py-1.5 border-b border-gray-800/70 bg-gray-900/40">
            {sub.map((s) => (
              <button
                key={s.id}
                onClick={() => onTabChange(s.id)}
                className={`text-xs px-2.5 py-1 rounded transition-colors ${
                  activeTab === s.id
                    ? 'bg-emerald-700 text-white'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>
        )
      })()}

      {/* Bandeau guidé en 3 étapes — masqué automatiquement après le 1er
          import. Le bouton « Aide » du header le réaffiche si besoin. */}
      {!presentationMode && (
        <WorkflowGuide
          hasFiles={files.length > 0}
          allAssigned={files.length > 0 && files.every((f) => !!pointMap[f.id])}
          hasChart={hasChart && !!selectedDate}
          forceShow={forceShowWorkflow}
        />
      )}

      {/* Contenu selon l'onglet */}
      {effectiveTab === 'chart' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto animate-[fadeIn_0.15s_ease-out]">
          {hasChart ? (
            <>
              <div
                ref={containerRef}
                className="flex flex-col shrink-0"
                style={{
                  height: `max(min(70vh, 720px), ${spectrogramHeight + 280}px)`,
                  minHeight: Math.max(380, spectrogramHeight + 280),
                }}
              >
              <div className="flex-1 min-h-0">
                <TimeSeriesChart
                  files={chartFiles}
                  pointMap={pointMap}
                  selectedDate={selectedDate}
                  availableDates={availableDates}
                  onDateChange={onDateChange}
                  events={events}
                  zoomRange={zoomRange}
                  onZoomChange={onZoomChange}
                  settings={settings}
                  aggregationSeconds={aggregationSeconds}
                  onAggregationChange={onAggregationChange}
                  onAddEvent={onAddEvent}
                  overlayDate={overlayDate}
                  onOverlayDateChange={onOverlayDateChange}
                  candidates={candidates}
                  annotations={annotations}
                  pendingAnnotationText={pendingAnnotationText}
                  onAnnotationPlace={onAnnotationAdd}
                  onPendingAnnotationCleared={() => onPendingAnnotationChange(null)}
                  presentationMode={presentationMode}
                  onPresentationToggle={onPresentationToggle}
                  projectName={projectName}
                  meteo={meteo}
                  audioSegments={audioSegments}
                  audioOffsetMin={audioFile?.startOffsetMin ?? 0}
                  pointLabels={pointLabels}
                  hiddenPoints={hiddenPoints}
                  onTogglePointVisibility={onTogglePointVisibility}
                  periods={periods}
                  onPeriodAdd={onPeriodAdd}
                  onPeriodUpdate={onPeriodUpdate}
                  onPeriodRemove={onPeriodRemove}
                  audioCoverage={audioCoverage}
                  audioLabels={Object.fromEntries(audioEntries.map((e) => [e.id, e.name]))}
                  audioPlayheadMin={(() => {
                    // La position "minutes axe X" = dayIndex × 1440 + currentMin
                    // quand multi-jours, sinon directement currentMin.
                    const activeEntry = audioEntries.find((e) => e.id === audioSync.activeEntryId)
                    if (!activeEntry || audioSync.currentMin === null) return null
                    const isMulti = availableDates.length > 1 && !overlayDate
                    const offset = isMulti
                      ? Math.max(0, availableDates.indexOf(activeEntry.date)) * 1440
                      : 0
                    return offset + audioSync.currentMin
                  })()}
                  onAudioPlayAt={audioSync.playAt}
                  audioPlaying={audioSync.playing}
                  onAudioSeekMin={audioSync.seekMin}
                  chartPickArmed={chartPickArmed}
                  onChartPicked={onChartPicked}
                  chartRangePickArmed={chartRangePickArmed}
                  onChartRangePicked={onChartRangePicked}
                  chartHighlightRange={chartHighlightRange}
                />
              </div>

              {/* Poignée de redimensionnement */}
              <div
                className="h-1.5 cursor-row-resize bg-gray-800 hover:bg-emerald-600/60 transition-colors shrink-0 flex items-center justify-center group"
                onMouseDown={handleResizeStart}
                title="Glisser pour redimensionner"
              >
                <div className="w-8 h-0.5 bg-gray-600 group-hover:bg-emerald-400 rounded-full" />
              </div>

              {/* Spectrogramme embarqué (collapsible, hauteur en px mémorisée) */}
              <div
                className="border-t border-gray-800 bg-gray-900/40 flex flex-col shrink-0"
                style={{ height: spectrogramExpanded ? spectrogramHeight + 28 /* header */ : undefined }}
              >
                <button
                  onClick={onSpectrogramToggle}
                  className="w-full flex items-center gap-2 px-6 py-1.5 text-xs text-gray-400
                             hover:text-gray-200 hover:bg-gray-800/60 transition-colors shrink-0"
                  aria-expanded={spectrogramExpanded}
                >
                  {spectrogramExpanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                  <Layers size={12} />
                  <span className="font-semibold uppercase tracking-wider">Spectrogramme</span>
                  <span className="text-gray-600 normal-case font-normal">
                    — synchronisé avec le graphique ({spectrogramHeight}px)
                  </span>
                </button>
                {spectrogramExpanded && (
                  <div className="flex-1 min-h-0" style={{ minHeight: SPECTRO_MIN }}>
                    <Spectrogram
                      files={visibleChartFiles}
                      pointMap={pointMap}
                      selectedDate={selectedDate}
                      availableDates={availableDates}
                      onDateChange={onDateChange}
                      events={events}
                      zoomRange={zoomRange}
                      aggregationSeconds={aggregationSeconds}
                      compact
                      height={spectrogramHeight}
                      multiDay={availableDates.length > 1 && !overlayDate}
                      playheadMin={(() => {
                        const a = audioEntries.find((e) => e.id === audioSync.activeEntryId)
                        if (!a || audioSync.currentMin === null) return null
                        const isMulti = availableDates.length > 1 && !overlayDate
                        const offset = isMulti
                          ? Math.max(0, availableDates.indexOf(a.date)) * 1440
                          : 0
                        return offset + audioSync.currentMin
                      })()}
                    />
                  </div>
                )}
              </div>

              </div>
              {/* Lecteur audio flottant (streaming) — visible s'il existe des
                  fichiers audio associés à au moins un point de mesure visible. */}
              {!presentationMode && audioEntries.length > 0 && (
                <div className="shrink-0">
                  <StreamAudioPlayer
                    entries={audioEntries.filter((e) => {
                      const pt = audioPointMap[e.id]
                      return !pt || assignedPoints.includes(pt)
                    })}
                    sync={audioSync}
                    pointName={assignedPoints[0] ?? null}
                    onOpenCalage={onOpenAudioCalage}
                  />
                </div>
              )}
              {!presentationMode && (
                <>
                  <div className="shrink-0">
                    <PeriodsPanel
                      periods={periods}
                      onAdd={onPeriodAdd}
                      onUpdate={onPeriodUpdate}
                      onRemove={onPeriodRemove}
                      selectedDate={selectedDate}
                    />
                  </div>
                  <div className="shrink-0">
                    <IndicesPanel
                      files={visibleChartFiles}
                      pointMap={pointMap}
                      selectedDate={selectedDate}
                      meteo={meteo}
                      aggregationSeconds={aggregationSeconds}
                      periods={periods}
                    />
                  </div>
                </>
              )}
            </>
          ) : (
            <EmptyState
              icon={<BarChart2 size={40} />}
              text="Importez un fichier de mesure pour commencer."
              hint={
                files.length > 0
                  ? `${files.length} fichier${files.length > 1 ? 's' : ''} chargé${files.length > 1 ? 's' : ''} — ${t('general.waitingAssign')}`
                  : undefined
              }
            />
          )}
        </div>
      )}

      {effectiveTab === 'map' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          <SiteMap
            files={files}
            pointMap={pointMap}
            selectedDate={selectedDate}
            assignedPoints={assignedPoints}
            zoomRange={zoomRange}
            mapImage={mapImage}
            onMapImageChange={onMapImageChange}
            markers={mapMarkers}
            onMarkersChange={onMapMarkersChange}
            settings={settings}
          />
        </div>
      )}

      {effectiveTab === 'lw' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]"><LwCalculator onSourcesChange={onLwSourcesChange} /></div>
      )}

      {effectiveTab === 'isolement' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          <Suspense fallback={<LazyTabFallback label="Isolement" />}>
            <IsolementPage files={files} selectedDate={selectedDate} pointMap={pointMap} />
          </Suspense>
        </div>
      )}

      {effectiveTab === 'concordance' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          <ConcordanceTable events={events} pointNames={assignedPoints} concordance={concordance} onCellChange={onCellChange} />
        </div>
      )}

      {effectiveTab === 'vue3d' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          <Suspense fallback={<LazyTabFallback label="Vue 3D" />}>
            <Vue3DTab lwSources={lwSources} scene3D={scene3D} onScene3DChange={onScene3DChange} />
          </Suspense>
        </div>
      )}

      {effectiveTab === 'report' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          {hasChart ? (
            <ReportGenerator
              files={files} pointMap={pointMap} events={events}
              concordance={concordance} selectedDate={selectedDate}
              assignedPoints={assignedPoints}
              conformiteSummary={conformiteSummary}
              companyName={settings.companyName}
              meteo={meteo}
              periods={periods}
            />
          ) : (
            <EmptyState
              icon={<FileText size={40} />}
              text="Les données du projet apparaîtront ici une fois les mesures importées."
            />
          )}
        </div>
      )}

      {effectiveTab === 'history' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          <HistoryTab />
        </div>
      )}

      {effectiveTab === 'regulation' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          <RegulationTab />
        </div>
      )}

      {ENABLED_CARRIERE && effectiveTab === 'carriere' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          <Suspense fallback={<LazyTabFallback label="Carrière" />}>
            <CarrierePage state={carriereState} setState={setCarriereState} />
          </Suspense>
        </div>
      )}

      {effectiveTab === 'yamnet' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          <Suspense fallback={<LazyTabFallback label="Audio IA" />}>
            <YamnetClassifier
              audioFile={audioFile}
              segments={audioSegments}
              onSegmentsChange={onAudioSegmentsChange}
            />
          </Suspense>
        </div>
      )}

      {effectiveTab === 'ecme' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          <Suspense fallback={<LazyTabFallback label="ECME" />}>
            <EcmePage state={ecmeState} setState={setEcmeState} />
          </Suspense>
        </div>
      )}

      {effectiveTab === 'reafie' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          {hasChart ? (
            <Conformite2026
              files={chartFiles}
              pointMap={pointMap}
              selectedDate={selectedDate}
              onSummaryChange={onConformiteSummaryChange}
              receptor={conformiteReceptor}
              onReceptorChange={onConformiteReceptorChange}
              period={conformitePeriod}
              onPeriodChange={onConformitePeriodChange}
              periods={periods}
            />
          ) : (
            <EmptyState
              icon={<Shield size={40} />}
              text="Chargez des données et définissez le bruit résiduel pour évaluer la conformité."
            />
          )}
        </div>
      )}
    </main>
  )
}

/** Fallback minimaliste pour les modules lazy-loaded. */
function LazyTabFallback({ label }: { label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-2">
      <Loader2 size={18} className="animate-spin text-emerald-400" />
      <span className="text-xs">Chargement du module {label}…</span>
    </div>
  )
}

/** État vide unifié pour les onglets sans données. */
function EmptyState({
  icon,
  text,
  hint,
}: {
  icon: React.ReactNode
  text: string
  hint?: string
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3 px-8 text-center">
      <div className="text-gray-700 opacity-40">{icon}</div>
      <p className="text-sm text-gray-400 max-w-md">{text}</p>
      {hint && <p className="text-xs text-gray-600">{hint}</p>}
    </div>
  )
}

function TabButton({ active, onClick, icon, label, ...rest }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
  'aria-label'?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-label={rest['aria-label'] ?? label}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
        active
          ? 'bg-gray-800 text-gray-100 border border-gray-600'
          : 'text-gray-500 hover:text-gray-300 hover:bg-gray-900 border border-transparent'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Composant racine
// ---------------------------------------------------------------------------
export default function App() {
  const [files, setFiles] = useState<MeasurementFile[]>([])
  const [pointMap, setPointMap] = useState<Record<string, string>>({})
  // Labels personnalisés par point (ex: "BV-94" → "Récepteur Nord")
  const [pointLabels, setPointLabels] = useState<Record<string, string>>({})
  // Points créés par l'utilisateur (en plus de MEASUREMENT_POINTS)
  const [customPoints, setCustomPoints] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [events, setEvents] = useState<SourceEvent[]>([])
  const [concordance, setConcordance] = useState<Record<string, ConcordanceState>>({})
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [activeTab, setActiveTab] = useState<Tab>('chart')
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null)
  const [audioFile, setAudioFile] = useState<AudioFile | null>(null)
  const [chartTimeMin, setChartTimeMin] = useState<number | null>(null)
  const [conformiteSummary, setConformiteSummary] = useState<ConformiteSummary | null>(null)

  // Pas d'agrégation lifté ici pour partage entre chart, spectrogramme embarqué et plein écran
  // Défaut : 5 secondes (compromis lisibilité / résolution)
  const [aggregationSeconds, setAggregationSeconds] = useState<number>(30)
  const [spectrogramExpanded, setSpectrogramExpanded] = useState<boolean>(true)

  // Plan de site
  const [mapImage, setMapImage] = useState<string | null>(null)
  const [mapMarkers, setMapMarkers] = useState<Record<string, MarkerPos>>({})

  // Superposition multi-jours (max 1 jour superposé en plus du principal)
  const [overlayDate, setOverlayDate] = useState<string | null>(null)

  // Candidats événements (auto-détection)
  const [candidates, setCandidates] = useState<CandidateEvent[]>([])

  // Annotations textuelles (ancrées sur le graphique)
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([])
  const [pendingAnnotationText, setPendingAnnotationText] = useState<string | null>(null)

  // Conformité 2026 — récepteur et période lifted ici pour partage avec les templates
  const [conformiteReceptor, setConformiteReceptor] = useState<'I' | 'II' | 'III' | 'IV'>('I')
  const [conformitePeriod, setConformitePeriod] = useState<'jour' | 'nuit'>('jour')

  // Météo (saisie manuelle)
  const [meteo, setMeteo] = useState<MeteoData>(DEFAULT_METEO)

  // Checklist terrain (sauvegardée avec le projet)
  const [checklist, setChecklist] = useState<ChecklistState>(DEFAULT_CHECKLIST)
  const [checklistOpen, setChecklistOpen] = useState(false)

  // Segments audio classifiés par YAMNet (overlay sur le graphique principal)
  const [audioSegments, setAudioSegments] = useState<ClassifiedSegment[]>([])

  // États persistants des sous-onglets de Outils — préservent les uploads
  // et résultats quand l'utilisateur change d'onglet et revient.
  const [carriereState, setCarriereState] = useState<CarrierePageState>(EMPTY_CARRIERE_STATE)
  const [ecmeState, setEcmeState] = useState<EcmePageState>(EMPTY_ECME_STATE)

  // Sources Lw (partagées entre l'onglet Calcul Lw et Vue 3D)
  const [lwSources, setLwSources] = useState<LwSourceSummary[]>([])
  // Scène 3D (bâtiment + positions des sources)
  const [scene3D, setScene3D] = useState<Scene3DData | undefined>(undefined)

  // Mode présentation : masque sidebar + barre d'onglets
  const [presentationMode, setPresentationMode] = useState(false)

  // Fichiers audio en mode streaming (MP3/WAV/M4A/OGG) — parallèle au
  // système legacy `audioFile` (utilisé uniquement pour YAMNet).
  const [audioEntries, setAudioEntries] = useState<AudioFileEntry[]>([])
  const [audioPointMap, setAudioPointMap] = useState<Record<string, string>>({})
  // Fichiers en attente de calage manuel (date/heure saisie par l'utilisateur).
  // Consommé par le panneau de calage (feature suivante) — conservé ici pour
  // que le flux d'import puisse déjà signaler les fichiers non calés.
  const [_pendingAudioStart, setPendingAudioStart] = useState<AudioFileEntry | null>(null)
  void _pendingAudioStart
  const audioSync = useAudioSync(audioEntries)
  const handleAudioEntryAdd = useCallback((e: AudioFileEntry, point?: string) => {
    setAudioEntries((prev) => [...prev, e])
    if (point) setAudioPointMap((prev) => ({ ...prev, [e.id]: point }))
  }, [])
  const handleAudioEntryRemove = useCallback((id: string) => {
    setAudioEntries((prev) => {
      const removed = prev.find((e) => e.id === id)
      if (removed) try { URL.revokeObjectURL(removed.blobUrl) } catch { /* ignore */ }
      return prev.filter((e) => e.id !== id)
    })
    setAudioPointMap((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])
  const handleAudioPointChange = useCallback((id: string, point: string) => {
    setAudioPointMap((prev) => ({ ...prev, [id]: point }))
  }, [])
  // ── Panneau de calage audio ──────────────────────────────────────────
  const [calageEntryId, setCalageEntryId] = useState<string | null>(null)
  // Mode "pick" sur le chart : quand actif, le prochain clic sur le chart
  // (sans drag) remonte la minute absolue au lieu de lancer une sélection.
  const [chartPickArmed, setChartPickArmed] = useState(false)
  const chartPickCallbackRef = useRef<((tMin: number) => void) | null>(null)
  const requestChartPick = useCallback((cb: (tMin: number) => void) => {
    chartPickCallbackRef.current = cb
    setChartPickArmed(true)
  }, [])
  const cancelChartPick = useCallback(() => {
    chartPickCallbackRef.current = null
    setChartPickArmed(false)
  }, [])
  const handleChartPicked = useCallback((tMin: number) => {
    const cb = chartPickCallbackRef.current
    chartPickCallbackRef.current = null
    setChartPickArmed(false)
    if (cb) cb(tMin)
  }, [])

  // Idem pour un PICK DE PLAGE (drag sur le chart) — utilisé par l'onglet
  // Auto RMS du panneau de calage. Sélectionne [startMin, endMin] par drag.
  const [chartRangePickArmed, setChartRangePickArmed] = useState(false)
  const chartRangePickCallbackRef = useRef<((startMin: number, endMin: number) => void) | null>(null)
  const requestChartRangePick = useCallback(
    (cb: (startMin: number, endMin: number) => void) => {
      chartRangePickCallbackRef.current = cb
      setChartRangePickArmed(true)
    },
    [],
  )
  const cancelChartRangePick = useCallback(() => {
    chartRangePickCallbackRef.current = null
    setChartRangePickArmed(false)
  }, [])
  const handleChartRangePicked = useCallback((s: number, e: number) => {
    const cb = chartRangePickCallbackRef.current
    chartRangePickCallbackRef.current = null
    setChartRangePickArmed(false)
    if (cb) cb(s, e)
  }, [])

  // Fenêtre mise en évidence sur le chart (surlignage bleu pendant le mode
  // Auto RMS). null tant qu'aucune sélection n'a été validée.
  const [chartHighlightRange, setChartHighlightRange] = useState<{ startMin: number; endMin: number } | null>(null)
  const handleAudioCalageApply = useCallback(
    (id: string, patch: { startMin: number; date: string }) => {
      setAudioEntries((prev) => prev.map((e) => (e.id === id ? {
        ...e,
        startMin: patch.startMin,
        date: patch.date,
        caleStatus: 'calibrated' as const,
        calibratedAt: new Date().toISOString(),
        manualStart: false,
      } : e)))
    },
    [],
  )
  /** Importe un lot de fichiers audio : probe chacun, parse le nom et crée
   *  les AudioFileEntry correspondants. Auto-assignation du point quand
   *  le numéro de série d'un fichier de mesure déjà chargé apparaît dans
   *  le nom. En cas de timestamp partiel (date seulement) et de plusieurs
   *  fichiers de la même journée, on déduit les heures de début en enchaînant
   *  les durées. Si rien n'est extractible, on laisse `startMin=0` et on
   *  marque l'entrée pour que l'utilisateur la cale manuellement. */
  const handleAudioEntriesLoad = useCallback(async (rawFiles: File[]) => {
    // Lookup serial → point (et nom de fichier → point) depuis les mesures existantes
    const serialToPoint: Record<string, string> = {}
    for (const f of files) {
      const pt = pointMap[f.id]
      if (!pt || !f.serial) continue
      serialToPoint[f.serial] = pt
    }

    const probed: Array<{ file: File; blobUrl: string; durationSec: number; ext: AudioExt }> = []
    for (const raw of rawFiles) {
      const ext = audioExtOf(raw.name)
      if (!ext) continue
      try {
        const { blobUrl, durationSec } = await probeAudioFile(raw)
        probed.push({ file: raw, blobUrl, durationSec, ext })
      } catch (err) {
        console.warn('[audio] probe échoué', raw.name, err)
      }
    }
    if (probed.length === 0) return

    // Première passe : parsing du nom, détermination préliminaire de startMin
    const preEntries = probed.map(({ file, blobUrl, durationSec, ext }) => {
      const parsed = parseAudioFilename(file.name)
      const fallbackDate = files[0]?.date ?? new Date().toISOString().slice(0, 10)
      const date = parsed?.date ?? fallbackDate
      const startMin = parsed?.startMin ?? 0
      // Qualité initiale :
      //   - rouge  : pas de timestamp dans le nom
      //   - orange : pattern ambigu (YYMMDD_NNNN des enregistreurs)
      //   - jaune  : date ISO ou timestamp complet plausible
      //   - vert   : seulement après un calage utilisateur
      const caleStatus: AudioCaleStatus = !parsed
        ? 'none'
        : parsed.detected === 'none'
        ? 'none'
        : parsed.detected === 'uncertain'
        ? 'uncertain'
        : 'date_only'
      const entry: AudioFileEntry = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        ext,
        blobUrl,
        durationSec,
        date,
        startMin,
        parserResult: parsed
          ? { fileIndex: parsed.fileIndex ?? undefined, detected: parsed.detected }
          : { detected: 'none' },
        manualStart: !parsed || parsed.startMin === null,
        caleStatus,
      }
      return entry
    })

    // Deuxième passe : quand plusieurs fichiers d'un même jour n'ont qu'un
    // fileIndex, on déduit des heures de début consécutives (hypothèse
    // contiguë ancrée à 00:00).
    const seqEntries = preEntries.filter(
      (e) => e.parserResult?.fileIndex !== undefined && e.parserResult?.detected === 'dateOnly',
    )
    if (seqEntries.length > 1) {
      const seqMap = deriveStartTimesFromSequence(
        seqEntries.map((e) => ({
          id: e.id,
          date: e.date,
          fileIndex: e.parserResult?.fileIndex ?? null,
          durationSec: e.durationSec,
        })),
      )
      for (const e of preEntries) {
        if (seqMap[e.id] !== undefined) {
          e.startMin = seqMap[e.id]
          e.manualStart = false
        }
      }
    }

    // Ajout effectif avec auto-assignation des points
    for (const e of preEntries) {
      // Recherche d'un point via le numéro de série
      let point: string | undefined
      for (const [serial, pt] of Object.entries(serialToPoint)) {
        if (e.name.includes(serial)) {
          point = pt
          break
        }
      }
      handleAudioEntryAdd(e, point)
    }
    // Si au moins un fichier n'a pas pu être calé, on propose la saisie
    // manuelle sur le premier — l'utilisateur peut aussi utiliser le panneau
    // de calage plus tard (cf. feature suivante).
    const firstUncalibrated = preEntries.find((e) => e.manualStart)
    if (firstUncalibrated) setPendingAudioStart(firstUncalibrated)
  }, [files, pointMap, handleAudioEntryAdd])

  // Périodes nommées — filtre les données pour le calcul des indices
  const [periods, setPeriods] = useState<Period[]>([])
  const handlePeriodAdd = useCallback((p: Period) => {
    setPeriods((prev) => [...prev, p])
  }, [])
  const handlePeriodUpdate = useCallback((id: string, patch: Partial<Period>) => {
    setPeriods((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }, [])
  const handlePeriodRemove = useCallback((id: string) => {
    setPeriods((prev) => prev.filter((p) => p.id !== id))
  }, [])

  // Visibilité des courbes par point (toggle via légende/sidebar)
  const [hiddenPoints, setHiddenPoints] = useState<Set<string>>(new Set())
  const togglePointVisibility = useCallback((pt: string) => {
    setHiddenPoints((prev) => {
      const next = new Set(prev)
      if (next.has(pt)) next.delete(pt)
      else next.add(pt)
      return next
    })
  }, [])

  // Modal de comparaison de projets
  const [showComparison, setShowComparison] = useState(false)

  // Snapshot d'indices courants (utilisé par la modal de comparaison)
  const currentIndicesSnapshot = useMemo<Record<string, IndicesSnapshot>>(() => {
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
  }, [files, pointMap])

  // Templates utilisateurs
  const [userTemplates, setUserTemplates] = useState<ProjectTemplate[]>(loadUserTemplates)
  const allTemplates = useMemo<ProjectTemplate[]>(
    () => [...BUILTIN_TEMPLATES, ...userTemplates],
    [userTemplates],
  )

  // Multi-projet
  const [projectName, setProjectName] = useState(t('project.untitled'))
  const [projectId, setProjectId] = useState<string>(() => crypto.randomUUID())
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(loadRecent)

  // Paramètres
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)

  // Sidebar rétractable
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_KEY) === 'true'
  })

  // Chargement
  const [loading, setLoading] = useState(false)
  const [loadProgress, setLoadProgress] = useState(0)
  const [rejectedFiles, setRejectedFiles] = useState<RejectedFile[]>([])

  // Onboarding
  const [showOnboarding, setShowOnboarding] = useState(shouldShowOnboarding)

  // Dernier point assigné (pour auto-suggestion)
  const lastUsedPointRef = useRef('')

  // Ref pour ouvrir un projet depuis les raccourcis
  const projectInputRef = useRef<HTMLInputElement>(null)

  // Appliquer la langue au changement de paramètres
  useEffect(() => {
    setLanguage(settings.language)
    saveSettings(settings)
  }, [settings])

  // Persister l'état rétracté
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed))
  }, [sidebarCollapsed])

  // Dates disponibles
  const availableDates = useMemo(() => {
    const dates = new Set<string>()
    for (const f of files) { if (pointMap[f.id]) dates.add(f.date) }
    return [...dates].sort()
  }, [files, pointMap])

  const effectiveDate = availableDates.includes(selectedDate) ? selectedDate : (availableDates[0] ?? '')

  // Plages de couverture audio — alignées avec l'axe X du chart. En mode
  // multi-jours, chaque entrée est décalée de dayIndex × 1440 min.
  const audioCoverage = useMemo(() => {
    const isMulti = availableDates.length > 1 && !overlayDate
    const dayIndexOf = isMulti
      ? (d: string) => {
          const idx = availableDates.indexOf(d)
          return idx < 0 ? 0 : idx
        }
      : undefined
    return computeAudioCoverage(audioEntries, dayIndexOf)
  }, [audioEntries, availableDates, overlayDate])

  const assignedPoints = useMemo(() => {
    const pts = new Set<string>()
    for (const f of files) { if (pointMap[f.id]) pts.add(pointMap[f.id]) }
    return [...pts].sort()
  }, [files, pointMap])

  // Suggestion de regroupement en attente (bannière dans la sidebar).
  const [groupSuggestions, setGroupSuggestions] = useState<GroupSuggestion[]>([])

  // ---- Handlers fichiers ----
  const handleFilesAdded = useCallback((newFiles: MeasurementFile[]) => {
    let accepted: MeasurementFile[] = []
    setFiles((prev) => {
      // Doublon : même nom de fichier OU (même série + mêmes start/stop)
      const byName = new Set(prev.map((f) => f.name))
      const bySerialRange = new Set(
        prev.filter((f) => f.serial).map((f) => `${f.serial}|${f.date}|${f.startTime}|${f.stopTime}`),
      )
      accepted = []
      for (const f of newFiles) {
        const key = `${f.serial}|${f.date}|${f.startTime}|${f.stopTime}`
        if (byName.has(f.name) || (f.serial && bySerialRange.has(key))) {
          showToast(`Fichier déjà importé : ${f.name}`, 'info')
          continue
        }
        byName.add(f.name)
        if (f.serial) bySerialRange.add(key)
        accepted.push(f)
      }
      return [...prev, ...accepted]
    })
    // Auto-assigner le dernier point utilisé si un seul point existe
    setPointMap((prevMap) => {
      const pts = new Set(Object.values(prevMap).filter(Boolean))
      if (pts.size === 1) {
        const singlePoint = [...pts][0]
        const updated = { ...prevMap }
        for (const f of newFiles) {
          if (!updated[f.id]) updated[f.id] = singlePoint
        }
        return updated
      }
      return prevMap
    })
    setLoading(false)
    setLoadProgress(0)

    // Détection de regroupement : propose via une bannière (pas de confirm bloquant).
    setTimeout(() => {
      autoDetectGroupingRef.current(accepted)
    }, 0)
  }, [])

  // Détection de regroupement → met à jour groupSuggestions (bannière non bloquante).
  const autoDetectGrouping = (incoming: MeasurementFile[]) => {
    if (incoming.length < 2) return
    const currentPointMap = pointMapRef.current
    const bySerial = new Map<string, MeasurementFile[]>()
    for (const f of incoming) {
      const s = (f.serial || '').trim()
      if (!s) continue
      if (!bySerial.has(s)) bySerial.set(s, [])
      bySerial.get(s)!.push(f)
    }
    const suggestions: GroupSuggestion[] = []
    for (const [serial, group] of bySerial) {
      if (group.length < 2) continue
      if (group.some((f) => currentPointMap[f.id])) continue
      const { sessions } = detectSessions(group)
      // Ne propose que si une seule session continue (≤ 5 min gap entre chaque fichier).
      if (sessions.length !== 1) continue
      const sorted = sessions[0].files
      const model = sorted[0].model || '831C'
      suggestions.push({
        serial,
        model,
        suggestedPoint: `${model}-${serial}`,
        fileIds: sorted.map((f) => f.id),
        continuousDurationMin: sessions[0].durationMin,
        startISO: sessions[0].startISO,
        endISO: sessions[0].endISO,
      })
    }
    if (suggestions.length > 0) setGroupSuggestions((prev) => [...prev, ...suggestions])
  }
  const autoDetectGroupingRef = useRef(autoDetectGrouping)
  autoDetectGroupingRef.current = autoDetectGrouping
  const pointMapRef = useRef(pointMap)
  pointMapRef.current = pointMap

  function acceptGroupSuggestion(s: GroupSuggestion) {
    handleCreatePoint(s.suggestedPoint)
    setPointMap((prev) => {
      const next = { ...prev }
      for (const id of s.fileIds) next[id] = s.suggestedPoint
      return next
    })
    setGroupSuggestions((prev) => prev.filter((x) => x.serial !== s.serial))
    showToast(`Regroupés sous « ${s.suggestedPoint} »`, 'success')
  }
  function dismissGroupSuggestion(s: GroupSuggestion) {
    setGroupSuggestions((prev) => prev.filter((x) => x.serial !== s.serial))
  }
  function acceptAllGroupSuggestions() {
    for (const s of groupSuggestions) {
      handleCreatePoint(s.suggestedPoint)
    }
    setPointMap((prev) => {
      const next = { ...prev }
      for (const s of groupSuggestions) for (const id of s.fileIds) next[id] = s.suggestedPoint
      return next
    })
    setGroupSuggestions([])
    showToast(`${groupSuggestions.length} regroupement${groupSuggestions.length > 1 ? 's' : ''} appliqué${groupSuggestions.length > 1 ? 's' : ''}`, 'success')
  }

  // All known point names (default + custom + any from pointMap)
  const allPoints = useMemo(() => {
    const set = new Set([...MEASUREMENT_POINTS, ...customPoints])
    for (const pt of Object.values(pointMap)) { if (pt) set.add(pt) }
    return [...set].sort()
  }, [customPoints, pointMap])

  function handleCreatePoint(name: string) {
    if (!MEASUREMENT_POINTS.includes(name) && !customPoints.includes(name)) {
      setCustomPoints((prev) => [...prev, name])
    }
  }

  function handlePointChange(fileId: string, point: string) {
    setPointMap((prev) => ({ ...prev, [fileId]: point }))
    if (point) lastUsedPointRef.current = point
  }

  function handleFileRemove(fileId: string) {
    setFiles((prev) => prev.filter((f) => f.id !== fileId))
    setPointMap((prev) => { const n = { ...prev }; delete n[fileId]; return n })
  }

  function handleClearError(i: number) {
    setErrors((prev) => prev.filter((_, idx) => idx !== i))
  }

  // ---- Handlers événements ----
  function handleEventAdd(ev: SourceEvent) { setEvents((prev) => [...prev, ev]) }
  function handleEventRemove(id: string) { setEvents((prev) => prev.filter((ev) => ev.id !== id)) }

  // Paramètres de détection d'événements (sliders sous le bouton)
  const [detectParams, setDetectParams] = useState<{
    emergenceDb: number
    minDurationSec: number
    mergeGapSec: number
  }>({ emergenceDb: 6, minDurationSec: 10, mergeGapSec: 30 })

  // ---- Auto-détection des candidats événements ----
  const handleDetectCandidates = useCallback(() => {
    const out: CandidateEvent[] = []
    const byPointDate = new Map<string, MeasurementFile[]>()
    for (const f of files) {
      const pt = pointMap[f.id]
      if (!pt) continue
      const k = `${pt}|${f.date}`
      if (!byPointDate.has(k)) byPointDate.set(k, [])
      byPointDate.get(k)!.push(f)
    }
    for (const [key, fs] of byPointDate) {
      const [pt, day] = key.split('|')
      const data = fs.flatMap((f) => f.data).map((dp) => ({ t: dp.t, laeq: dp.laeq }))
      const detected = detectEmergenceEvents(data, {
        emergenceDb: detectParams.emergenceDb,
        minDurationSec: detectParams.minDurationSec,
        mergeGapSec: detectParams.mergeGapSec,
        baselineSec: 60,
      })
      for (const d of detected) {
        out.push({
          id: crypto.randomUUID(),
          point: pt,
          day,
          time: d.time,
          endTime: d.endTime,
          durationSec: d.durationSec,
          delta: d.emergence,
          laeq: d.laeq,
          lafmax: d.lafmax,
          baseline: d.baseline,
        })
      }
    }
    // Tri par émergence décroissante (les plus significatifs en premier)
    out.sort((a, b) => b.delta - a.delta)
    setCandidates(out)
  }, [files, pointMap, detectParams])

  function handleConfirmCandidate(id: string) {
    const c = candidates.find((x) => x.id === id)
    if (!c) return
    setCandidates((prev) => prev.filter((x) => x.id !== id))
    handleEventAdd({
      id: crypto.randomUUID(),
      label: `${c.point} +${c.delta.toFixed(0)} dB`,
      time: c.time,
      day: c.day,
      color: '#fb923c',
    })
  }
  function handleDismissCandidate(id: string) {
    setCandidates((prev) => prev.filter((x) => x.id !== id))
  }

  // ---- Annotations textuelles ----
  function handleAnnotationAdd(a: ChartAnnotation) {
    setAnnotations((prev) => [...prev, a])
  }
  function handleAnnotationRemove(id: string) {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
  }
  function handleAnnotationUpdate(id: string, text: string) {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, text } : a)))
  }

  // ---- Templates ----
  const handleSaveTemplate = useCallback(
    (name: string) => {
      const tpl: ProjectTemplate = {
        id: crypto.randomUUID(),
        name,
        pointNames: [...MEASUREMENT_POINTS],
        receptor: conformiteReceptor,
        period: conformitePeriod,
        yMin: settings.yAxisMin,
        yMax: settings.yAxisMax,
      }
      const next = [...userTemplates, tpl].slice(0, MAX_USER_TEMPLATES)
      setUserTemplates(next)
      saveUserTemplates(next)
    },
    [conformiteReceptor, conformitePeriod, settings.yAxisMin, settings.yAxisMax, userTemplates],
  )

  const handleApplyTemplate = useCallback(
    (tpl: ProjectTemplate) => {
      // Met à jour la configuration sans toucher aux fichiers/événements
      setConformiteReceptor(tpl.receptor)
      setConformitePeriod(tpl.period)
      setSettings((s) => ({ ...s, yAxisMin: tpl.yMin, yAxisMax: tpl.yMax }))
    },
    [],
  )

  const handleDeleteTemplate = useCallback(
    (id: string) => {
      const next = userTemplates.filter((t) => t.id !== id)
      setUserTemplates(next)
      saveUserTemplates(next)
    },
    [userTemplates],
  )

  // ---- Handlers concordance ----
  function handleCellChange(eventId: string, point: string, state: ConcordanceState) {
    setConcordance((prev) => ({ ...prev, [`${eventId}|${point}`]: state }))
  }

  // ---- Sérialisation état courant ----
  const serializeCurrentState = useCallback(() => {
    return JSON.stringify({
      files: files.map((f) => ({ id: f.id, name: f.name, model: f.model, serial: f.serial, date: f.date, startTime: f.startTime, stopTime: f.stopTime, rowCount: f.rowCount })),
      pointMap, events, concordance, mapImage, mapMarkers, meteo, checklist,
    })
  }, [files, pointMap, events, concordance, mapImage, mapMarkers, meteo, checklist])

  // ---- Handlers projet ----
  const handleSaveProject = useCallback(() => {
    saveProject(files, pointMap, events, concordance, mapImage, mapMarkers, meteo, projectName, checklist, scene3D)
    // Sauvegarder dans les projets récents
    const state = serializeCurrentState()
    const entry: RecentProject = { id: projectId, name: projectName, savedAt: new Date().toISOString(), state }
    setRecentProjects((prev) => {
      const filtered = prev.filter((p) => p.id !== projectId)
      const updated = [entry, ...filtered].slice(0, MAX_RECENT)
      saveRecent(updated)
      return updated
    })
  }, [files, pointMap, events, concordance, mapImage, mapMarkers, meteo, projectId, projectName, checklist, scene3D, serializeCurrentState])

  const handleLoadProject = useCallback((json: string) => {
    try {
      const { project, missingFiles } = loadProject(json, files)
      const fileIdByKey = new Map(files.map((f) => [`${f.name}|${f.date}`, f.id]))
      const newPointMap: Record<string, string> = {}
      for (const pf of project.files) {
        const currentId = fileIdByKey.get(`${pf.name}|${pf.date}`)
        if (currentId && project.pointAssignments[pf.id]) newPointMap[currentId] = project.pointAssignments[pf.id]
      }
      setPointMap(newPointMap)
      setEvents(project.events)
      setConcordance(project.concordance)
      if (project.mapImage !== undefined) setMapImage(project.mapImage ?? null)
      if (project.mapMarkers) setMapMarkers(project.mapMarkers)
      if (project.meteo) setMeteo(project.meteo)
      if (project.checklist) setChecklist(project.checklist)
      if (project.scene3D) setScene3D(project.scene3D)
      if (missingFiles.length > 0) {
        setErrors((prev) => [...prev, `${t('project.missingFiles')} : ${missingFiles.join(', ')}`])
      }
    } catch (err) {
      setErrors((prev) => [...prev, `${t('project.loadError')} : ${String(err)}`])
    }
  }, [files])

  // Nouveau projet
  const handleNewProject = useCallback(() => {
    // Sauvegarder l'état courant automatiquement
    if (files.length > 0) {
      const state = serializeCurrentState()
      const entry: RecentProject = { id: projectId, name: projectName, savedAt: new Date().toISOString(), state }
      setRecentProjects((prev) => {
        const filtered = prev.filter((p) => p.id !== projectId)
        const updated = [entry, ...filtered].slice(0, MAX_RECENT)
        saveRecent(updated)
        return updated
      })
    }
    // Reset
    setFiles([]); setPointMap({}); setErrors([]); setEvents([])
    setConcordance({}); setSelectedDate(''); setZoomRange(null); setAudioFile(null)
    setConformiteSummary(null)
    setMapImage(null); setMapMarkers({})
    setOverlayDate(null); setCandidates([])
    setAnnotations([]); setPendingAnnotationText(null)
    setPeriods([])
    setMeteo(DEFAULT_METEO)
    setChecklist(DEFAULT_CHECKLIST)
    setProjectId(crypto.randomUUID()); setProjectName(t('project.untitled'))
  }, [files, projectId, projectName, serializeCurrentState])

  // Restaurer un projet récent
  const handleSwitchProject = useCallback((rp: RecentProject) => {
    // Sauvegarder l'état courant
    if (files.length > 0) {
      const state = serializeCurrentState()
      const entry: RecentProject = { id: projectId, name: projectName, savedAt: new Date().toISOString(), state }
      setRecentProjects((prev) => {
        const filtered = prev.filter((p) => p.id !== projectId)
        const updated = [entry, ...filtered].slice(0, MAX_RECENT)
        saveRecent(updated)
        return updated
      })
    }
    // Restaurer le projet sélectionné
    try {
      const parsed = JSON.parse(rp.state)
      setProjectId(rp.id)
      setProjectName(rp.name)
      setEvents(parsed.events ?? [])
      setConcordance(parsed.concordance ?? {})
      setMapImage(parsed.mapImage ?? null)
      setMapMarkers(parsed.mapMarkers ?? {})
      // Les fichiers doivent être rechargés manuellement
      setFiles([]); setPointMap({}); setZoomRange(null); setAudioFile(null); setConformiteSummary(null)
      setOverlayDate(null); setCandidates([])
      setAnnotations([]); setPendingAnnotationText(null)
      setPeriods([])
      setMeteo(parsed.meteo ?? DEFAULT_METEO)
      setChecklist(parsed.checklist ?? DEFAULT_CHECKLIST)
      if (parsed.files?.length > 0) {
        setErrors([`${t('project.missingFiles')} : ${parsed.files.map((f: { name: string }) => f.name).join(', ')}`])
      }
    } catch {
      setErrors((prev) => [...prev, t('project.loadError')])
    }
  }, [files, projectId, projectName, serializeCurrentState])

  // ---- Paramètres ----
  const handleSettingsChange = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings)
  }, [])

  // ---- Audio ----
  const handleAudioSeek = useCallback((timeMin: number) => { setChartTimeMin(timeMin) }, [])

  // ---- Import avec Web Worker et progression ----
  const handleParseFiles = useCallback(async (rawFiles: File[]) => {
    setLoading(true)
    setLoadProgress(0)
    setRejectedFiles([])

    const total = rawFiles.length
    let completed = 0
    const parsed: MeasurementFile[] = []
    const rejected: RejectedFile[] = []

    for (const file of rawFiles) {
      try {
        const buf = await readAsArrayBuffer(file)

        // Utiliser le Web Worker pour les gros fichiers (> 1 Mo)
        if (buf.byteLength > 1_000_000) {
          const result = await new Promise<MeasurementFile>((resolve, reject) => {
            const worker = new Worker(
              new URL('./workers/parserWorker.ts', import.meta.url),
              { type: 'module' },
            )
            worker.onmessage = (e) => {
              const msg = e.data
              if (msg.type === 'progress') {
                // Progression intra-fichier
                const filePct = msg.percent / 100
                const overallPct = ((completed + filePct) / total) * 100
                setLoadProgress(Math.round(overallPct))
              } else if (msg.type === 'result') {
                worker.terminate()
                resolve(msg.file)
              } else if (msg.type === 'error') {
                worker.terminate()
                reject(new Error(msg.error))
              }
            }
            worker.onerror = (err) => {
              worker.terminate()
              reject(new Error(err.message))
            }
            worker.postMessage({ buffer: buf, fileName: file.name }, [buf])
          })
          parsed.push(result)
        } else {
          // Petit fichier : parser sur le thread principal
          parsed.push(parseFile(buf, file.name))
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        rejected.push({ name: file.name, error: msg })
      }
      completed++
      setLoadProgress(Math.round((completed / total) * 100))
    }

    if (parsed.length > 0) handleFilesAdded(parsed)
    if (rejected.length > 0) setRejectedFiles(rejected)
    setLoading(false)
    setLoadProgress(0)
  }, [handleFilesAdded])

  // ---- Bascule vers l'onglet Rapport via le menu Exporter du chart ----
  useEffect(() => {
    const onOpenReport = () => setActiveTab('report')
    document.addEventListener('acoustiq:open-report', onOpenReport)
    return () => document.removeEventListener('acoustiq:open-report', onOpenReport)
  }, [])

  // ---- Raccourcis clavier ----
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ne pas intercepter si on est dans un champ de saisie
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // Ctrl+S : sauvegarder
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSaveProject()
        return
      }

      // Ctrl+O : ouvrir projet
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault()
        projectInputRef.current?.click()
        return
      }

      // Échap : fermer panneaux ou quitter le mode présentation
      if (e.key === 'Escape') {
        setShowSettings(false)
        setShowShortcuts(false)
        setShowOnboarding(false)
        setShowChangelog(false)
        setPresentationMode(false)
        return
      }

      // Espace : play/pause audio (géré par AudioPlayer lui-même via state)
      // Mais on peut émettre un événement custom
      if (e.key === ' ') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('acoustiq:toggle-audio'))
        return
      }

      // Flèches : pan graphique
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        setZoomRange((prev) => {
          if (!prev) return prev
          const span = prev.endMin - prev.startMin
          const step = Math.max(5, span * 0.1)
          const delta = e.key === 'ArrowLeft' ? -step : step
          return {
            startMin: Math.round(prev.startMin + delta),
            endMin: Math.round(prev.endMin + delta),
          }
        })
        return
      }

      // +/- : zoom
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('acoustiq:zoom-in'))
        return
      }
      if (e.key === '-') {
        e.preventDefault()
        document.dispatchEvent(new CustomEvent('acoustiq:zoom-out'))
        return
      }

      // F : bascule mode présentation
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        setPresentationMode((v) => !v)
        return
      }

      // D : détection automatique d'événements
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        handleDetectCandidates()
        return
      }

      // R : reset du zoom (vue complète)
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        setZoomRange(null)
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleSaveProject, handleDetectCandidates])

  // Input caché pour Ctrl+O
  function handleProjectFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then(handleLoadProject)
    e.target.value = ''
  }

  return (
    <ToastProvider>
    <div className="flex min-h-screen font-sans">
      {/* Input caché pour Ctrl+O */}
      <input
        ref={projectInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleProjectFileInput}
      />

      {!presentationMode && (
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
        files={files}
        pointMap={pointMap}
        events={events}
        availableDates={availableDates}
        errors={errors}
        audioFile={audioFile}
        chartTimeMin={chartTimeMin}
        loading={loading}
        loadProgress={loadProgress}
        rejectedFiles={rejectedFiles}
        candidates={candidates}
        annotations={annotations}
        pendingAnnotationText={pendingAnnotationText}
        onAnnotationAdd={handleAnnotationAdd}
        onAnnotationRemove={handleAnnotationRemove}
        onAnnotationUpdate={handleAnnotationUpdate}
        onPendingAnnotationChange={setPendingAnnotationText}
        onOpenComparison={() => setShowComparison(true)}
        templates={allTemplates}
        userTemplateCount={userTemplates.length}
        onSaveTemplate={handleSaveTemplate}
        onApplyTemplate={handleApplyTemplate}
        onDeleteTemplate={handleDeleteTemplate}
        meteo={meteo}
        onMeteoChange={setMeteo}
        onOpenChecklist={() => setChecklistOpen(true)}
        pointLabels={pointLabels}
        allPoints={allPoints}
        onParseFiles={handleParseFiles}
        onPointChange={handlePointChange}
        onPointLabelChange={(pt, label) => setPointLabels((prev) => {
          const next = { ...prev }
          if (label) next[pt] = label; else delete next[pt]
          return next
        })}
        onCreatePoint={handleCreatePoint}
        onFileRemove={handleFileRemove}
        onEventAdd={handleEventAdd}
        onEventRemove={handleEventRemove}
        onClearError={handleClearError}
        onDetectCandidates={handleDetectCandidates}
        onConfirmCandidate={handleConfirmCandidate}
        onDismissCandidate={handleDismissCandidate}
        onSaveProject={handleSaveProject}
        onLoadProject={handleLoadProject}
        onAudioLoaded={setAudioFile}
        onAudioRemove={() => setAudioFile(null)}
        onAudioSeek={handleAudioSeek}
        audioEntries={audioEntries}
        audioPointMap={audioPointMap}
        audioCoverage={audioCoverage}
        onAudioEntriesLoad={handleAudioEntriesLoad}
        onAudioEntryRemove={handleAudioEntryRemove}
        onAudioEntryPointChange={handleAudioPointChange}
        onAudioPlayAt={audioSync.playAt}
        onOpenCalage={setCalageEntryId}
        groupSuggestions={groupSuggestions}
        onAcceptSuggestion={acceptGroupSuggestion}
        onDismissSuggestion={dismissGroupSuggestion}
        onAcceptAllSuggestions={acceptAllGroupSuggestions}
        hiddenPoints={hiddenPoints}
        onTogglePointVisibility={togglePointVisibility}
        detectParams={detectParams}
        onDetectParamsChange={setDetectParams}
      />
      )}
      <MainPanel
        files={files}
        pointMap={pointMap}
        pointLabels={pointLabels}
        events={events}
        concordance={concordance}
        selectedDate={effectiveDate}
        availableDates={availableDates}
        activeTab={activeTab}
        assignedPoints={assignedPoints}
        zoomRange={zoomRange}
        projectName={projectName}
        recentProjects={recentProjects}
        settings={settings}
        conformiteSummary={conformiteSummary}
        onConformiteSummaryChange={setConformiteSummary}
        aggregationSeconds={aggregationSeconds}
        onAggregationChange={setAggregationSeconds}
        spectrogramExpanded={spectrogramExpanded}
        onSpectrogramToggle={() => setSpectrogramExpanded((v) => !v)}
        onAddEvent={handleEventAdd}
        mapImage={mapImage}
        onMapImageChange={setMapImage}
        mapMarkers={mapMarkers}
        onMapMarkersChange={setMapMarkers}
        overlayDate={overlayDate}
        onOverlayDateChange={setOverlayDate}
        candidates={candidates}
        annotations={annotations}
        pendingAnnotationText={pendingAnnotationText}
        onAnnotationAdd={handleAnnotationAdd}
        onPendingAnnotationChange={setPendingAnnotationText}
        conformiteReceptor={conformiteReceptor}
        conformitePeriod={conformitePeriod}
        onConformiteReceptorChange={setConformiteReceptor}
        onConformitePeriodChange={setConformitePeriod}
        meteo={meteo}
        audioFile={audioFile}
        audioSegments={audioSegments}
        onAudioSegmentsChange={setAudioSegments}
        carriereState={carriereState}
        setCarriereState={setCarriereState}
        ecmeState={ecmeState}
        setEcmeState={setEcmeState}
        lwSources={lwSources}
        onLwSourcesChange={setLwSources}
        scene3D={scene3D}
        onScene3DChange={setScene3D}
        presentationMode={presentationMode}
        onPresentationToggle={() => setPresentationMode((v) => !v)}
        hiddenPoints={hiddenPoints}
        onTogglePointVisibility={togglePointVisibility}
        periods={periods}
        onPeriodAdd={handlePeriodAdd}
        onPeriodUpdate={handlePeriodUpdate}
        onPeriodRemove={handlePeriodRemove}
        audioEntries={audioEntries}
        audioPointMap={audioPointMap}
        audioSync={audioSync}
        audioCoverage={audioCoverage}
        chartPickArmed={chartPickArmed}
        onChartPicked={handleChartPicked}
        chartRangePickArmed={chartRangePickArmed}
        onChartRangePicked={handleChartRangePicked}
        chartHighlightRange={chartHighlightRange}
        onOpenAudioCalage={setCalageEntryId}
        onDateChange={setSelectedDate}
        onTabChange={setActiveTab}
        onCellChange={handleCellChange}
        onZoomChange={setZoomRange}
        onProjectNameChange={setProjectName}
        onNewProject={handleNewProject}
        onSwitchProject={handleSwitchProject}
        onOpenSettings={() => setShowSettings(true)}
        onOpenShortcuts={() => setShowShortcuts(true)}
        onOpenOnboarding={() => { resetOnboarding(); setShowOnboarding(true) }}
        onOpenChangelog={() => setShowChangelog(true)}
      />

      {/* Panneau de calage audio */}
      {calageEntryId && (() => {
        const entry = audioEntries.find((e) => e.id === calageEntryId)
        if (!entry) return null
        // Série LAeq par minute pour le jour de l'entrée — utilisée par le mode 3
        // (corrélation). Agrégation énergétique sur 1 minute.
        const laeqByMinute = new Array<number>(1440).fill(0)
        const buckets = new Array<{ pow: number; n: number }>(1440)
          .fill(null as unknown as { pow: number; n: number })
          .map(() => ({ pow: 0, n: 0 }))
        for (const f of files) {
          if (f.date !== entry.date) continue
          for (const dp of f.data) {
            const m = Math.floor(dp.t)
            if (m < 0 || m >= 1440) continue
            if (!Number.isFinite(dp.laeq)) continue
            buckets[m].pow += Math.pow(10, dp.laeq / 10)
            buckets[m].n += 1
          }
        }
        for (let m = 0; m < 1440; m++) {
          const { pow, n } = buckets[m]
          laeqByMinute[m] = n > 0 ? 10 * Math.log10(pow / n) : 0
        }

        // Jours de mesure disponibles pour le point assigné à cette entrée
        // — pour alimenter l'assistant « Je ne connais pas la date ».
        const assignedPoint = audioPointMap[entry.id]
        const measurementDays = (() => {
          if (!assignedPoint) return []
          const byDate = new Map<string, { startMin: number; endMin: number }>()
          for (const f of files) {
            if (pointMap[f.id] !== assignedPoint) continue
            const [h1, m1] = (f.startTime || '00:00').split(':')
            const [h2, m2] = (f.stopTime || '00:00').split(':')
            const sMin = parseInt(h1, 10) * 60 + parseInt(m1, 10)
            const eMin = parseInt(h2, 10) * 60 + parseInt(m2, 10)
            const existing = byDate.get(f.date)
            if (!existing) {
              byDate.set(f.date, { startMin: sMin, endMin: eMin })
            } else {
              byDate.set(f.date, {
                startMin: Math.min(existing.startMin, sMin),
                endMin: Math.max(existing.endMin, eMin),
              })
            }
          }
          return [...byDate.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, r]) => ({ date, startMin: r.startMin, endMin: r.endMin }))
        })()

        return (
          <AudioCalagePanel
            entry={entry}
            sync={audioSync}
            laeqByMinute={laeqByMinute}
            measurementDays={measurementDays}
            onRequestChartPick={requestChartPick}
            onCancelChartPick={cancelChartPick}
            onRequestChartRangePick={requestChartRangePick}
            onCancelChartRangePick={cancelChartRangePick}
            onHighlightRange={setChartHighlightRange}
            onApply={(patch) => handleAudioCalageApply(entry.id, patch)}
            onClose={() => {
              cancelChartPick()
              cancelChartRangePick()
              setChartHighlightRange(null)
              setCalageEntryId(null)
            }}
          />
        )
      })()}

      {/* Modales */}
      {showSettings && (
        <Settings
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showShortcuts && (
        <ShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}
      {showOnboarding && (
        <Onboarding
          language={settings.language}
          onClose={() => setShowOnboarding(false)}
        />
      )}
      {showChangelog && (
        <Changelog onClose={() => setShowChangelog(false)} />
      )}
      {showComparison && (
        <ComparisonModal
          currentIndices={currentIndicesSnapshot}
          currentProjectName={projectName}
          onClose={() => setShowComparison(false)}
        />
      )}
      <ChecklistModal
        open={checklistOpen}
        state={checklist}
        onChange={setChecklist}
        onClose={() => setChecklistOpen(false)}
      />
    </div>
    </ToastProvider>
  )
}
