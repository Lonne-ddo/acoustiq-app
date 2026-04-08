/**
 * Taux d'occupation par modèle — barres de progression sur une période
 * sélectionnable (30 j / 90 j / Année en cours).
 */
import { useState, useMemo } from 'react'
import type { OccupationEntry } from '../../utils/ecmeParser'
import { computeOccupationRate } from '../../utils/ecmeParser'
import { todayISO, addDays } from '../../utils/dateUtils'

type Period = '30j' | '90j' | 'year'

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: '30j',  label: '30 derniers jours' },
  { id: '90j',  label: '90 jours' },
  { id: 'year', label: 'Année en cours' },
]

interface Props {
  occupation: OccupationEntry[]
}

export default function OccupationChart({ occupation }: Props) {
  const [period, setPeriod] = useState<Period>('30j')

  const range = useMemo(() => {
    const end = todayISO()
    if (period === '30j') return { start: addDays(end, -29), end }
    if (period === '90j') return { start: addDays(end, -89), end }
    // year-to-date
    const y = end.slice(0, 4)
    return { start: `${y}-01-01`, end }
  }, [period])

  const rates = useMemo(
    () => computeOccupationRate(occupation, range.start, range.end),
    [occupation, range],
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`text-xs px-2.5 py-1 rounded transition-colors ${
              period === p.id
                ? 'bg-emerald-700 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-gray-600">
          Période : {range.start} → {range.end} ({rates[0]?.totalDays ?? 0} jours)
        </span>
      </div>

      {rates.length === 0 ? (
        <div className="text-xs text-gray-600 italic">
          Aucune donnée d'occupation sur la période sélectionnée.
        </div>
      ) : (
        <div className="space-y-2">
          {rates.map((r) => {
            const pct = Math.round(r.rate * 100)
            const barColor =
              r.rate >= 0.7 ? 'bg-rose-500'
              : r.rate >= 0.4 ? 'bg-amber-500'
              : 'bg-emerald-500'
            return (
              <div key={r.modele} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-200 font-medium">{r.modele}</span>
                  <span className="text-gray-500">
                    <span className="text-gray-300 tabular-nums">{r.occupiedDays}</span>
                    {' / '}
                    <span className="tabular-nums">{r.totalDays}</span>{' j  ·  '}
                    <span className="text-gray-400">{r.count} équip.</span>
                    <span className="ml-2 text-gray-200 font-semibold tabular-nums">{pct} %</span>
                  </span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`${barColor} h-full transition-all duration-300`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
