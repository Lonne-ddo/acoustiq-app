/**
 * Composant racine d'AcoustiQ
 * Multi-projet, paramètres, raccourcis clavier, sidebar rétractable, états de chargement
 */
import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import {
  FileAudio,
  BarChart2,
  Activity,
  Upload,
  AlertCircle,
  X,
  TableProperties,
  Layers,
  Calculator,
  FileText,
  Save,
  FolderOpen,
  Settings as SettingsIcon,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
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
} from './types'
import { parse831C } from './modules/parser831C'
import { parse821SE, detect821SE } from './modules/parser821SE'
import { saveProject, loadProject } from './modules/projectManager'
import { loadSettings, saveSettings } from './modules/settings'
import { t, setLanguage } from './modules/i18n'
import TimeSeriesChart from './components/TimeSeriesChart'
import IndicesPanel from './components/IndicesPanel'
import EventsPanel from './components/EventsPanel'
import ConcordanceTable from './components/ConcordanceTable'
import Spectrogram from './components/Spectrogram'
import LwCalculator from './components/LwCalculator'
import ReportGenerator from './components/ReportGenerator'
import AudioPlayer from './components/AudioPlayer'
import Settings from './components/Settings'
import ShortcutsModal from './components/ShortcutsModal'
import Onboarding, { shouldShowOnboarding, resetOnboarding } from './components/Onboarding'
import { ToastProvider } from './components/Toast'

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
    throw new Error(`Échec de lecture de "${fileName}" :\n  831C : ${err831C}\n  821SE : ${err821SE}`)
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

type Tab = 'chart' | 'spectrogram' | 'lw' | 'concordance' | 'report'

const FILE_LIST_LIMIT = 10

