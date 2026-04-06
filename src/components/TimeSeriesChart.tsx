/**
 * Composant de visualisation temporelle des niveaux LAeq
 * Une courbe par point de mesure, agrégation à 5 minutes
 * Zoom molette, pan clic+glisser, double-clic = reset
 * Les événements de sources s'affichent comme lignes verticales tiretées
 */
import { useMemo, useRef, useCallback, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import html2canvas from 'html2canvas'
import { Download, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react'
import type { MeasurementFile, SourceEvent } from '../types'
import type { ZoomRange } from '../types'
import { laeqAvg } from '../utils/acoustics'

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

function getPointColor(point: string, index: number): string {
  return POINT_COLORS[point] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

/** Convertit des minutes depuis minuit en chaîne HH:MM */
function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = Math.round(minutes % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Arrondit une heure HH:MM au bucket de 5 minutes inférieur
 * pour aligner les événements avec les données du graphique
 */
function snapToFiveMin(time: string): string {
  const [h = '0', m = '0'] = time.split(':')
  const totalMin = parseInt(h, 10) * 60 + parseInt(m, 10)
  return minutesToHHMM(Math.floor(totalMin / 5) * 5)
}

interface ChartEntry {
  t: number
  label: string
  [point: string]: number | string
}

interface Props {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  availableDates: string[]
  onDateChange: (date: string) => void
  events: SourceEvent[]
  /** Plage de zoom partagée avec le spectrogramme */
  zoomRange: ZoomRange | null
  onZoomChange: (range: ZoomRange | null) => void
}

// Zoom minimum en minutes
const MIN_ZOOM_SPAN = 15

export default function TimeSeriesChart({
  files,
  pointMap,
  selectedDate,
  availableDates,
  onDateChange,
  events,
  zoomRange,
  onZoomChange,
}: Props) {
  const chartRef = useRef<HTMLDivElement>(null)
  const chartAreaRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartRange = useRef<ZoomRange | null>(null)

  // Export PNG via html2canvas
  const handleExportPNG = useCallback(async () => {
    if (!chartRef.current) return
    const canvas = await html2canvas(chartRef.current, { backgroundColor: '#030712' })
    const link = document.createElement('a')
    const points = [...new Set(files.map((f) => pointMap[f.id]).filter(Boolean))].sort().join('_')
    link.download = `acoustiq_${points || 'chart'}_${selectedDate}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [files, pointMap, selectedDate])

  // Fichiers actifs pour la journée sélectionnée, regroupés par point
  const filesByPoint = useMemo(() => {
    const map = new Map<string, MeasurementFile[]>()
    for (const f of files) {
      const pt = pointMap[f.id]
      if (!pt || f.date !== selectedDate) continue
      if (!map.has(pt)) map.set(pt, [])
      map.get(pt)!.push(f)
    }
    return map
  }, [files, pointMap, selectedDate])

  const pointNames = [...filesByPoint.keys()].sort()

  // Construction des données du graphique (buckets de 5 minutes)
  const chartData = useMemo((): ChartEntry[] => {
    const buckets = new Map<number, Map<string, number[]>>()

    for (const [pt, ptFiles] of filesByPoint) {
      for (const f of ptFiles) {
        for (const dp of f.data) {
          const bucket = Math.floor(dp.t / 5) * 5
          if (!buckets.has(bucket)) buckets.set(bucket, new Map())
          const ptBucket = buckets.get(bucket)!
          if (!ptBucket.has(pt)) ptBucket.set(pt, [])
          ptBucket.get(pt)!.push(dp.laeq)
        }
      }
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([t, ptMap]) => {
        const entry: ChartEntry = { t, label: minutesToHHMM(t) }
        for (const [pt, vals] of ptMap) {
          entry[pt] = Math.round(laeqAvg(vals) * 10) / 10
        }
        return entry
      })
  }, [filesByPoint])

  // Plage temporelle globale des données
  const fullRange = useMemo((): ZoomRange => {
    if (chartData.length === 0) return { startMin: 0, endMin: 1440 }
    return {
      startMin: chartData[0].t,
      endMin: chartData[chartData.length - 1].t,
    }
  }, [chartData])

  // Plage effective (zoom ou pleine)
  const effectiveRange = zoomRange ?? fullRange

  // Données filtrées par la plage de zoom
  const visibleData = useMemo(() => {
    return chartData.filter((d) => d.t >= effectiveRange.startMin && d.t <= effectiveRange.endMin)
  }, [chartData, effectiveRange])

  // Événements filtrés pour la journée affichée
  const activeEvents = useMemo(
    () => events.filter((ev) => ev.day === selectedDate),
    [events, selectedDate],
  )

  // --- Gestionnaires zoom/pan ---

  // Zoom centré sur la position du curseur
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const rect = chartAreaRef.current?.getBoundingClientRect()
    if (!rect) return

    const range = effectiveRange
    const span = range.endMin - range.startMin
    // Position relative du curseur (0 à 1)
    const cursorFrac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const cursorMin = range.startMin + cursorFrac * span

    // Facteur de zoom : scroll vers le haut = zoom in
    const factor = e.deltaY > 0 ? 1.3 : 0.7
    const newSpan = Math.max(MIN_ZOOM_SPAN, span * factor)

    // Limites globales
    const globalSpan = fullRange.endMin - fullRange.startMin
    if (newSpan >= globalSpan) {
      onZoomChange(null)
      return
    }

    let newStart = cursorMin - cursorFrac * newSpan
    let newEnd = cursorMin + (1 - cursorFrac) * newSpan

    // Clamper aux limites
    if (newStart < fullRange.startMin) {
      newStart = fullRange.startMin
      newEnd = newStart + newSpan
    }
    if (newEnd > fullRange.endMin) {
      newEnd = fullRange.endMin
      newStart = newEnd - newSpan
    }

    onZoomChange({
      startMin: Math.max(fullRange.startMin, Math.round(newStart)),
      endMin: Math.min(fullRange.endMin, Math.round(newEnd)),
    })
  }, [effectiveRange, fullRange, onZoomChange])

  // Pan par clic+glisser
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    setDragging(true)
    dragStartX.current = e.clientX
    dragStartRange.current = { ...effectiveRange }
  }, [effectiveRange])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging || !dragStartRange.current) return
    const rect = chartAreaRef.current?.getBoundingClientRect()
    if (!rect) return

    const dx = e.clientX - dragStartX.current
    const span = dragStartRange.current.endMin - dragStartRange.current.startMin
    const minutesDelta = -(dx / rect.width) * span

    let newStart = dragStartRange.current.startMin + minutesDelta
    let newEnd = dragStartRange.current.endMin + minutesDelta

    // Clamper aux limites
    if (newStart < fullRange.startMin) {
      newStart = fullRange.startMin
      newEnd = newStart + span
    }
    if (newEnd > fullRange.endMin) {
      newEnd = fullRange.endMin
      newStart = newEnd - span
    }

    onZoomChange({
      startMin: Math.round(newStart),
      endMin: Math.round(newEnd),
    })
  }, [dragging, fullRange, onZoomChange])

  const handleMouseUp = useCallback(() => {
    setDragging(false)
    dragStartRange.current = null
  }, [])

  // Double-clic = reset zoom
  const handleDoubleClick = useCallback(() => {
    onZoomChange(null)
  }, [onZoomChange])

  // Boutons zoom +/-
  const handleZoomIn = useCallback(() => {
    const range = effectiveRange
    const span = range.endMin - range.startMin
    const newSpan = Math.max(MIN_ZOOM_SPAN, span * 0.6)
    const center = (range.startMin + range.endMin) / 2
    onZoomChange({
      startMin: Math.max(fullRange.startMin, Math.round(center - newSpan / 2)),
      endMin: Math.min(fullRange.endMin, Math.round(center + newSpan / 2)),
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
      startMin: Math.max(fullRange.startMin, Math.round(newStart)),
      endMin: Math.min(fullRange.endMin, Math.round(newEnd)),
    })
  }, [effectiveRange, fullRange, onZoomChange])

  const handleReset = useCallback(() => {
    onZoomChange(null)
  }, [onZoomChange])

  const isZoomed = zoomRange !== null

  if (pointNames.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Aucune donnée à afficher pour la journée sélectionnée.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Barre de contrôle : sélecteur de jour + zoom + export */}
      <div className="flex items-center gap-4 px-6 py-2.5 border-b border-gray-800 shrink-0">
        {availableDates.length > 1 ? (
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 font-medium">Journée</label>
            <select
              value={selectedDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                         px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {availableDates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        ) : (
          <span className="text-xs text-gray-500">{selectedDate}</span>
        )}

        {/* Plage visible */}
        {isZoomed && (
          <span className="text-xs text-emerald-400 font-medium">
            {minutesToHHMM(effectiveRange.startMin)} → {minutesToHHMM(effectiveRange.endMin)}
          </span>
        )}

        {/* Boutons de zoom */}
        <div className="flex items-center gap-1 ml-auto">
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
            title="Zoom -"
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
            title="Vue complète"
          >
            <Maximize2 size={14} />
          </button>
        </div>

        <span className="text-xs text-gray-600 mr-2">
          Agrégation 5 min · {visibleData.length} points
          {activeEvents.length > 0 && ` · ${activeEvents.length} événement(s)`}
        </span>
        <button
          onClick={handleExportPNG}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                     bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                     border border-gray-600 transition-colors"
          title="Exporter en PNG"
        >
          <Download size={12} />
          Exporter PNG
        </button>
      </div>

      {/* Graphique avec zoom/pan interactif */}
      <div
        ref={chartAreaRef}
        className={`flex-1 min-h-0 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        <div ref={chartRef} className="h-full px-4 py-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visibleData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />

              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={{ stroke: '#374151' }}
                interval="preserveStartEnd"
              />

              <YAxis
                domain={[30, 90]}
                tickCount={7}
                unit=" dB"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={{ stroke: '#374151' }}
                width={56}
              />

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
              />

              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
                formatter={(value) => (
                  <span style={{ color: '#d1d5db' }}>{value}</span>
                )}
              />

              {/* Lignes de données */}
              {pointNames.map((pt, i) => (
                <Line
                  key={pt}
                  type="monotone"
                  dataKey={pt}
                  name={pt}
                  stroke={getPointColor(pt, i)}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
              ))}

              {/* Lignes verticales des événements */}
              {activeEvents.map((ev) => (
                <ReferenceLine
                  key={ev.id}
                  x={snapToFiveMin(ev.time)}
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
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
