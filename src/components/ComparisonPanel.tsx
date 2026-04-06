/**
 * Panneau de comparaison ON/OFF pour isoler la contribution d'une source
 * Calcule LAeq ON vs OFF, delta, contribution estimée de la source
 */
import { useMemo } from 'react'
import * as XLSX from 'xlsx'
import { Download } from 'lucide-react'
import HelpTooltip from './HelpTooltip'
import type { MeasurementFile } from '../types'
import { laeqAvg, sourceContribution } from '../utils/acoustics'

interface TimeRange {
  start: string  // HH:MM
  end: string
}

interface Props {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  onRange: TimeRange
  offRange: TimeRange
}

function hhmmToMin(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':')
  return parseInt(h, 10) * 60 + parseInt(m, 10)
}

function fmt(n: number): string {
  return n.toFixed(1)
}

/** Indicateur de confiance basé sur le delta ON-OFF */
function confidenceBadge(delta: number) {
  if (delta >= 3) return { label: 'Significatif', cls: 'bg-emerald-900/60 text-emerald-300' }
  if (delta >= 1) return { label: 'Incertain', cls: 'bg-amber-900/50 text-amber-300' }
  return { label: 'Non significatif', cls: 'bg-red-900/50 text-red-300' }
}

export default function ComparisonPanel({
  files, pointMap, selectedDate, onRange, offRange,
}: Props) {
  // Points actifs
  const pointNames = useMemo(() => {
    const pts = new Set<string>()
    for (const f of files) {
      if (pointMap[f.id] && f.date === selectedDate) pts.add(pointMap[f.id])
    }
    return [...pts].sort()
  }, [files, pointMap, selectedDate])

  // Calculs par point
  const results = useMemo(() => {
    const onStart = hhmmToMin(onRange.start)
    const onEnd = hhmmToMin(onRange.end)
    const offStart = hhmmToMin(offRange.start)
    const offEnd = hhmmToMin(offRange.end)

    return pointNames.map((pt) => {
      const allData = files
        .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
        .flatMap((f) => f.data)

      const onValues = allData
        .filter((dp) => dp.t >= onStart && dp.t <= onEnd)
        .map((dp) => dp.laeq)
      const offValues = allData
        .filter((dp) => dp.t >= offStart && dp.t <= offEnd)
        .map((dp) => dp.laeq)

      const laeqOn = onValues.length > 0 ? laeqAvg(onValues) : null
      const laeqOff = offValues.length > 0 ? laeqAvg(offValues) : null
      const delta = laeqOn !== null && laeqOff !== null ? laeqOn - laeqOff : null
      const lSource = laeqOn !== null && laeqOff !== null
        ? sourceContribution(laeqOn, laeqOff) : null

      return { point: pt, laeqOn, laeqOff, delta, lSource }
    })
  }, [files, pointMap, selectedDate, pointNames, onRange, offRange])

  // Export Excel
  function handleExport() {
    const wb = XLSX.utils.book_new()
    const rows = results.map((r) => ({
      Point: r.point,
      'LAeq ON dB(A)': r.laeqOn !== null ? Math.round(r.laeqOn * 10) / 10 : '',
      'LAeq OFF dB(A)': r.laeqOff !== null ? Math.round(r.laeqOff * 10) / 10 : '',
      'Delta dB': r.delta !== null ? Math.round(r.delta * 10) / 10 : '',
      'Lsource dB(A)': r.lSource !== null ? Math.round(r.lSource * 10) / 10 : 'N/A',
      'Confiance': r.delta !== null ? confidenceBadge(r.delta).label : '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, 'Comparaison ON-OFF')
    XLSX.writeFile(wb, `acoustiq_comparaison_${selectedDate}.xlsx`)
  }

  if (pointNames.length === 0) return null

  return (
    <div className="border-t border-gray-800 bg-gray-900 shrink-0 animate-[fadeIn_0.15s_ease-out]">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Comparaison ON / OFF
        </span>
        <HelpTooltip
          text="Lsource = 10·log₁₀(10^(Ltotal/10) - 10^(Lrésiduel/10)). Significatif si delta > 3 dB."
          position="right"
        />
        <span className="text-xs text-gray-600 ml-auto">
          ON : {onRange.start}–{onRange.end} · OFF : {offRange.start}–{offRange.end}
        </span>
        <button
          onClick={handleExport}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                     bg-gray-800 text-gray-300 hover:bg-gray-700
                     border border-gray-600 transition-colors"
        >
          <Download size={12} />
          Excel
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800">
              <th className="text-left px-4 py-2 text-gray-500 font-medium">Point</th>
              <th className="px-4 py-2 text-gray-500 font-medium text-center">LAeq ON</th>
              <th className="px-4 py-2 text-gray-500 font-medium text-center">LAeq OFF</th>
              <th className="px-4 py-2 text-gray-500 font-medium text-center">Delta</th>
              <th className="px-4 py-2 text-gray-500 font-medium text-center">Lsource</th>
              <th className="px-4 py-2 text-gray-500 font-medium text-center">Confiance</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const badge = r.delta !== null ? confidenceBadge(r.delta) : null
              return (
                <tr key={r.point} className="border-b border-gray-800/50">
                  <td className="px-4 py-1.5 text-gray-200 font-medium">{r.point}</td>
                  <td className="px-4 py-1.5 text-center tabular-nums text-gray-200">
                    {r.laeqOn !== null ? fmt(r.laeqOn) : '—'}
                  </td>
                  <td className="px-4 py-1.5 text-center tabular-nums text-gray-200">
                    {r.laeqOff !== null ? fmt(r.laeqOff) : '—'}
                  </td>
                  <td className="px-4 py-1.5 text-center tabular-nums font-semibold text-gray-100">
                    {r.delta !== null ? `${r.delta >= 0 ? '+' : ''}${fmt(r.delta)}` : '—'}
                  </td>
                  <td className="px-4 py-1.5 text-center tabular-nums text-gray-200">
                    {r.lSource !== null ? fmt(r.lSource) : 'N/A'}
                  </td>
                  <td className="px-4 py-1.5 text-center">
                    {badge && (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.cls}`}>
                        {badge.label}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
