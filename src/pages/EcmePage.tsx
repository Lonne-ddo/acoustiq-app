/**
 * Dashboard ECME — Englobe.
 *
 * Page unique à 4 sections : alertes calibration, disponibilité du jour,
 * taux d'utilisation, inventaire complet. Aucun backend, lecture seule
 * d'un fichier Excel téléversé manuellement.
 */
import { useState, useMemo, useRef } from 'react'
import { Activity, Upload, AlertCircle, Loader2 } from 'lucide-react'
import {
  parseEcmeFile,
  computeCalibrationAlerts,
  computeAvailability,
  computeLastUsedDays,
  type EcmePageState,
} from '../utils/ecmeParser'
import { todayISO, formatFrLong } from '../utils/dateUtils'
import CalibrationAlerts from '../components/ecme/CalibrationAlerts'
import AvailabilityTable from '../components/ecme/AvailabilityTable'
import OccupationChart from '../components/ecme/OccupationChart'
import InventoryTable from '../components/ecme/InventoryTable'

interface Props {
  state: EcmePageState
  setState: React.Dispatch<React.SetStateAction<EcmePageState>>
}

export default function EcmePage({ state, setState }: Props) {
  const { data, fileName } = state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const today = todayISO()

  async function handleFile(file: File) {
    setLoading(true)
    setError(null)
    try {
      const parsed = await parseEcmeFile(file)
      setState({ data: parsed, fileName: file.name })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setState({ data: null, fileName: null })
    } finally {
      setLoading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  // Statistiques mémoïsées
  const alerts = useMemo(
    () => (data ? computeCalibrationAlerts(data.occupation, today) : []),
    [data, today],
  )
  const availability = useMemo(
    () => (data ? computeAvailability(data.occupation, today) : []),
    [data, today],
  )
  const lastUsed = useMemo(
    () => (data ? computeLastUsedDays(data.occupation, today) : {}),
    [data, today],
  )
  // Indicateur global "X / Y disponibles aujourd'hui"
  const dispoStats = useMemo(() => {
    const total = availability.length
    const dispo = availability.filter((r) => r.status === 'Disponible').length
    return { total, dispo }
  }, [availability])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <header className="border-b border-gray-800 bg-gray-900/60 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-3 flex-wrap">
          <Activity size={20} className="text-emerald-400" />
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold tracking-tight">Parc ECME — Englobe</h1>
            <p className="text-[11px] text-gray-500">
              Lecture du fichier <em>Occupation_ECME_2025-2026.xlsx</em> · 100 % client-side
            </p>
          </div>
          <div className="text-xs text-gray-400 tabular-nums hidden md:block">
            {formatFrLong(today)}
          </div>
          <button
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium
                       bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {loading ? 'Lecture…' : data ? 'Charger un autre fichier' : 'Charger le fichier Excel'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
              e.target.value = ''
            }}
          />
        </div>
      </header>

      {/* ─── Body ────────────────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-8">
        {error && (
          <div className="px-3 py-2 rounded border border-rose-800/60 bg-rose-950/30
                          text-xs text-rose-300 flex items-start gap-2">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {!data ? (
          <div
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true) }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false) }}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-3 py-20 rounded-lg
                        border-2 border-dashed transition-colors text-center ${
                          dragOver
                            ? 'border-emerald-500 bg-emerald-950/20'
                            : 'border-gray-700 bg-gray-900/40'
                        }`}
          >
            <Upload size={36} className="text-gray-600" />
            <p className="text-sm text-gray-400">
              Glissez ici le fichier <code>Occupation_ECME_2025-2026.xlsx</code>{' '}
              ou cliquez sur « Charger le fichier Excel »
            </p>
            <p className="text-[11px] text-gray-600">
              Aucune donnée n'est envoyée à un serveur — tout reste dans votre navigateur.
            </p>
          </div>
        ) : (
          <>
            {/* Section 1 : Alertes calibration */}
            <section>
              <SectionTitle
                index="1"
                title="Alertes calibration"
                hint="Équipements à calibrer dans les 60 prochains jours"
              />
              <CalibrationAlerts alerts={alerts} />
            </section>

            {/* Section 2 : Disponibilité du jour */}
            <section>
              <div className="flex items-baseline gap-2 mb-3 flex-wrap">
                <span className="text-[11px] font-semibold text-emerald-500 uppercase tracking-wider">
                  2 · Disponibilité aujourd'hui
                </span>
                <span className="text-[10px] text-gray-600">— {formatFrLong(today)}</span>
                <span className="ml-auto px-2 py-0.5 rounded text-[11px] font-bold tabular-nums
                                 bg-emerald-900/40 text-emerald-300 border border-emerald-800/60">
                  {dispoStats.dispo} / {dispoStats.total} disponibles
                </span>
              </div>
              <AvailabilityTable rows={availability} />
            </section>

            {/* Section 3 : Taux d'utilisation */}
            <section>
              <SectionTitle
                index="3"
                title="Taux d'utilisation par modèle"
                hint="Période sélectionnable"
              />
              <OccupationChart occupation={data.occupation} />
            </section>

            {/* Section 4 : Inventaire complet */}
            <section>
              <SectionTitle
                index="4"
                title="Inventaire complet"
                hint={`Onglet « Table_ecme » · ${data.inventory.length} équipement(s)`}
              />
              <InventoryTable inventory={data.inventory} lastUsedDays={lastUsed} />
            </section>

            <footer className="pt-6 border-t border-gray-800/70 text-[10px] text-gray-600">
              Fichier source : <span className="text-gray-400">{fileName}</span> ·
              Plage couverte : <span className="tabular-nums">
                {data.dateRange.start} → {data.dateRange.end}
              </span>
            </footer>
          </>
        )}
      </main>
    </div>
  )
}

function SectionTitle({
  index,
  title,
  hint,
}: {
  index: string
  title: string
  hint?: string
}) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <span className="text-[11px] font-semibold text-emerald-500 uppercase tracking-wider">
        {index} · {title}
      </span>
      {hint && <span className="text-[10px] text-gray-600">— {hint}</span>}
    </div>
  )
}
