/**
 * Tableau de filtrage horaire — affiché après l'analyse.
 *
 * Une ligne par heure couverte. L'utilisateur peut basculer manuellement
 * l'activité A/R en cliquant sur le badge.
 */
import type { HourlyResult } from '../../utils/carriereParser'

interface Props {
  hours: HourlyResult[]
  onToggleActivity: (hourKey: string) => void
}

export default function FilteringTable({ hours, onToggleActivity }: Props) {
  if (hours.length === 0) {
    return (
      <div className="text-xs text-gray-600 italic px-2">
        Aucune heure analysée — vérifiez le Time History.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto border border-gray-800 rounded-lg">
      <table className="w-full text-xs tabular-nums">
        <thead className="bg-gray-900/60 text-gray-500">
          <tr className="border-b border-gray-800">
            <th className="text-left  px-3 py-1.5 font-medium">Heure</th>
            <th className="text-right px-3 py-1.5 font-medium">LAeq1h</th>
            <th className="text-right px-3 py-1.5 font-medium">LAF10</th>
            <th className="text-right px-3 py-1.5 font-medium">LAF50</th>
            <th className="text-right px-3 py-1.5 font-medium">LAF90</th>
            <th className="text-right px-3 py-1.5 font-medium">Camions/h</th>
            <th className="text-center px-3 py-1.5 font-medium">Activité</th>
            <th className="text-center px-3 py-1.5 font-medium">Météo</th>
            <th className="text-center px-3 py-1.5 font-medium">Statut</th>
          </tr>
        </thead>
        <tbody>
          {hours.map((h, i) => {
            const excluded = !h.included
            const rowCls = excluded
              ? 'opacity-50 bg-gray-950'
              : i % 2 === 0
              ? 'bg-gray-900/30'
              : ''
            return (
              <tr key={h.hourKey} className={`${rowCls} border-b border-gray-800/40`}>
                <td className="px-3 py-1 text-gray-300 font-medium">
                  {h.date} · {String(h.hour).padStart(2, '0')}h
                </td>
                <td className="px-3 py-1 text-right text-gray-200">{h.laeq1h.toFixed(1)}</td>
                <td className="px-3 py-1 text-right text-gray-400">{h.laf10.toFixed(1)}</td>
                <td className="px-3 py-1 text-right text-gray-400">{h.laf50.toFixed(1)}</td>
                <td className="px-3 py-1 text-right text-gray-400">{h.laf90.toFixed(1)}</td>
                <td className="px-3 py-1 text-right text-gray-400">{h.camionsCount}</td>
                <td className="px-3 py-1 text-center">
                  <button
                    onClick={() => onToggleActivity(h.hourKey)}
                    title="Cliquer pour basculer A ↔ R"
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                      h.activity === 'A'
                        ? 'bg-emerald-900/40 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/60'
                        : 'bg-blue-900/40 text-blue-300 border-blue-800/60 hover:bg-blue-900/60'
                    }`}
                  >
                    {h.activity}
                  </button>
                </td>
                <td className="px-3 py-1 text-center">
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                      h.meteoOk
                        ? 'bg-emerald-900/30 text-emerald-300 border-emerald-800/40'
                        : 'bg-rose-900/30 text-rose-300 border-rose-800/40'
                    }`}
                    title={h.meteoReason ?? ''}
                  >
                    {h.meteoOk ? 'OK' : h.meteoReason ?? 'Non'}
                  </span>
                </td>
                <td className="px-3 py-1 text-center text-[10px]">
                  {excluded ? (
                    <span className="text-gray-600 uppercase tracking-wider">Exclu</span>
                  ) : (
                    <span className="text-emerald-400 uppercase tracking-wider">Inclus</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
