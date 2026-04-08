/**
 * Cartes d'alertes calibration — équipements à calibrer dans < 60 j.
 * Rouge si < 30 j ou dépassée, ambre si 30–60 j.
 */
import { AlertTriangle, AlertCircle } from 'lucide-react'
import type { CalibrationAlert } from '../../utils/ecmeParser'
import { formatFrShort } from '../../utils/dateUtils'

interface Props {
  alerts: CalibrationAlert[]
}

export default function CalibrationAlerts({ alerts }: Props) {
  if (alerts.length === 0) {
    return (
      <div className="px-4 py-3 rounded border border-emerald-800/50 bg-emerald-950/20
                      text-sm text-emerald-300">
        ✓ Aucune calibration à effectuer dans les 60 prochains jours.
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {alerts.map((a) => {
        const isRed = a.level === 'red'
        const cardCls = isRed
          ? 'border-rose-700/70 bg-rose-950/30'
          : 'border-amber-700/60 bg-amber-950/20'
        const Icon = isRed ? AlertCircle : AlertTriangle
        const iconColor = isRed ? 'text-rose-400' : 'text-amber-400'
        const labelColor = isRed ? 'text-rose-200' : 'text-amber-200'

        let label: string
        if (a.daysRemaining < 0) label = `Dépassée de ${Math.abs(a.daysRemaining)} j`
        else if (a.daysRemaining < 30) label = `${a.daysRemaining} j restants`
        else label = `${a.daysRemaining} j restants`

        return (
          <div
            key={a.refBv}
            className={`px-3 py-2.5 rounded border ${cardCls}`}
          >
            <div className="flex items-start gap-2">
              <Icon size={14} className={`${iconColor} mt-0.5 shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-100 text-sm">{a.refBv}</span>
                  <span className="text-[11px] text-gray-400 truncate">{a.modele}</span>
                </div>
                <div className="text-xs text-gray-300 tabular-nums mt-0.5">
                  {formatFrShort(a.date)}
                </div>
                <div className={`text-[11px] font-semibold mt-0.5 ${labelColor}`}>
                  {label}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
