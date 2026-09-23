/**
 * Panneau d'inspection d'une heure (clic sur une ligne de tableau) :
 *  - « detail »     : une source — valeurs, arbre « chaussée », arbre §3.6 ;
 *  - « comparison » : toutes les sources du point à la même heure.
 * Le verdict affiché vient de `verdictHeure`, la MÊME fonction que les
 * tableaux : l'explication ne peut pas contredire la pastille.
 */
import { useEffect } from 'react'
import { X } from 'lucide-react'
import {
  verdictHeure,
  chausseeSecheDetail,
  conclusionVerdict,
  calcDewpoint,
  hourKeyOf,
  parseHourTimestamp,
  RECEVABILITE_LABEL,
  type RecevabiliteConfig,
  type RecevabiliteLevel,
  type MeteoHourRow,
} from '../../utils/recevabilite'
import { regPeriodOfHour } from '../../utils/acoustics'
import { SOURCES, isError, type SourceId, type SourceOutcome } from '../../utils/meteoSources'
import { conditionsLabel } from '../../utils/wmo'
import VerdictSteps from './VerdictSteps'

export type InspectorSelection =
  | { mode: 'detail'; hourKey: string; source: SourceId }
  | { mode: 'comparison'; hourKey: string }

interface Props {
  selection: InspectorSelection
  /** Toutes les issues du point actif (succès ET échecs). */
  outcomes: SourceOutcome[]
  pointLabel: string
  asphalt: boolean
  config: RecevabiliteConfig
  onClose: () => void
}

