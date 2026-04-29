import { useMemo } from 'react'
import { SOURCES, type SourceResult, type SourceId } from '../../utils/meteoSources'
import { parseHourTimestamp } from '../../utils/recevabilite'

interface Props {
  sources: SourceResult[]
}

interface ComparisonRow {
  hourKey: string
  date: Date
  values: Record<SourceId, ComparisonCell | null>
}

interface ComparisonCell {
  temperature: number | null
  humidity: number | null
  precipitation: number | null
  windSpeed: number | null
}

function hourKey(s: string): string {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : s
}

const fmt = (v: number | null, decimals = 1) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(decimals)

function cmpAccent(values: (number | null)[]): {
  min: number | null
  max: number | null
  spread: number | null
} {
  const present = values.filter((v): v is number => v != null)
  if (present.length === 0) return { min: null, max: null, spread: null }
  const min = Math.min(...present)
  const max = Math.max(...present)
  return { min, max, spread: max - min }
}

export default function ComparisonTable({ sources }: Props) {
  const { rows, sourceIds } = useMemo(() => {
    const map = new Map<string, ComparisonRow>()
    const ids: SourceId[] = []
    sources.forEach((s) => {
      if (!ids.includes(s.source)) ids.push(s.source)
      s.rows.forEach((r) => {
        const key = hourKey(r.datetime)
        let row = map.get(key)
        if (!row) {
          row = {
            hourKey: key,
            date: parseHourTimestamp(r.datetime),
            values: { openmeteo: null, gem: null, eccc: null },
          }
          map.set(key, row)
        }
        row.values[s.source] = {
          temperature: r.temperature,
          humidity: r.humidity,
          precipitation: r.precipitation,
          windSpeed: r.windSpeed,
        }
      })
    })
    return {
      rows: Array.from(map.values()).sort(
        (a, b) => a.date.getTime() - b.date.getTime(),
      ),
      sourceIds: ids,
    }
  }, [sources])

  if (sources.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic px-1 py-2">
        Au moins deux sources sont nécessaires pour la comparaison.
      </div>
    )
  }

  return (
    <div className="overflow-auto max-h-[420px] border border-gray-800 rounded">
      <table className="w-full text-xs">
        <thead className="bg-gray-900 sticky top-0 z-10">
          <tr className="text-gray-400">
            <th rowSpan={2} className="text-left px-2 py-1.5 font-medium border-r border-gray-800">
              Heure
            </th>
            {sourceIds.map((id) => (
              <th
                key={id}
                colSpan={4}
                className="text-center px-2 py-1.5 font-medium border-r border-gray-800"
                style={{ borderTop: `2px solid ${SOURCES[id].color}` }}
              >
                {SOURCES[id].shortLabel}
              </th>
            ))}
          </tr>
          <tr className="text-gray-500 text-[10px]">
            {sourceIds.map((id) => (
              <Cells4Headers key={id} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const winds = sourceIds.map((id) => row.values[id]?.windSpeed ?? null)
            const temps = sourceIds.map((id) => row.values[id]?.temperature ?? null)
            const windCmp = cmpAccent(winds)
            const tempCmp = cmpAccent(temps)
            return (
              <tr key={row.hourKey} className="border-t border-gray-800 text-gray-300">
                <td className="px-2 py-1 whitespace-nowrap border-r border-gray-800">
                  {fmtDateLabel(row.date)}
                </td>
                {sourceIds.map((id) => {
                  const v = row.values[id]
                  if (!v)
                    return (
                      <td
                        key={id}
                        colSpan={4}
                        className="px-2 py-1 text-center text-gray-600 italic border-r border-gray-800"
                      >
                        —
                      </td>
                    )
                  const tempClass =
                    tempCmp.spread != null && tempCmp.spread > 5 && v.temperature != null
                      ? v.temperature === tempCmp.max
                        ? 'text-rose-400'
                        : v.temperature === tempCmp.min
                          ? 'text-sky-400'
                          : ''
                      : ''
                  const windClass =
                    windCmp.spread != null && windCmp.spread > 5 && v.windSpeed != null
                      ? v.windSpeed === windCmp.max
                        ? 'text-rose-400'
                        : v.windSpeed === windCmp.min
                          ? 'text-sky-400'
                          : ''
                      : ''
                  return (
                    <CellsForSource
                      key={id}
                      v={v}
                      tempClass={tempClass}
                      windClass={windClass}
                    />
                  )
                })}
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={1 + sourceIds.length * 4}
                className="px-2 py-4 text-center text-gray-500 italic"
              >
                Aucune donnée commune.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function Cells4Headers() {
  return (
    <>
      <th className="text-right px-1 py-1 font-normal">T</th>
      <th className="text-right px-1 py-1 font-normal">HR</th>
      <th className="text-right px-1 py-1 font-normal">Pp</th>
      <th className="text-right px-1 py-1 font-normal border-r border-gray-800">V</th>
    </>
  )
}

function CellsForSource({
  v,
  tempClass,
  windClass,
}: {
  v: ComparisonCell
  tempClass: string
  windClass: string
}) {
  return (
    <>
      <td className={`px-1 py-1 text-right ${tempClass}`}>{fmt(v.temperature)}</td>
      <td className="px-1 py-1 text-right">{fmt(v.humidity, 0)}</td>
      <td
        className={`px-1 py-1 text-right ${
          v.precipitation != null && v.precipitation > 0 ? 'text-rose-400' : ''
        }`}
      >
        {fmt(v.precipitation, 1)}
      </td>
      <td className={`px-1 py-1 text-right border-r border-gray-800 ${windClass}`}>
        {fmt(v.windSpeed, 1)}
      </td>
    </>
  )
}

function fmtDateLabel(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(
    d.getMonth() + 1,
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}
