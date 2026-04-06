/**
 * Tableau de concordance : événements × points de mesure
 * Chaque cellule cycle entre Confirmé / Incertain / Non visible
 * Export CSV disponible
 */
import { Download } from 'lucide-react'
import type { SourceEvent, ConcordanceState } from '../types'

// Définition des états et de leur rendu
const STATES: ConcordanceState[] = ['Non visible', 'Confirmé', 'Incertain']

const STATE_STYLE: Record<ConcordanceState, string> = {
  'Confirmé':    'bg-emerald-900/60 text-emerald-300 border border-emerald-700 hover:bg-emerald-800/60',
  'Incertain':   'bg-amber-900/50 text-amber-300 border border-amber-700 hover:bg-amber-800/50',
  'Non visible': 'bg-gray-800/60 text-gray-500 border border-gray-700 hover:bg-gray-700/60',
}

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

/** Génère et télécharge un fichier CSV avec BOM UTF-8 pour Excel */
function exportCSV(
  events: SourceEvent[],
  points: string[],
  concordance: Record<string, ConcordanceState>,
) {
  const header = ['Événement', 'Date', 'Heure', ...points].join(';')
  const rows = events.map((ev) => {
    const cells = points.map((pt) => concordance[`${ev.id}|${pt}`] ?? 'Non visible')
    return [ev.label, ev.day, ev.time, ...cells].join(';')
  })
  const csv = '\uFEFF' + [header, ...rows].join('\n')  // BOM pour Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'concordance_acoustiq.csv'
  a.click()
  URL.revokeObjectURL(url)
}

interface Props {
  events: SourceEvent[]
  pointNames: string[]
  concordance: Record<string, ConcordanceState>
  onCellChange: (eventId: string, point: string, state: ConcordanceState) => void
}

export default function ConcordanceTable({ events, pointNames, concordance, onCellChange }: Props) {
  function cycleCell(eventId: string, point: string) {
    const current = concordance[`${eventId}|${point}`] ?? 'Non visible'
    const idx = STATES.indexOf(current)
    const next = STATES[(idx + 1) % STATES.length]
    onCellChange(eventId, point, next)
  }

  const isEmpty = events.length === 0 || pointNames.length === 0

  return (
    <div className="flex flex-col h-full">
      {/* Barre d'outils */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-4 text-xs text-gray-500">
          <LegendDot color="bg-emerald-600" label="Confirmé" />
          <LegendDot color="bg-amber-600" label="Incertain" />
          <LegendDot color="bg-gray-600" label="Non visible" />
          <span className="text-gray-700">· Cliquer pour changer l'état</span>
        </div>
        <button
          onClick={() => exportCSV(events, pointNames, concordance)}
          disabled={isEmpty}
          className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded
                     bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Download size={12} />
          Exporter CSV
        </button>
      </div>

      {/* Zone tableau */}
      <div className="flex-1 overflow-auto p-4">
        {isEmpty ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm flex-col gap-2">
            <p>
              {events.length === 0
                ? 'Aucun événement défini — ajoutez des événements dans la barre latérale.'
                : 'Aucun point de mesure assigné — chargez des fichiers et assignez-leur un point.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs border-separate border-spacing-1">
              <thead>
                <tr>
                  {/* Colonne en-tête événement */}
                  <th className="text-left px-3 py-2 text-gray-400 font-medium min-w-40 sticky left-0 bg-gray-950">
                    Événement
                  </th>
                  <th className="text-left px-3 py-2 text-gray-400 font-medium whitespace-nowrap sticky left-40 bg-gray-950">
                    Date · Heure
                  </th>
                  {/* Colonnes points */}
                  {pointNames.map((pt, i) => (
                    <th
                      key={pt}
                      className="px-3 py-2 font-semibold text-center min-w-32"
                      style={{ color: ptColor(pt, i) }}
                    >
                      {pt}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id}>
                    {/* Libellé événement */}
                    <td className="px-3 py-1.5 sticky left-0 bg-gray-950">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: ev.color }}
                        />
                        <span className="text-gray-200 font-medium">{ev.label}</span>
                      </div>
                    </td>
                    {/* Date · Heure */}
                    <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap sticky left-40 bg-gray-950">
                      {ev.day} · {ev.time}
                    </td>
                    {/* Cellules d'état */}
                    {pointNames.map((pt) => {
                      const state = concordance[`${ev.id}|${pt}`] ?? 'Non visible'
                      return (
                        <td key={pt} className="px-1 py-1 text-center">
                          <button
                            onClick={() => cycleCell(ev.id, pt)}
                            className={`w-full px-2 py-1 rounded text-xs font-medium transition-colors ${STATE_STYLE[state]}`}
                          >
                            {state}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
      {label}
    </span>
  )
}
