import { useMemo, useState } from 'react'
import { Check, X } from 'lucide-react'
import {
  type RecevabiliteHour,
  computeStats,
  parseHourTimestamp,
} from '../../utils/recevabilite'
import { SOURCES, type SourceResult } from '../../utils/meteoSources'

interface Props {
  /** Résultats triés par source pour le point actif. */
  sources: SourceResult[]
  /** Recevabilité pré-calculée par source pour le point actif. */
  recevabiliteBySource: Record<string, RecevabiliteHour[]>
}

type PeriodFilter = 'all' | 'jour' | 'nuit'

const fmtNum = (v: number | null | undefined, decimals = 1) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(decimals)

function fmtDateLabel(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(
    d.getMonth() + 1,
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

export default function SourceTable({ sources, recevabiliteBySource }: Props) {
  const [activeSourceIdx, setActiveSourceIdx] = useState(0)
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')
  const [recevableOnly, setRecevableOnly] = useState(false)

  const activeSource = sources[activeSourceIdx]
  const hours = activeSource ? recevabiliteBySource[activeSource.source] ?? [] : []

  const filtered = useMemo(() => {
    return hours.filter((h) => {
      if (periodFilter !== 'all' && h.period !== periodFilter) return false
      if (recevableOnly && !h.recevable) return false
      return true
    })
  }, [hours, periodFilter, recevableOnly])

  const stats = useMemo(() => computeStats(hours), [hours])

  if (sources.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic px-1 py-2">
        Aucune source disponible. Lancez une récupération.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mr-1">
          Source :
        </span>
        {sources.map((s, i) => {
          const meta = SOURCES[s.source]
          const isActive = i === activeSourceIdx
          return (
            <button
              key={s.source}
              onClick={() => setActiveSourceIdx(i)}
              className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                isActive
                  ? 'bg-gray-100 text-gray-900 border-gray-100'
                  : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-gray-200'
              }`}
              style={isActive ? undefined : { borderLeft: `3px solid ${meta.color}` }}
            >
              {meta.shortLabel}
            </button>
          )
        })}
      </div>

      {activeSource && (
        <div className="text-[11px] text-gray-500">
          {activeSource.sourceLabel} · station {activeSource.station.name} ·{' '}
          {activeSource.station.distanceKm.toFixed(1)} km
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Total heures" value={String(stats.total)} />
        <Stat
          label="Recevables"
          value={`${stats.recevables} / ${stats.total}`}
          accent="emerald"
        />
        <Stat
          label="Pourcentage"
          value={`${stats.pourcentage.toFixed(0)}%`}
          accent={stats.pourcentage >= 50 ? 'emerald' : 'amber'}
        />
        <Stat
          label="Jour / Nuit recev."
          value={`${stats.jourRecevable} / ${stats.nuitRecevable}`}
        />
      </div>

      <div className="flex flex-wrap gap-3 items-center text-xs">
        <div className="flex gap-1">
          {(['all', 'jour', 'nuit'] as PeriodFilter[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriodFilter(p)}
              className={`px-2 py-1 rounded text-xs border transition-colors ${
                periodFilter === p
                  ? 'bg-gray-100 text-gray-900 border-gray-100'
                  : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700'
              }`}
            >
              {p === 'all' ? 'Tout' : p === 'jour' ? 'Jour' : 'Nuit'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-gray-400 cursor-pointer">
          <input
            type="checkbox"
            checked={recevableOnly}
            onChange={(e) => setRecevableOnly(e.target.checked)}
            className="accent-emerald-500"
          />
          Recevables seulement
        </label>
        <span className="ml-auto text-gray-500">{filtered.length} ligne(s)</span>
      </div>

      <div className="overflow-auto max-h-[420px] border border-gray-800 rounded">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 sticky top-0 z-10">
            <tr className="text-gray-400">
              <th className="text-left px-2 py-1.5 font-medium">Heure</th>
              <th className="text-left px-2 py-1.5 font-medium">Pér.</th>
              <th className="text-right px-2 py-1.5 font-medium">T °C</th>
              <th className="text-right px-2 py-1.5 font-medium">HR %</th>
              <th className="text-right px-2 py-1.5 font-medium">Précip mm</th>
              <th className="text-right px-2 py-1.5 font-medium">Vent km/h</th>
              <th className="text-right px-2 py-1.5 font-medium">Dir °</th>
              <th className="text-center px-2 py-1.5 font-medium">Recev.</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((h, i) => {
              const d = h.date instanceof Date ? h.date : parseHourTimestamp(h.datetime)
              const precipBad = h.precipitation != null && h.precipitation > 0
              const seuilVent = h.period === 'jour' ? 18 : 10.8
              const windBad = h.windSpeed != null && h.windSpeed >= seuilVent
              return (
                <tr
                  key={i}
                  className={`border-t border-gray-800 ${
                    h.recevable ? 'text-gray-200' : 'text-gray-500'
                  }`}
                  title={h.reasons.join(' · ')}
                >
                  <td className="px-2 py-1 whitespace-nowrap">{fmtDateLabel(d)}</td>
                  <td className="px-2 py-1">
                    <span
                      className={`text-[10px] px-1.5 rounded ${
                        h.period === 'jour'
                          ? 'bg-amber-900/30 text-amber-400'
                          : 'bg-indigo-900/30 text-indigo-400'
                      }`}
                    >
                      {h.period}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right">
                    {fmtNum(h.temperature)}
                  </td>
                  <td className="px-2 py-1 text-right">{fmtNum(h.humidity, 0)}</td>
                  <td
                    className={`px-2 py-1 text-right ${precipBad ? 'text-rose-400' : ''}`}
                  >
                    {fmtNum(h.precipitation, 1)}
                  </td>
                  <td
                    className={`px-2 py-1 text-right ${windBad ? 'text-rose-400' : ''}`}
                  >
                    {fmtNum(h.windSpeed, 1)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {fmtNum(h.windDirection, 0)}
                  </td>
                  <td className="px-2 py-1 text-center">
                    {h.recevable ? (
                      <Check size={14} className="inline text-emerald-400" />
                    ) : (
                      <X size={14} className="inline text-rose-400" />
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-2 py-4 text-center text-gray-500 italic">
                  Aucune heure ne correspond aux filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: 'emerald' | 'amber'
}) {
  const valueClass =
    accent === 'emerald'
      ? 'text-emerald-400'
      : accent === 'amber'
        ? 'text-amber-400'
        : 'text-gray-200'
  return (
    <div className="px-3 py-2 rounded border border-gray-800 bg-gray-900/40">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className={`text-base font-semibold mt-0.5 ${valueClass}`}>{value}</div>
    </div>
  )
}