const LEVEL_CLASS: Record<RecevabiliteLevel, string> = {
  ok: 'text-emerald-300 bg-emerald-950/30 border-emerald-900/50',
  warn: 'text-amber-300 bg-amber-950/30 border-amber-900/50',
  bad: 'text-rose-300 bg-rose-950/30 border-rose-900/50',
  indetermine: 'text-gray-300 bg-gray-800/50 border-gray-700',
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

function titreHeure(hourKey: string): string {
  const d = parseHourTimestamp(hourKey.replace('T', ' ') + ':00')
  const hh = String(d.getHours()).padStart(2, '0')
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()} · ${hh}:00 · ${regPeriodOfHour(d.getHours())}`
}

const f = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d))

function rowAt(o: SourceOutcome, hourKey: string): MeteoHourRow | undefined {
  return isError(o) ? undefined : o.rows.find((r) => hourKeyOf(r.datetime) === hourKey)
}

export default function MeteoInspector({ selection, outcomes, pointLabel, asphalt, config, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const titre =
    selection.mode === 'detail'
      ? `Détail du calcul — ${titreHeure(selection.hourKey)}`
      : `Détail multi-sources — ${titreHeure(selection.hourKey)}`

  return (
    <div className="rounded border border-gray-700 bg-gray-900/70 p-3 space-y-3" role="region" aria-label={titre}>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-100">{titre}</div>
          <div className="text-[11px] text-gray-500">Point {pointLabel}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Fermer (Échap)"
          aria-label="Fermer le panneau d'inspection"
          className="text-gray-500 hover:text-gray-200"
        >
          <X size={16} />
        </button>
      </div>
      {selection.mode === 'detail' ? (
        <Detail selection={selection} outcomes={outcomes} asphalt={asphalt} config={config} />
      ) : (
        <Comparison hourKey={selection.hourKey} outcomes={outcomes} asphalt={asphalt} config={config} />
      )}
    </div>
  )
}

function Detail({
  selection,
  outcomes,
  asphalt,
  config,
}: {
  selection: Extract<InspectorSelection, { mode: 'detail' }>
  outcomes: SourceOutcome[]
  asphalt: boolean
  config: RecevabiliteConfig
}) {
  const o = outcomes.find((x) => x.source === selection.source)
  const row = o ? rowAt(o, selection.hourKey) : undefined
  if (!o || isError(o) || !row) {
    return <div className="text-xs text-gray-500 italic">Pas de données pour cette heure.</div>
  }
  const v = verdictHeure(row, asphalt, config)
  // L'arbre chaussée est TOUJOURS affiché ; quand il n'a pas pesé sur le
  // verdict, on le dit (asphalte décoché, heure déjà non recevable, aberrante).
  const cs = v.chaussee ?? chausseeSecheDetail(row.temperature, row.humidity, row.precipitation, config)
  const csPese = v.chaussee !== null
  const tdMesure = row.dewpoint != null
  const td = tdMesure ? row.dewpoint : calcDewpoint(row.temperature, row.humidity)

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-gray-400">
        {SOURCES[o.source].label} · {o.station.name}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Val label="Température" value={`${f(row.temperature)} °C`} />
        <Val label="Humidité relative" value={`${f(row.humidity, 0)} %`} />
        <Val label="Précipitation" value={`${f(row.precipitation, 2)} mm`} />
        <Val label="Vent" value={`${f(row.windSpeed)} km/h`} />
        <Val label="Direction du vent" value={`${f(row.windDirection, 0)}°`} />
        <Val label={`Point de rosée${tdMesure ? '' : ' (calculé)'}`} value={`${f(td)} °C`} />
        <Val label="Pression" value={row.pressureHpa != null ? `${(row.pressureHpa / 10).toFixed(2)} kPa` : '—'} />
        <Val label="Conditions" value={conditionsLabel(row)} />
      </div>
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          Arbre de décision — état de chaussée
        </div>
        <VerdictSteps steps={cs.steps} />
        <div className="text-xs text-gray-300">
          État chaussée : <b>{cs.state ?? 'indéterminé'}</b>
          {!csPese && <span className="text-gray-500"> — information seulement, sans effet sur le verdict (voir ci-dessous)</span>}
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
          Arbre de décision — recevabilité §3.6
        </div>
        <VerdictSteps steps={v.steps} />
        <div className={`text-xs font-semibold border rounded px-2 py-1.5 ${LEVEL_CLASS[v.level]}`}>
          {conclusionVerdict(v)}
        </div>
      </div>
    </div>
  )
}

function Comparison({
  hourKey,
  outcomes,
  asphalt,
  config,
}: {
  hourKey: string
  outcomes: SourceOutcome[]
  asphalt: boolean
  config: RecevabiliteConfig
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {outcomes.map((o) => {
        const meta = SOURCES[o.source]
        const head = (
          <div className="text-[11px] font-semibold" style={{ color: meta.color }}>
            {meta.label}
          </div>
        )
        if (isError(o)) {
          return (
            <div key={o.source} className="rounded border border-gray-800 p-2 space-y-1">
              {head}
              <div className="text-xs text-rose-400">⚠ {o.error}</div>
            </div>
          )
        }
        const row = rowAt(o, hourKey)
        if (!row) {
          return (
            <div key={o.source} className="rounded border border-gray-800 p-2 space-y-1">
              {head}
              <div className="text-xs text-gray-500 italic">pas de données pour cette heure</div>
            </div>
          )
        }
        const v = verdictHeure(row, asphalt, config)
        const cs = v.chaussee ?? chausseeSecheDetail(row.temperature, row.humidity, row.precipitation, config)
        return (
          <div key={o.source} className="rounded border border-gray-800 p-2 space-y-1.5">
            {head}
            <div className="text-xs text-gray-300">
              T <b>{f(row.temperature)}</b> °C · HR <b>{f(row.humidity, 0)}</b> % · Précip.{' '}
              <b>{f(row.precipitation, 2)}</b> mm · Vent <b>{f(row.windSpeed)}</b> km/h
            </div>
            <div className="text-[11px] text-gray-400">Chaussée : {cs.state ?? 'indéterminée'}</div>
            <div className={`text-[11px] font-semibold border rounded px-1.5 py-1 ${LEVEL_CLASS[v.level]}`}>
              §3.6 : {RECEVABILITE_LABEL[v.level]}
              {v.reasons.length > 0 && <span className="font-normal"> — {v.reasons.join(' ; ')}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Val({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-gray-800/50 px-2 py-1">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className="text-gray-200">{value}</div>
    </div>
  )
}
