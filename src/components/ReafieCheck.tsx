/**
 * Vérification de conformité réglementaire REAFIE
 * Seuils par type de zone et période horaire
 */
import { useState, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { Download, CheckCircle, XCircle, AlertTriangle, Shield } from 'lucide-react'
import HelpTooltip from './HelpTooltip'
import type { MeasurementFile } from '../types'
import { laeqAvg } from '../utils/acoustics'

// Types de zones
type ZoneType = 'residential' | 'commercial' | 'industrial'
type Period = 'day' | 'evening' | 'night'

const ZONE_LABELS: Record<ZoneType, string> = {
  residential: 'Résidentiel',
  commercial: 'Commercial',
  industrial: 'Industriel',
}

const PERIOD_LABELS: Record<Period, string> = {
  day: 'Jour (7h–19h)',
  evening: 'Soirée (19h–22h)',
  night: 'Nuit (22h–7h)',
}

// Plages horaires en minutes
const PERIOD_RANGES: Record<Period, [number, number]> = {
  day: [420, 1140],     // 7h–19h
  evening: [1140, 1320], // 19h–22h
  night: [1320, 1860],   // 22h–7h (cycle étendu, filtré avec modulo)
}

// Seuils REAFIE en dB(A)
const THRESHOLDS: Record<ZoneType, Record<Period, number>> = {
  residential: { day: 45, evening: 40, night: 40 },
  commercial:  { day: 55, evening: 50, night: 45 },
  industrial:  { day: 60, evening: 55, night: 55 },
}

interface Props {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
}

function fmt(n: number): string {
  return n.toFixed(1)
}

/** Filtre les données par période horaire */
function filterByPeriod(data: { t: number; laeq: number }[], period: Period): number[] {
  const [start, end] = PERIOD_RANGES[period]
  if (period === 'night') {
    // La nuit couvre 22h–7h (traverse minuit)
    return data
      .filter((dp) => dp.t >= 1320 || dp.t < 420)
      .map((dp) => dp.laeq)
  }
  return data
    .filter((dp) => dp.t >= start && dp.t < end)
    .map((dp) => dp.laeq)
}

export default function ReafieCheck({ files, pointMap, selectedDate }: Props) {
  const [zone, setZone] = useState<ZoneType>('residential')
  const [notes, setNotes] = useState<Record<string, string>>({})

  // Points actifs
  const pointNames = useMemo(() => {
    const pts = new Set<string>()
    for (const f of files) {
      if (pointMap[f.id] && f.date === selectedDate) pts.add(pointMap[f.id])
    }
    return [...pts].sort()
  }, [files, pointMap, selectedDate])

  // Calcul LAeq par point × période
  const results = useMemo(() => {
    const periods: Period[] = ['day', 'evening', 'night']
    return pointNames.map((pt) => {
      const allData = files
        .filter((f) => pointMap[f.id] === pt && f.date === selectedDate)
        .flatMap((f) => f.data)

      const byPeriod = Object.fromEntries(
        periods.map((p) => {
          const values = filterByPeriod(allData, p)
          const laeq = values.length > 0 ? laeqAvg(values) : null
          const threshold = THRESHOLDS[zone][p]
          const pass = laeq !== null ? laeq <= threshold : null
          return [p, { laeq, threshold, pass, count: values.length }]
        }),
      ) as Record<Period, { laeq: number | null; threshold: number; pass: boolean | null; count: number }>

      return { point: pt, periods: byPeriod }
    })
  }, [files, pointMap, selectedDate, pointNames, zone])

  // Export Excel
  function handleExport() {
    const wb = XLSX.utils.book_new()
    const periods: Period[] = ['day', 'evening', 'night']
    const rows = results.flatMap((r) =>
      periods.map((p) => ({
        Point: r.point,
        Période: PERIOD_LABELS[p],
        'LAeq mesuré dB(A)': r.periods[p].laeq !== null ? Math.round(r.periods[p].laeq! * 10) / 10 : '',
        'Seuil dB(A)': r.periods[p].threshold,
        Conformité: r.periods[p].pass === null ? '' : r.periods[p].pass ? 'Conforme' : 'Non conforme',
        Observations: notes[`${r.point}|${p}`] ?? '',
      })),
    )
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, 'Conformité REAFIE')

    // Feuille de synthèse
    const summary = [{
      Zone: ZONE_LABELS[zone],
      Date: selectedDate,
      'Points analysés': pointNames.join(', '),
      'Résultat global': results.every((r) =>
        Object.values(r.periods).every((p) => p.pass !== false)
      ) ? 'Conforme' : 'Non-conformité détectée',
    }]
    const wsSummary = XLSX.utils.json_to_sheet(summary)
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Synthèse')

    XLSX.writeFile(wb, `acoustiq_reafie_${selectedDate}.xlsx`)
  }

  const periods: Period[] = ['day', 'evening', 'night']

  return (
    <div className="flex flex-col h-full">
      {/* Barre de contrôle */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-emerald-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Conformité REAFIE
          </span>
          <HelpTooltip
            text="Vérification des seuils réglementaires selon l'arrêté du 31/01/2012 relatif aux ICPE."
            position="right"
          />
        </div>

        {/* Sélecteur de zone */}
        <div className="flex items-center gap-2 ml-4">
          <span className="text-xs text-gray-500">Zone :</span>
          {(['residential', 'commercial', 'industrial'] as ZoneType[]).map((z) => (
            <button
              key={z}
              onClick={() => setZone(z)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                zone === z
                  ? 'bg-emerald-700 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {ZONE_LABELS[z]}
            </button>
          ))}
        </div>

        <button
          onClick={handleExport}
          disabled={pointNames.length === 0}
          className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs font-medium
                     bg-gray-800 text-gray-300 hover:bg-gray-700
                     border border-gray-600 transition-colors disabled:opacity-30"
        >
          <Download size={12} />
          Exporter Excel
        </button>
      </div>

      {/* Contenu */}
      <div className="flex-1 overflow-auto p-4">
        {pointNames.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
            <Shield size={48} className="opacity-20" />
            <p className="text-sm">Chargez des fichiers et assignez-les à des points de mesure</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Seuils de référence */}
            <div className="flex gap-6 px-2">
              {periods.map((p) => (
                <div key={p} className="text-xs text-gray-500">
                  {PERIOD_LABELS[p]} : <span className="text-gray-300 font-medium">{THRESHOLDS[zone][p]} dB(A)</span>
                </div>
              ))}
            </div>

            {/* Tableau de résultats */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2 text-gray-500 font-medium">Point</th>
                    {periods.map((p) => (
                      <th key={p} className="px-4 py-2 text-gray-500 font-medium text-center" colSpan={2}>
                        {PERIOD_LABELS[p]}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-gray-800">
                    <th />
                    {periods.map((p) => (
                      <th key={p} className="px-2 py-1 text-gray-600 font-normal text-center" colSpan={2}>
                        <span className="text-gray-600">LAeq / Seuil {THRESHOLDS[zone][p]}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.point} className="border-b border-gray-800/50">
                      <td className="px-4 py-2 text-gray-200 font-medium">{r.point}</td>
                      {periods.map((p) => {
                        const d = r.periods[p]
                        return (
                          <td key={p} className="px-4 py-2 text-center" colSpan={2}>
                            {d.laeq !== null ? (
                              <div className="flex items-center justify-center gap-2">
                                <span className="tabular-nums text-gray-200">{fmt(d.laeq)}</span>
                                {d.pass ? (
                                  <CheckCircle size={14} className="text-emerald-400" />
                                ) : (
                                  <XCircle size={14} className="text-red-400" />
                                )}
                              </div>
                            ) : (
                              <span className="text-gray-700">—</span>
                            )}
                            {d.count > 0 && (
                              <span className="text-gray-600 block">{d.count} pts</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Notes par point */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Observations
              </p>
              {pointNames.map((pt) => (
                <div key={pt} className="flex items-start gap-2">
                  <span className="text-xs text-gray-400 font-medium w-16 shrink-0 pt-1">{pt}</span>
                  <input
                    type="text"
                    value={notes[pt] ?? ''}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [pt]: e.target.value }))}
                    placeholder="Observations..."
                    className="flex-1 text-xs bg-gray-800 text-gray-200 border border-gray-700 rounded
                               px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              ))}
            </div>

            {/* Résumé global */}
            <div className="mt-4 px-3 py-2 rounded border border-gray-700 bg-gray-800/50">
              {results.every((r) => Object.values(r.periods).every((p) => p.pass !== false)) ? (
                <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium">
                  <CheckCircle size={14} />
                  Tous les points sont conformes aux seuils {ZONE_LABELS[zone].toLowerCase()}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-amber-400 text-xs font-medium">
                  <AlertTriangle size={14} />
                  Non-conformité détectée — vérifier les points en dépassement
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
