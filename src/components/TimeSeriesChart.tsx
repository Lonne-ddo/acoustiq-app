/**
 * Composant de visualisation temporelle des niveaux LAeq
 * Une courbe par point de mesure, agrégation à 5 minutes
 * Les événements de sources s'affichent comme lignes verticales tiretées
 */
import { useMemo } from 'react'
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
import type { MeasurementFile, SourceEvent } from '../types'
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
  /** Date sélectionnée, contrôlée par le parent */
  selectedDate: string
  /** Toutes les dates disponibles pour le sélecteur */
  availableDates: string[]
  onDateChange: (date: string) => void
  /** Événements à afficher comme lignes de référence */
  events: SourceEvent[]
}

export default function TimeSeriesChart({
  files,
  pointMap,
  selectedDate,
  availableDates,
  onDateChange,
  events,
}: Props) {
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

  // Événements filtrés pour la journée affichée
  const activeEvents = useMemo(
    () => events.filter((ev) => ev.day === selectedDate),
    [events, selectedDate],
  )

  if (pointNames.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Aucune donnée à afficher pour la journée sélectionnée.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Barre de contrôle : sélecteur de jour */}
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
        <span className="text-xs text-gray-600 ml-auto">
          Agrégation 5 min · {chartData.length} points
          {activeEvents.length > 0 && ` · ${activeEvents.length} événement(s)`}
        </span>
      </div>

      {/* Graphique */}
      <div className="flex-1 min-h-0 px-4 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
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
  )
}
