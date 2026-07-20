import { useMemo } from 'react'
import { SOURCES, type SourceResult, type SourceId } from '../../utils/meteoSources'
import { parseHourTimestamp } from '../../utils/recevabilite'
import {
  detectDiscord,
  formatDiscord,
  DISCORD_VARS,
  DISCORD_VAR_META,
  type DiscordVar,
  type DiscordResult,
  type HourDiscord,
} from '../../utils/meteoDiscord'

interface Props {
  sources: SourceResult[]
}

interface ComparisonRow {
  hourKey: string
  date: Date
  values: Record<SourceId, ComparisonCell | null>
  /** Désaccord inter-sources pré-calculé pour l'heure (informatif). */
  discord: HourDiscord
}

interface DiscordSummary {
  total: number
  disagreeHours: number
  perVar: Record<DiscordVar, number>
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

export default function ComparisonTable({ sources }: Props) {
  const { rows, sourceIds, summary } = useMemo(() => {
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
            discord: detectDiscord({}),
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

    const sorted = Array.from(map.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    )

    // Désaccord par heure + synthèse (une seule passe).
    const perVar: Record<DiscordVar, number> = {
      temperature: 0,
      windSpeed: 0,
      precipitation: 0,
      humidity: 0,
    }
    let disagreeHours = 0
    for (const row of sorted) {
      row.discord = detectDiscord({
        temperature: ids.map((id) => row.values[id]?.temperature ?? null),
        windSpeed: ids.map((id) => row.values[id]?.windSpeed ?? null),
        precipitation: ids.map((id) => row.values[id]?.precipitation ?? null),
        humidity: ids.map((id) => row.values[id]?.humidity ?? null),
      })
      if (row.discord.anyDisagree) disagreeHours++
      for (const v of row.discord.vars) perVar[v]++
    }

    return {
      rows: sorted,
      sourceIds: ids,
      summary: { total: sorted.length, disagreeHours, perVar } as DiscordSummary,
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
    <div className="space-y-2">
      <DiscordSummaryStrip summary={summary} />
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
            const disc = row.discord
            return (
              <tr key={row.hourKey} className="border-t border-gray-800 text-gray-300">
                <td className="px-2 py-1 whitespace-nowrap border-r border-gray-800">
                  {fmtDateLabel(row.date)}
                  {disc.anyDisagree && (
                    <span
                      className="ml-1 text-amber-400"
                      title={`Sources en désaccord — ${formatDiscord(disc)}`}
                      aria-label={`heure en désaccord entre sources : ${formatDiscord(disc)}`}
                    >
                      ⚠
                    </span>
                  )}
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
                  return <CellsForSource key={id} v={v} discord={disc} />
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

/**
 * Marquage d'une cellule pour une variable en désaccord. La couleur ne porte
 * JAMAIS l'info seule : un glyphe directionnel (▲ = plus haute valeur, ▼ = plus
 * basse) accompagne systématiquement le tint, avec un `title` explicite.
 */
function cellMark(
  varKey: DiscordVar,
  res: DiscordResult,
  value: number | null,
): { tint: string; glyph: string; title?: string } {
  if (!res.disagree || value == null) return { tint: '', glyph: '' }
  const m = DISCORD_VAR_META[varKey]
  const title = `Désaccord ${m.label} Δ${res.amplitude!.toFixed(m.decimals)} ${m.unit}`
  if (value === res.max) return { tint: 'text-rose-400', glyph: '▲', title }
  if (value === res.min) return { tint: 'text-sky-400', glyph: '▼', title }
  return { tint: '', glyph: '', title }
}

function DiscordGlyph({ g }: { g: string }) {
  if (!g) return null
  return (
    <sup className="ml-0.5 text-[8px] align-super" aria-hidden="true">
      {g}
    </sup>
  )
}

function CellsForSource({ v, discord }: { v: ComparisonCell; discord: HourDiscord }) {
  const t = cellMark('temperature', discord.byVar.temperature, v.temperature)
  const h = cellMark('humidity', discord.byVar.humidity, v.humidity)
  const p = cellMark('precipitation', discord.byVar.precipitation, v.precipitation)
  const w = cellMark('windSpeed', discord.byVar.windSpeed, v.windSpeed)
  // La précip garde son indice de recevabilité (rose si > 0) en l'absence de
  // désaccord ; le glyphe ▲/▼ signale le désaccord indépendamment de la couleur.
  const precipTint =
    p.tint || (v.precipitation != null && v.precipitation > 0 ? 'text-rose-400' : '')
  return (
    <>
      <td className={`px-1 py-1 text-right ${t.tint}`} title={t.title}>
        {fmt(v.temperature)}
        <DiscordGlyph g={t.glyph} />
      </td>
      <td className={`px-1 py-1 text-right ${h.tint}`} title={h.title}>
        {fmt(v.humidity, 0)}
        <DiscordGlyph g={h.glyph} />
      </td>
      <td className={`px-1 py-1 text-right ${precipTint}`} title={p.title}>
        {fmt(v.precipitation, 1)}
        <DiscordGlyph g={p.glyph} />
      </td>
      <td className={`px-1 py-1 text-right border-r border-gray-800 ${w.tint}`} title={w.title}>
        {fmt(v.windSpeed, 1)}
        <DiscordGlyph g={w.glyph} />
      </td>
    </>
  )
}

/** Synthèse compacte « Δ N/Total heures en désaccord — T° a · vent b · … ». */
function DiscordSummaryStrip({ summary }: { summary: DiscordSummary }) {
  if (summary.total === 0) return null
  if (summary.disagreeHours === 0) {
    return (
      <div className="text-xs text-gray-500 px-1">
        Aucun désaccord inter-sources détecté ({summary.total} heures).
      </div>
    )
  }
  const parts = DISCORD_VARS.filter((v) => summary.perVar[v] > 0).map(
    (v) => `${DISCORD_VAR_META[v].label} ${summary.perVar[v]}`,
  )
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-300/90 bg-amber-950/20 border border-amber-900/40 rounded px-2 py-1.5">
      <span className="font-semibold">
        ⚠ Δ {summary.disagreeHours}/{summary.total} heures en désaccord
      </span>
      <span className="text-amber-300/70">— {parts.join(' · ')}</span>
    </div>
  )
}

function fmtDateLabel(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(
    d.getMonth() + 1,
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}
