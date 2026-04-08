/**
 * Page Carrière / Sablière
 *
 * Pipeline complet pour une étude acoustique de carrière conforme REAFIE :
 *   1. Upload de 3 fichiers Excel (Time History 821SE, registre camionnage,
 *      données météo Environnement Canada).
 *   2. Saisie des paramètres (délai trajet, seuil vent, périodes).
 *   3. Bouton « Analyser » → agrégation horaire + tagging A/R + filtre météo +
 *      calcul de Bp par période.
 *   4. Tableau interactif (toggle A/R manuel) + cartes Bp + exports.
 */
import { useState, useMemo } from 'react'
import { Hammer, Play, Download, FileText, AlertCircle } from 'lucide-react'
import FileUploadStep from '../components/carriere/FileUploadStep'
import FilteringTable from '../components/carriere/FilteringTable'
import BpSummary from '../components/carriere/BpSummary'
import {
  parseTimeHistorySheet,
  parseCamionnageSheet,
  parseMeteoSheet,
  runCarriereAnalysis,
  computeBpAllPeriodes,
  hoursToCSV,
  type CarrierePageState,
  type FileSlot,
  type HourlyResult,
  type RawTimeHistoryRow,
  type CamionEvent,
  type MeteoHourRow,
} from '../utils/carriereParser'

const TIME_HISTORY_HELP =
  'Onglet : DATA_Time History_1\n' +
  'Colonnes attendues :\n' +
  '• Date/Time\n' +
  '• LAeq (obligatoire)\n' +
  '• LASmax / LAFmax (optionnel)\n' +
  '• LAF 10 / 50 / 90 (optionnel)'

const CAMIONNAGE_HELP =
  'Onglet : A\n' +
  'Colonnes attendues :\n' +
  '• Arrivée (date) | Heure\n' +
  '• Départ (date) | Heure  ← obligatoire\n' +
  '• À enlever (x = exclure)\n' +
  '• Départ seul (1 = camion à vide)'

const METEO_HELP =
  'Onglet : Données météo (format Environnement Canada)\n' +
  'Colonnes attendues :\n' +
  '• HEURE\n' +
  '• Vitesse du vent (km/h)\n' +
  '• Hauteur précipitation (mm)'

interface Props {
  state: CarrierePageState
  setState: React.Dispatch<React.SetStateAction<CarrierePageState>>
}

function emptySlotFor<T>(name: string | null = null, error: string | null = null): FileSlot<T> {
  return { name, data: null, error }
}

