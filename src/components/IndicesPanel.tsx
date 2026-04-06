/**
 * Panneau des indices acoustiques réglementaires
 * LAeq, L10, L50, L90, LAFmax, LAFmin — un tableau par point de mesure
 */
import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { Download } from 'lucide-react'
import type { MeasurementFile } from '../types'
import {
  laeqAvg,
  computeL10,
  computeL50,
  computeL90,
  computeLAFmax,
  computeLAFmin,
} from '../utils/acoustics'

// Palette partagée avec le graphique
const POINT_COLORS: Record<string, string> = {
  'BV-94':  '#10b981',
  'BV-98':  '#3b82f6',
  'BV-105': '#f59e0b',
  'BV-106': '#ef4444',
  'BV-37':  '#8b5cf6',
  'BV-107': '#06b6d4',
}
const FALLBACK_COLORS = ['#ec4899', '#84cc16', '#f97316', '#a78bfa']
function ptColor(pt: string, i: number) {
  return POINT_COLORS[pt] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
}

// Définition des lignes d'indices
const ROWS = [
  { key: 'laeq',   label: 'LAeq',   unit: 'dB(A)' },
  { key: 'l10',    label: 'L10',    unit: 'dB(A)' },
  { key: 'l50',    label: 'L50',    unit: 'dB(A)' },
  { key: 'l90',    label: 'L90',    unit: 'dB(A)' },
  { key: 'lafmax', label: 'LAFmax', unit: 'dB(A)' },
  { key: 'lafmin', label: 'LAFmin', unit: 'dB(A)' },
] as const

type IndexKey = (typeof ROWS)[number]['key']

interface IndexValues {
  laeq: number
  l10: number
  l50: number
  l90: number
  lafmax: number
  lafmin: number
}

/** Convertit HH:MM en minutes depuis minuit */
function hhmmToMin(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':')
  return parseInt(h, 10) * 60 + parseInt(m, 10)
}

function fmt(n: number): string {
  return n.toFixed(1)
}

interface Props {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
}

export default function IndicesPanel({ files, pointMap, selectedDate }: Props) {
  const [mode, setMode] = useState<'full' | 'custom'>('full')
  const [startTime, setStartTime] = useState('00:00')
  const [endTime, setEndTime] = useState('23:59')

  // Points actifs pour la journée sélectionnée
  const pointNames = useMemo(() => {
    const pts = new Set<string>()
    for (const f of files) {
      if (pointMap[f.id] && f.date === selectedDate) pts.add(pointMap[f.id])
    }
    return [...pts].sort()
  }, [files, pointMap, selectedDate])

  // Calcul des indices par point
  const indicesByPoint = useMemo((): Record<string, IndexValues | null> => {
    const startMin = mode === 'custom' ? hhmmToMin(startTime) : -Infinity
    const endMin = mode === 'custom' ? hhmmToMin(endTime) : Infinity

    return Object.fromEntries(
      pointNames.map((pt) => {
        const values = files
          .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
          .flatMap((f) => f.data)
          .filter((dp) => dp.t >= startMin && dp.t <= endMin)
          .map((dp) => dp.laeq)

        if (values.length === 0) return [pt, null]

        return [
          pt,
          {
            laeq:   laeqAvg(values),
            l10:    computeL10(values),
            l50:    computeL50(values),
            l90:    computeL90(values),
            lafmax: computeLAFmax(values),
            lafmin: computeLAFmin(values),
          } satisfies IndexValues,
        ]
      }),
    )
  }, [files, pointMap, selectedDate, mode, startTime, endTime, pointNames])

  // Export Excel des indices et données brutes
  function handleExportExcel() {
    const wb = XLSX.utils.book_new()

    // Feuille 1 : Indices
    const indicesRows = ROWS.map((row) => {
      const obj: Record<string, string | number> = { Indice: row.label }
      for (const pt of pointNames) {
        const vals = indicesByPoint[pt]
        obj[pt] = vals ? Math.round(vals[row.key as IndexKey] * 10) / 10 : 0
      }
      return obj
    })
    const wsIndices = XLSX.utils.json_to_sheet(indicesRows)
    XLSX.utils.book_append_sheet(wb, wsIndices, 'Indices')

    // Feuille 2 : Données brutes
    // Rassembler toutes les minutes uniques et les valeurs par point
    const rawByTime = new Map<number, Record<string, number>>()
    for (const pt of pointNames) {
      const ptFiles = files.filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
      for (const f of ptFiles) {
        for (const dp of f.data) {
          if (!rawByTime.has(dp.t)) rawByTime.set(dp.t, {})
          rawByTime.get(dp.t)![pt] = dp.laeq
        }
      }
    }
    const sortedTimes = [...rawByTime.keys()].sort((a, b) => a - b)
    const rawRows = sortedTimes.map((t) => {
      const h = Math.floor(t / 60) % 24
      const m = Math.round(t % 60)
      const obj: Record<string, string | number> = {
        Heure: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      }
      for (const pt of pointNames) {
        obj[`LAeq ${pt}`] = rawByTime.get(t)?.[pt] ?? ''
      }
      return obj
    })
    const wsRaw = XLSX.utils.json_to_sheet(rawRows)
    XLSX.utils.book_append_sheet(wb, wsRaw, 'Données brutes')

    XLSX.writeFile(wb, `acoustiq_indices_${selectedDate}.xlsx`)
  }

  if (pointNames.length === 0) return null

  return (
    <div className="border-t border-gray-800 bg-gray-900 shrink-0">
      {/* Barre de contrôle */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Indices acoustiques
        </span>

        <button
          onClick={handleExportExcel}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                     bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                     border border-gray-600 transition-colors ml-auto"
          title="Exporter les indices en Excel"
        >
          <Download size={12} />
          Exporter Excel
        </button>

        <div className="flex items-center gap-1">
          {/* Boutons de mode */}
          <button
            onClick={() => setMode('full')}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              mode === 'full'
                ? 'bg-emerald-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Pleine journée
          </button>
          <button
            onClick={() => setMode('custom')}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              mode === 'custom'
                ? 'bg-emerald-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            Personnalisé
          </button>

          {/* Sélecteurs horaires */}
          {mode === 'custom' && (
            <div className="flex items-center gap-1 ml-2">
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded px-1.5 py-0.5
                           focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <span className="text-gray-500 text-xs">→</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded px-1.5 py-0.5
                           focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* Tableau des indices */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-2 text-gray-500 font-medium w-24">Indice</th>
              {pointNames.map((pt, i) => (
                <th
                  key={pt}
                  className="px-4 py-2 font-semibold text-center"
                  style={{ color: ptColor(pt, i) }}
                >
                  {pt}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, ri) => (
              <tr
                key={row.key}
                className={ri % 2 === 0 ? 'bg-gray-900' : 'bg-gray-850'}
              >
                <td className="px-4 py-1.5 text-gray-400 font-medium">{row.label}</td>
                {pointNames.map((pt) => {
                  const vals = indicesByPoint[pt]
                  const v = vals ? (vals[row.key as IndexKey] as number) : null
                  return (
                    <td key={pt} className="px-4 py-1.5 text-center tabular-nums text-gray-200">
                      {v !== null ? (
                        <>
                          {fmt(v)}
                          <span className="text-gray-600 ml-0.5">{row.unit}</span>
                        </>
                      ) : (
                        <span className="text-gray-700">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
