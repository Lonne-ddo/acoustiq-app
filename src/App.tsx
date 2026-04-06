/**
 * Composant racine d'AcoustiQ
 * Gestion du chargement de fichiers, des événements, de la concordance et des onglets
 */
import { useState, useMemo, useRef } from 'react'
import {
  FileAudio,
  BarChart2,
  Activity,
  Upload,
  AlertCircle,
  X,
  TableProperties,
} from 'lucide-react'
import type { MeasurementFile, SourceEvent, ConcordanceState } from './types'
import { parse831C } from './modules/parser831C'
import TimeSeriesChart from './components/TimeSeriesChart'
import IndicesPanel from './components/IndicesPanel'
import EventsPanel from './components/EventsPanel'
import ConcordanceTable from './components/ConcordanceTable'

// Points de mesure disponibles
const MEASUREMENT_POINTS = ['BV-94', 'BV-98', 'BV-105', 'BV-106', 'BV-37', 'BV-107']

/** Lit un File en ArrayBuffer via FileReader */
function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target!.result as ArrayBuffer)
    reader.onerror = () => reject(new Error(`Impossible de lire le fichier : ${file.name}`))
    reader.readAsArrayBuffer(file)
  })
}

type Tab = 'chart' | 'concordance'

// ---------------------------------------------------------------------------
// Barre latérale
// ---------------------------------------------------------------------------
interface SidebarProps {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  events: SourceEvent[]
  availableDates: string[]
  errors: string[]
  onFilesAdded: (files: MeasurementFile[]) => void
  onPointChange: (fileId: string, point: string) => void
  onFileRemove: (fileId: string) => void
  onEventAdd: (ev: SourceEvent) => void
  onEventRemove: (id: string) => void
  onClearError: (i: number) => void
}