/** Liste de fichiers groupée par date, avec bordure couleur du point */
function FileList({ files, pointMap, onPointChange, onFileRemove }: {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  onPointChange: (fileId: string, point: string) => void
  onFileRemove: (fileId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  // Grouper par date
  const grouped = useMemo(() => {
    const map = new Map<string, MeasurementFile[]>()
    for (const f of files) {
      const date = f.date || 'Sans date'
      if (!map.has(date)) map.set(date, [])
      map.get(date)!.push(f)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [files])

  // Limiter si pas étendu
  const allFiles = grouped.flatMap(([, fs]) => fs)
  const visibleCount = expanded ? allFiles.length : FILE_LIST_LIMIT
  const hasMore = allFiles.length > FILE_LIST_LIMIT && !expanded
  let rendered = 0

  return (
    <>
      {grouped.map(([date, dateFiles]) => {
        const remaining = visibleCount - rendered
        if (remaining <= 0) return null
        const visible = dateFiles.slice(0, remaining)
        rendered += visible.length

        return (
          <div key={date}>
            {grouped.length > 1 && (
              <p className="text-xs text-gray-600 font-medium mt-2 mb-1">{date}</p>
            )}
            <ul className="space-y-2">
              {visible.map((f) => {
                const pt = pointMap[f.id]
                const borderColor = pt ? POINT_COLORS[pt] ?? '#374151' : '#374151'
                return (
                  <li
                    key={f.id}
                    className="rounded-md px-3 py-2 bg-gray-800 border border-gray-700"
                    style={{ borderLeftWidth: 3, borderLeftColor: borderColor }}
                  >
                    <div className="flex items-start gap-1">
                      <p className="text-sm font-medium truncate flex-1" title={f.name}>{f.name}</p>
                      <button
                        onClick={() => onFileRemove(f.id)}
                        className="text-gray-600 hover:text-red-400 shrink-0 mt-0.5 transition-colors"
                        title={t('sidebar.remove')}
                        aria-label={`Retirer ${f.name}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      <span className="mr-1">&#127908;</span>
                      {f.model} · {f.serial}
                    </p>
                    <p className="text-xs text-gray-500">
                      {f.startTime} → {f.stopTime}
                    </p>
                    <p className="text-xs text-gray-600">{f.rowCount} {t('chart.points')}</p>
                    <div className="mt-2">
                      <select
                        value={pointMap[f.id] ?? ''}
                        onChange={(e) => onPointChange(f.id, e.target.value)}
                        aria-label={`Point de mesure pour ${f.name}`}
                        className="w-full text-xs bg-gray-700 text-gray-100 border border-gray-600
                                   rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="">{t('sidebar.assignPoint')}</option>
                        {MEASUREMENT_POINTS.map((pt) => (
                          <option key={pt} value={pt}>{pt}</option>
                        ))}
                      </select>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      {hasMore && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full mt-2 text-xs text-emerald-400 hover:text-emerald-300 py-1 transition-colors"
        >
          Afficher les {allFiles.length - FILE_LIST_LIMIT} fichiers restants
        </button>
      )}
      {expanded && allFiles.length > FILE_LIST_LIMIT && (
        <button
          onClick={() => setExpanded(false)}
          className="w-full mt-1 text-xs text-gray-500 hover:text-gray-300 py-1 transition-colors"
        >
          Réduire la liste
        </button>
      )}
    </>
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
  onPointChange: (fileId: string, point: string) => void
  onFileRemove: (fileId: string) => void
  onEventAdd: (ev: SourceEvent) => void
  onEventRemove: (id: string) => void
  onClearError: (i: number) => void
  onSaveProject: () => void
  onLoadProject: (json: string) => void
  onParseFiles: (files: File[]) => void
  onAudioLoaded: (audio: AudioFile) => void
  onAudioRemove: () => void
  onAudioSeek: (timeMin: number) => void
}

function Sidebar({
  collapsed, onToggle,
  files, pointMap, events, availableDates, errors,
  audioFile, chartTimeMin, loading, loadProgress, rejectedFiles,
  onPointChange, onFileRemove,
  onEventAdd, onEventRemove, onClearError,
  onSaveProject, onLoadProject, onParseFiles,
  onAudioLoaded, onAudioRemove, onAudioSeek,
}: SidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length === 0) return
    onParseFiles(selected)
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
    const xlsx = droppedFiles.filter((f) => f.name.endsWith('.xlsx'))
    const wav = droppedFiles.filter((f) => f.name.endsWith('.wav'))
    const json = droppedFiles.filter((f) => f.name.endsWith('.json'))
    if (xlsx.length > 0) onParseFiles(xlsx)
    if (wav.length > 0 && wav[0]) {
      // Charger le premier .wav
      readAsArrayBuffer(wav[0]).then(async (buf) => {
        const ctx = new AudioContext()
        const decoded = await ctx.decodeAudioData(buf)
        await ctx.close()
        onAudioLoaded({
          id: crypto.randomUUID(),
          name: wav[0].name,
          date: extractDateFromName(wav[0].name) ?? '',
          buffer: decoded,
          duration: decoded.duration,
          startOffsetMin: 0,
        })
      })
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
      className={`w-64 min-h-screen bg-gray-900 text-gray-100 flex flex-col border-r shrink-0 transition-colors ${
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
          <button onClick={onToggle} className="ml-auto p-0.5 text-gray-600 hover:text-gray-300 transition-colors">
            <ChevronLeft size={14} />
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">{t('sidebar.subtitle')}</p>
      </div>

      {/* Import + projet */}
      <div className="px-3 py-3 border-b border-gray-700 shrink-0">
        <input ref={inputRef} type="file" accept=".xlsx" multiple className="hidden" onChange={handleFileChange} />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md
                     bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50
                     text-sm font-medium transition-colors"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {loading ? t('sidebar.loading') : t('sidebar.import')}
        </button>

        {/* Barre de progression */}
        {loading && loadProgress > 0 && (
          <div className="mt-1.5 w-full bg-gray-800 rounded-full h-1">
            <div
              className="bg-emerald-500 h-1 rounded-full transition-all duration-300"
              style={{ width: `${loadProgress}%` }}
            />
          </div>
        )}

        <p className="text-xs text-gray-500 text-center mt-1">{t('sidebar.importHint')}</p>

        <div className="flex gap-1.5 mt-2">
          <input ref={projectInputRef} type="file" accept=".json" className="hidden" onChange={handleProjectLoad} />
          <button
            onClick={onSaveProject}
            disabled={files.length === 0}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded
                       bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-30
                       text-xs font-medium border border-gray-600 transition-colors"
          >
            <Save size={11} />
            {t('sidebar.save')}
          </button>
          <button
            onClick={() => projectInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded
                       bg-gray-800 text-gray-300 hover:bg-gray-700
                       text-xs font-medium border border-gray-600 transition-colors"
          >
            <FolderOpen size={11} />
            {t('sidebar.open')}
          </button>
        </div>
      </div>

      {/* Zone scrollable */}
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

        {/* Fichiers */}
        <div className="px-3 py-4 border-b border-gray-700">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            {t('sidebar.files')}
          </p>
          {files.length === 0 ? (
            <div className="text-center text-gray-500 text-sm mt-4 px-2">
              <FileAudio size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-xs text-gray-600">{t('sidebar.filesEmpty')}</p>
            </div>
          ) : (
            <FileList
              files={files}
              pointMap={pointMap}
              onPointChange={onPointChange}
              onFileRemove={onFileRemove}
            />
          )}

          {/* Fichiers non supportés */}
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
        </div>

        {/* Audio */}
        {audioFile ? (
          <AudioPlayer
            audio={audioFile}
            chartTimeMin={chartTimeMin}
            onSeek={onAudioSeek}
            onRemove={onAudioRemove}
          />
        ) : (
          <div className="px-3 py-3 border-b border-gray-700">
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

        {/* Événements */}
        <EventsPanel
          events={events}
          availableDates={availableDates}
          onAdd={onEventAdd}
          onRemove={onEventRemove}
        />
      </div>

      <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-500 shrink-0">
        v0.2.0
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
}

function MainPanel({
  files, pointMap, events, concordance,
  selectedDate, availableDates, activeTab, assignedPoints, zoomRange,
  projectName, recentProjects, settings,
  onDateChange, onTabChange, onCellChange, onZoomChange,
  onProjectNameChange, onNewProject, onSwitchProject,
  onOpenSettings, onOpenShortcuts, onOpenOnboarding,
}: MainPanelProps) {
  const chartFiles = files.filter((f) => !!pointMap[f.id])
  const hasChart = chartFiles.length > 0
  const [showRecent, setShowRecent] = useState(false)

  return (
    <main className="flex-1 bg-gray-950 text-gray-100 flex flex-col min-w-0 overflow-hidden">
      {/* Barre de navigation */}
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

        {/* Onglets */}
        <nav className="flex gap-1 ml-4">
          {([
            ['chart', <BarChart2 size={13} key="c" />, t('tab.visualization')],
            ['spectrogram', <Layers size={13} key="s" />, t('tab.spectrogram')],
            ['lw', <Calculator size={13} key="l" />, t('tab.lw')],
            ['concordance', <TableProperties size={13} key="t" />, t('tab.concordance')],
            ['report', <FileText size={13} key="r" />, t('tab.report')],
          ] as [Tab, React.ReactNode, string][]).map(([id, icon, label]) => (
            <TabButton key={id} active={activeTab === id} onClick={() => onTabChange(id)} icon={icon} label={label} aria-label={label} />
          ))}
        </nav>

        {/* Actions header */}
        <div className="flex items-center gap-1 ml-auto">
          {hasChart && activeTab === 'chart' && (
            <span className="text-xs text-gray-500 mr-2">
              {chartFiles.length} {t('chart.filesShown')}
            </span>
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
        </div>
      </header>

      {/* Contenu selon l'onglet */}
      {activeTab === 'chart' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          {hasChart ? (
            <>
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
                />
              </div>
              <IndicesPanel files={chartFiles} pointMap={pointMap} selectedDate={selectedDate} />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-600 gap-3">
              <BarChart2 size={48} className="opacity-20" />
              <p className="text-sm">{t('general.loadFile')}</p>
              {files.length > 0 && (
                <p className="text-xs text-gray-700">
                  {files.length} fichier{files.length > 1 ? 's' : ''} — {t('general.waitingAssign')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'spectrogram' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          <Spectrogram
            files={chartFiles} pointMap={pointMap} selectedDate={selectedDate}
            availableDates={availableDates} onDateChange={onDateChange}
            events={events} zoomRange={zoomRange}
          />
        </div>
      )}

      {activeTab === 'lw' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]"><LwCalculator /></div>
      )}

      {activeTab === 'concordance' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          <ConcordanceTable events={events} pointNames={assignedPoints} concordance={concordance} onCellChange={onCellChange} />
        </div>
      )}

      {activeTab === 'report' && (
        <div className="flex-1 min-h-0 overflow-hidden animate-[fadeIn_0.15s_ease-out]">
          <ReportGenerator
            files={files} pointMap={pointMap} events={events}
            concordance={concordance} selectedDate={selectedDate}
            assignedPoints={assignedPoints}
          />
        </div>
      )}
    </main>
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
  const [errors, setErrors] = useState<string[]>([])
  const [events, setEvents] = useState<SourceEvent[]>([])
  const [concordance, setConcordance] = useState<Record<string, ConcordanceState>>({})
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [activeTab, setActiveTab] = useState<Tab>('chart')
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(null)
  const [audioFile, setAudioFile] = useState<AudioFile | null>(null)
  const [chartTimeMin, setChartTimeMin] = useState<number | null>(null)

  // Multi-projet
  const [projectName, setProjectName] = useState(t('project.untitled'))
  const [projectId, setProjectId] = useState<string>(() => crypto.randomUUID())
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(loadRecent)

  // Paramètres
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

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

  const assignedPoints = useMemo(() => {
    const pts = new Set<string>()
    for (const f of files) { if (pointMap[f.id]) pts.add(pointMap[f.id]) }
    return [...pts].sort()
  }, [files, pointMap])

  // ---- Handlers fichiers ----
  const handleFilesAdded = useCallback((newFiles: MeasurementFile[]) => {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}|${f.date}`))
      return [...prev, ...newFiles.filter((f) => !existing.has(`${f.name}|${f.date}`))]
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
  }, [])

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

  // ---- Handlers concordance ----
  function handleCellChange(eventId: string, point: string, state: ConcordanceState) {
    setConcordance((prev) => ({ ...prev, [`${eventId}|${point}`]: state }))
  }

  // ---- Sérialisation état courant ----
  const serializeCurrentState = useCallback(() => {
    return JSON.stringify({
      files: files.map((f) => ({ id: f.id, name: f.name, model: f.model, serial: f.serial, date: f.date, startTime: f.startTime, stopTime: f.stopTime, rowCount: f.rowCount })),
      pointMap, events, concordance,
    })
  }, [files, pointMap, events, concordance])

  // ---- Handlers projet ----
  const handleSaveProject = useCallback(() => {
    saveProject(files, pointMap, events, concordance)
    // Sauvegarder dans les projets récents
    const state = serializeCurrentState()
    const entry: RecentProject = { id: projectId, name: projectName, savedAt: new Date().toISOString(), state }
    setRecentProjects((prev) => {
      const filtered = prev.filter((p) => p.id !== projectId)
      const updated = [entry, ...filtered].slice(0, MAX_RECENT)
      saveRecent(updated)
      return updated
    })
  }, [files, pointMap, events, concordance, projectId, projectName, serializeCurrentState])

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
      // Les fichiers doivent être rechargés manuellement
      setFiles([]); setPointMap({}); setZoomRange(null); setAudioFile(null)
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

      // Échap : fermer panneaux
      if (e.key === 'Escape') {
        setShowSettings(false)
        setShowShortcuts(false)
        setShowOnboarding(false)
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
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleSaveProject])

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
        onParseFiles={handleParseFiles}
        onPointChange={handlePointChange}
        onFileRemove={handleFileRemove}
        onEventAdd={handleEventAdd}
        onEventRemove={handleEventRemove}
        onClearError={handleClearError}
        onSaveProject={handleSaveProject}
        onLoadProject={handleLoadProject}
        onAudioLoaded={setAudioFile}
        onAudioRemove={() => setAudioFile(null)}
        onAudioSeek={handleAudioSeek}
      />
      <MainPanel
        files={files}
        pointMap={pointMap}
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
      />

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
    </div>
    </ToastProvider>
  )
}