export default function CarrierePage({ state, setState }: Props) {
  const { timeHistory, camionnage, meteo, params, result } = state
  const [analyzing, setAnalyzing] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // ── Upload handlers ──────────────────────────────────────────────────────
  async function handleTimeHistory(file: File) {
    try {
      const buf = await file.arrayBuffer()
      const data = parseTimeHistorySheet(buf)
      setState((s) => ({ ...s, timeHistory: { name: file.name, data, error: null } }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setState((s) => ({ ...s, timeHistory: emptySlotFor<RawTimeHistoryRow[]>(file.name, msg) }))
    }
  }
  async function handleCamionnage(file: File) {
    try {
      const buf = await file.arrayBuffer()
      const data = parseCamionnageSheet(buf, params.delaiCamionnageMin)
      setState((s) => ({ ...s, camionnage: { name: file.name, data, error: null } }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setState((s) => ({ ...s, camionnage: emptySlotFor<CamionEvent[]>(file.name, msg) }))
    }
  }
  async function handleMeteo(file: File) {
    try {
      const buf = await file.arrayBuffer()
      const data = parseMeteoSheet(buf)
      setState((s) => ({ ...s, meteo: { name: file.name, data, error: null } }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setState((s) => ({ ...s, meteo: emptySlotFor<MeteoHourRow[]>(file.name, msg) }))
    }
  }

  // ── Run analysis ─────────────────────────────────────────────────────────
  function handleAnalyze() {
    setGlobalError(null)
    if (!timeHistory.data || !camionnage.data || !meteo.data) {
      setGlobalError('Importez les 3 fichiers avant de lancer l\'analyse.')
      return
    }
    setAnalyzing(true)
    try {
      const r = runCarriereAnalysis(timeHistory.data, camionnage.data, meteo.data, params)
      setState((s) => ({ ...s, result: r }))
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : String(err))
    } finally {
      setAnalyzing(false)
    }
  }

  // ── Toggle A/R par heure ─────────────────────────────────────────────────
  function toggleActivity(hourKey: string) {
    if (!result) return
    const nextHours: HourlyResult[] = result.hours.map((h) =>
      h.hourKey === hourKey ? { ...h, activity: h.activity === 'A' ? 'R' : 'A' } : h,
    )
    const bp = computeBpAllPeriodes(nextHours, params)
    setState((s) => ({ ...s, result: { hours: nextHours, ...bp } }))
  }

  function setParams(updater: (p: typeof params) => typeof params) {
    setState((s) => ({ ...s, params: updater(s.params) }))
  }

  function clearSlot(slot: 'timeHistory' | 'camionnage' | 'meteo') {
    setState((s) => ({ ...s, [slot]: emptySlotFor(), result: null }))
  }

  // ── Exports ──────────────────────────────────────────────────────────────
  function handleExportCSV() {
    if (!result) return
    const csv = hoursToCSV(result.hours)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.download = `acoustiq_carriere_filtrage.csv`
    link.href = url
    link.click()
    URL.revokeObjectURL(url)
  }

  async function handleCopyForReport() {
    if (!result) return
    const lines: string[] = []
    lines.push('Étude acoustique — Carrière / Sablière')
    lines.push('Méthode : agrégation horaire 821SE + filtrage météo + tagging activité (registre camionnage)')
    lines.push('')
    lines.push('Bp par période (Lignes directrices MELCCFP 2026)')
    for (const p of [result.bpJour, result.bpSoir, result.bpNuit]) {
      const f = (n: number | null) => (n === null ? '—' : n.toFixed(1))
      lines.push(
        `  ${p.label.padEnd(5)} (${p.rangeLabel.padEnd(20)})  ` +
          `LAeq amb. ${f(p.laeqAmb)} dB(A)  ` +
          `LAeq rés. ${f(p.laeqRes)} dB(A)  ` +
          `Bp ${f(p.bp)} dB(A)  ` +
          `(${p.hoursA} h actives / ${p.hoursR} h résiduelles)`,
      )
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setGlobalError('Impossible de copier dans le presse-papiers.')
    }
  }

  const allFilesReady = !!(timeHistory.data && camionnage.data && meteo.data)

  // Bp réactif au toggle d'activité
  const periodes = useMemo(() => {
    if (!result) return []
    return [result.bpJour, result.bpSoir, result.bpNuit]
  }, [result])

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-800 shrink-0">
        <Hammer size={14} className="text-emerald-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Carrière / Sablière
        </span>
        <span className="text-[10px] text-gray-600">
          Analyse REAFIE — Time History 821SE + camionnage + météo
        </span>
      </div>

      <div className="px-6 py-5 space-y-6 max-w-5xl">
        {/* ─── Section 1 : Upload ─────────────────────────────────────────── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            1 · Fichiers sources
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FileUploadStep
              label="Time History 821SE"
              hint="Onglet « DATA_Time History_1 » · données 1 s"
              exampleHelp={TIME_HISTORY_HELP}
              fileName={timeHistory.name}
              error={timeHistory.error}
              onFile={handleTimeHistory}
              onClear={() => clearSlot('timeHistory')}
            />
            <FileUploadStep
              label="Registre camionnage"
              hint="Onglet « A » · départ + heure"
              exampleHelp={CAMIONNAGE_HELP}
              fileName={camionnage.name}
              error={camionnage.error}
              onFile={handleCamionnage}
              onClear={() => clearSlot('camionnage')}
            />
            <FileUploadStep
              label="Données météo"
              hint="Onglet « Données météo » Environnement Canada"
              exampleHelp={METEO_HELP}
              fileName={meteo.name}
              error={meteo.error}
              onFile={handleMeteo}
              onClear={() => clearSlot('meteo')}
            />
          </div>
        </section>

        {/* ─── Section 2 : Paramètres ─────────────────────────────────────── */}
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            2 · Paramètres
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <ParamField
              label="Délai camionnage"
              suffix="min"
              value={params.delaiCamionnageMin}
              onChange={(v) => setParams((p) => ({ ...p, delaiCamionnageMin: v }))}
            />
            <ParamField
              label="Vent max"
              suffix="km/h"
              value={params.ventMaxKmh}
              onChange={(v) => setParams((p) => ({ ...p, ventMaxKmh: v }))}
            />
            <ParamRange
              label="Jour"
              start={params.jourStartH}
              end={params.jourEndH}
              onStart={(v) => setParams((p) => ({ ...p, jourStartH: v }))}
              onEnd={(v) => setParams((p) => ({ ...p, jourEndH: v }))}
            />
            <ParamRange
              label="Soir"
              start={params.soirStartH}
              end={params.soirEndH}
              onStart={(v) => setParams((p) => ({ ...p, soirStartH: v }))}
              onEnd={(v) => setParams((p) => ({ ...p, soirEndH: v }))}
            />
            <ParamRange
              label="Nuit"
              start={params.nuitStartH}
              end={params.nuitEndH}
              onStart={(v) => setParams((p) => ({ ...p, nuitStartH: v }))}
              onEnd={(v) => setParams((p) => ({ ...p, nuitEndH: v }))}
            />
          </div>
        </section>

        {/* ─── Section 3 : Bouton analyser ────────────────────────────────── */}
        <section>
          <button
            onClick={handleAnalyze}
            disabled={!allFilesReady || analyzing}
            className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold
                       bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40
                       disabled:cursor-not-allowed transition-colors"
          >
            <Play size={14} />
            {analyzing ? 'Analyse en cours…' : 'Analyser'}
          </button>
          {globalError && (
            <div className="mt-2 px-3 py-2 rounded border border-rose-800/60 bg-rose-950/30
                            text-xs text-rose-300 flex items-start gap-2">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              {globalError}
            </div>
          )}
        </section>

        {/* ─── Section 4 : Tableau de filtrage ────────────────────────────── */}
        {result && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              3 · Filtrage horaire
              <span className="ml-2 text-[10px] text-gray-600 normal-case font-normal">
                {result.hours.filter((h) => h.included).length} / {result.hours.length} heures incluses ·
                cliquez sur le badge A/R pour basculer
              </span>
            </h3>
            <FilteringTable hours={result.hours} onToggleActivity={toggleActivity} />
          </section>
        )}

        {/* ─── Section 5 : Résumé Bp ──────────────────────────────────────── */}
        {result && (
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
              4 · Bp par période
            </h3>
            <BpSummary periodes={periodes} />
          </section>
        )}

        {/* ─── Section 6 : Exports ────────────────────────────────────────── */}
        {result && (
          <section className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium
                         bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                         border border-gray-600 transition-colors"
            >
              <Download size={12} />
              Exporter CSV
            </button>
            <button
              onClick={handleCopyForReport}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium
                         bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-gray-100
                         border border-gray-600 transition-colors"
              title="Copie un résumé Bp formaté à coller dans la section Rapport"
            >
              <FileText size={12} />
              {copied ? 'Copié ✓' : 'Ajouter au rapport'}
            </button>
          </section>
        )}
      </div>
    </div>
  )
}

// ─── Petits champs paramètres ───────────────────────────────────────────────
function ParamField({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string
  suffix: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const n = parseFloat(e.target.value)
            if (!Number.isNaN(n)) onChange(n)
          }}
          className="w-20 text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                     px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <span className="text-[10px] text-gray-500">{suffix}</span>
      </div>
    </label>
  )
}

function ParamRange({
  label,
  start,
  end,
  onStart,
  onEnd,
}: {
  label: string
  start: number
  end: number
  onStart: (v: number) => void
  onEnd: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          max={23}
          value={start}
          onChange={(e) => onStart(parseInt(e.target.value, 10) || 0)}
          className="w-12 text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                     px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <span className="text-gray-600">→</span>
        <input
          type="number"
          min={0}
          max={23}
          value={end}
          onChange={(e) => onEnd(parseInt(e.target.value, 10) || 0)}
          className="w-12 text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                     px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        <span className="text-[10px] text-gray-500">h</span>
      </div>
    </label>
  )
}