function Sidebar({
  files,
  pointMap,
  events,
  availableDates,
  errors,
  onFilesAdded,
  onPointChange,
  onFileRemove,
  onEventAdd,
  onEventRemove,
  onClearError,
}: SidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length === 0) return
    setLoading(true)
    const parsed: MeasurementFile[] = []
    for (const file of selected) {
      try {
        const buf = await readAsArrayBuffer(file)
        parsed.push(parse831C(buf, file.name))
      } catch (err) {
        // Les erreurs remontent via le state parent
        console.error(err)
      }
    }
    if (parsed.length > 0) onFilesAdded(parsed)
    setLoading(false)
    e.target.value = ''
  }

  return (
    <aside className="w-64 min-h-screen bg-gray-900 text-gray-100 flex flex-col border-r border-gray-700 shrink-0">
      {/* En-tête */}
      <div className="px-4 py-5 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="text-emerald-400" size={20} />
          <span className="font-bold text-lg tracking-tight">AcoustiQ</span>
        </div>
        <p className="text-xs text-gray-400 mt-1">Analyse acoustique environnementale</p>
      </div>

      {/* Bouton d'import */}
      <div className="px-3 py-3 border-b border-gray-700 shrink-0">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md
                     bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50
                     text-sm font-medium transition-colors"
        >
          <Upload size={14} />
          {loading ? 'Chargement…' : 'Importer des fichiers'}
        </button>
        <p className="text-xs text-gray-500 text-center mt-1">XLSX 831C / 821SE</p>
      </div>

      {/* Zone scrollable : erreurs + fichiers + événements */}
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

        {/* Liste des fichiers */}
        <div className="px-3 py-4 border-b border-gray-700">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Fichiers de mesure
          </p>

          {files.length === 0 ? (
            <div className="text-center text-gray-500 text-sm mt-4 px-2">
              <FileAudio size={28} className="mx-auto mb-2 opacity-40" />
              <p className="text-xs text-gray-600">Cliquez sur "Importer" ci-dessus</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {files.map((f) => (
                <li key={f.id} className="rounded-md px-3 py-2 bg-gray-800 border border-gray-700">
                  <div className="flex items-start gap-1">
                    <p className="text-sm font-medium truncate flex-1" title={f.name}>
                      {f.name}
                    </p>
                    <button
                      onClick={() => onFileRemove(f.id)}
                      className="text-gray-600 hover:text-red-400 shrink-0 mt-0.5 transition-colors"
                      title="Retirer"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{f.model} · {f.serial}</p>
                  <p className="text-xs text-gray-500">{f.date} · {f.startTime}–{f.stopTime}</p>
                  <p className="text-xs text-gray-600">{f.rowCount} points</p>
                  {/* Sélecteur de point */}
                  <div className="mt-2">
                    <select
                      value={pointMap[f.id] ?? ''}
                      onChange={(e) => onPointChange(f.id, e.target.value)}
                      className="w-full text-xs bg-gray-700 text-gray-100 border border-gray-600
                                 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="">— Assigner un point —</option>
                      {MEASUREMENT_POINTS.map((pt) => (
                        <option key={pt} value={pt}>{pt}</option>
                      ))}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Panneau événements */}
        <EventsPanel
          events={events}
          availableDates={availableDates}
          onAdd={onEventAdd}
          onRemove={onEventRemove}
        />
      </div>

      {/* Pied de page */}
      <div className="px-4 py-3 border-t border-gray-700 text-xs text-gray-500 shrink-0">
        v0.1.0
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
  onDateChange: (date: string) => void
  onTabChange: (tab: Tab) => void
  onCellChange: (eventId: string, point: string, state: ConcordanceState) => void
}

function MainPanel({
  files,
  pointMap,
  events,
  concordance,
  selectedDate,
  availableDates,
  activeTab,
  assignedPoints,
  onDateChange,
  onTabChange,
  onCellChange,
}: MainPanelProps) {
  const chartFiles = files.filter((f) => !!pointMap[f.id])
  const hasChart = chartFiles.length > 0

  return (
    <main className="flex-1 bg-gray-950 text-gray-100 flex flex-col min-w-0 overflow-hidden">
      {/* Barre de navigation : titre + onglets */}
      <header className="px-6 py-3 border-b border-gray-800 flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2">
          <BarChart2 size={18} className="text-emerald-400" />
          <h1 className="text-sm font-semibold text-gray-200">AcoustiQ</h1>
        </div>

        {/* Onglets */}
        <nav className="flex gap-1 ml-4">
          <TabButton
            active={activeTab === 'chart'}
            onClick={() => onTabChange('chart')}
            icon={<BarChart2 size={13} />}
            label="Visualisation"
          />
          <TabButton
            active={activeTab === 'concordance'}
            onClick={() => onTabChange('concordance')}
            icon={<TableProperties size={13} />}
            label="Concordance"
          />
        </nav>

        {hasChart && activeTab === 'chart' && (
          <span className="ml-auto text-xs text-gray-500">
            {chartFiles.length} fichier{chartFiles.length > 1 ? 's' : ''} affiché{chartFiles.length > 1 ? 's' : ''}
          </span>
        )}
      </header>

      {/* Contenu selon l'onglet */}
      {activeTab === 'chart' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {hasChart ? (
            <>
              {/* Graphique — prend tout l'espace disponible */}
              <div className="flex-1 min-h-0">
                <TimeSeriesChart
                  files={chartFiles}
                  pointMap={pointMap}
                  selectedDate={selectedDate}
                  availableDates={availableDates}
                  onDateChange={onDateChange}
                  events={events}
                />
              </div>
              {/* Indices — hauteur fixe en bas */}
              <IndicesPanel
                files={chartFiles}
                pointMap={pointMap}
                selectedDate={selectedDate}
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-600 gap-3">
              <BarChart2 size={48} className="opacity-20" />
              <p className="text-sm">Chargez un fichier et assignez-lui un point de mesure</p>
              {files.length > 0 && (
                <p className="text-xs text-gray-700">
                  {files.length} fichier{files.length > 1 ? 's' : ''} chargé{files.length > 1 ? 's' : ''} — en attente d'assignation
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'concordance' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <ConcordanceTable
            events={events}
            pointNames={assignedPoints}
            concordance={concordance}
            onCellChange={onCellChange}
          />
        </div>
      )}
    </main>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
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

  // Dates disponibles (fichiers avec point assigné)
  const availableDates = useMemo(() => {
    const dates = new Set<string>()
    for (const f of files) {
      if (pointMap[f.id]) dates.add(f.date)
    }
    return [...dates].sort()
  }, [files, pointMap])

  // Date effective : si la sélection courante n'est plus valide, on prend la première
  const effectiveDate = availableDates.includes(selectedDate)
    ? selectedDate
    : (availableDates[0] ?? '')

  // Points assignés (toutes journées confondues)
  const assignedPoints = useMemo(() => {
    const pts = new Set<string>()
    for (const f of files) {
      if (pointMap[f.id]) pts.add(pointMap[f.id])
    }
    return [...pts].sort()
  }, [files, pointMap])

  // ---- Handlers fichiers ----
  function handleFilesAdded(newFiles: MeasurementFile[]) {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}|${f.date}`))
      return [...prev, ...newFiles.filter((f) => !existing.has(`${f.name}|${f.date}`))]
    })
  }

  function handlePointChange(fileId: string, point: string) {
    setPointMap((prev) => ({ ...prev, [fileId]: point }))
  }

  function handleFileRemove(fileId: string) {
    setFiles((prev) => prev.filter((f) => f.id !== fileId))
    setPointMap((prev) => {
      const next = { ...prev }
      delete next[fileId]
      return next
    })
  }

  function handleClearError(index: number) {
    setErrors((prev) => prev.filter((_, i) => i !== index))
  }

  // ---- Handlers événements ----
  function handleEventAdd(ev: SourceEvent) {
    setEvents((prev) => [...prev, ev])
  }

  function handleEventRemove(id: string) {
    setEvents((prev) => prev.filter((ev) => ev.id !== id))
  }

  // ---- Handlers concordance ----
  function handleCellChange(eventId: string, point: string, state: ConcordanceState) {
    setConcordance((prev) => ({ ...prev, [`${eventId}|${point}`]: state }))
  }

  return (
    <div className="flex min-h-screen font-sans">
      <Sidebar
        files={files}
        pointMap={pointMap}
        events={events}
        availableDates={availableDates}
        errors={errors}
        onFilesAdded={handleFilesAdded}
        onPointChange={handlePointChange}
        onFileRemove={handleFileRemove}
        onEventAdd={handleEventAdd}
        onEventRemove={handleEventRemove}
        onClearError={handleClearError}
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
        onDateChange={setSelectedDate}
        onTabChange={setActiveTab}
        onCellChange={handleCellChange}
      />
    </div>
  )
}
