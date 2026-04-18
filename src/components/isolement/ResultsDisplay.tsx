/**
 * Section 5 — Résultats d'isolement.
 *
 * Affiche :
 *  - Le grand chiffre L2,A global (dB(A))
 *  - Comparaison optionnelle à un critère cible (marge + badge conforme)
 *  - Tableau par bande (L1 / R' / L2 / L2+A)
 *  - Graphique L1 / L2 par tiers d'octave
 *  - Export Excel
 */
import { useMemo } from 'react'
import { CheckCircle2, AlertTriangle, Download, BarChart3 } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer } from 'recharts'
import * as XLSX from 'xlsx'
import type { IsolementResult } from '../../utils/isolementCalculator'
import type { ScenarioWall } from './WallTable'
import { SCENARIO_LABELS, type ScenarioType } from './ScenarioConfig'

interface Props {
  scenarioName: string
  scenarioType: ScenarioType
  result: IsolementResult | null
  criterionDBA: number | null
  onCriterionChange: (v: number | null) => void
  walls: ScenarioWall[]
  volumeM3: number
  rtSeconds: number
  flankCorrectionDb: number
}

export default function ResultsDisplay({
  scenarioName, scenarioType, result,
  criterionDBA, onCriterionChange,
  walls, volumeM3, rtSeconds, flankCorrectionDb,
}: Props) {
  const chartData = useMemo(() => {
    if (!result) return []
    return result.bands.map((b) => ({
      freq: b.freq,
      L1: Math.round(b.L1 * 10) / 10,
      L2: Math.round(b.L2 * 10) / 10,
    }))
  }, [result])

  function exportXlsx() {
    if (!result) return
    const wb = XLSX.utils.book_new()

    // Feuille 1 : Paramètres
    const paramsRows: (string | number)[][] = [
      ['AcoustiQ — Module Isolement acoustique (ISO 12354-1)'],
      [],
      ['Scénario', scenarioName || '(sans nom)'],
      ['Type', SCENARIO_LABELS[scenarioType]],
      ['Volume V (m³)', volumeM3],
      ['Temps de réverbération T (s)', rtSeconds],
      ['Absorption A (m²)', Math.round(result.A * 100) / 100],
      ['Surface totale Stot (m²)', Math.round(result.Stot * 100) / 100],
      ['Correction flancs (dB)', flankCorrectionDb],
      [],
      ['L1,A global (dB(A))',  Math.round(result.L1_A_global * 10) / 10],
      ['L2,A global (dB(A))',  Math.round(result.L2_A_global * 10) / 10],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(paramsRows), 'Paramètres')

    // Feuille 2 : Parois
    const wallsRows: (string | number)[][] = [
      ['Nom', 'Surface (m²)', 'Rw (dB)'],
      ...walls.map((w) => [w.name, w.area, w.Rw]),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wallsRows), 'Parois')

    // Feuille 3 : Spectre
    const specRows: (string | number)[][] = [
      ['Fréquence (Hz)', 'L1 (dB)', 'R′ (dB)', 'L2 (dB)', 'L2 + A (dB(A))'],
      ...result.bands.map((b) => [
        b.freq,
        Math.round(b.L1 * 10) / 10,
        Math.round(b.Rprime * 10) / 10,
        Math.round(b.L2 * 10) / 10,
        Math.round(b.L2_A * 10) / 10,
      ]),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(specRows), 'Spectre')

    const fn = `isolement_${(scenarioName || 'scenario').replace(/[^a-z0-9-]+/gi, '_')}.xlsx`
    XLSX.writeFile(wb, fn)
  }

  if (!result || walls.length === 0) {
    return (
      <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
        <header className="flex items-center gap-2 mb-3">
          <BarChart3 size={14} className="text-emerald-400" />
          <h3 className="text-sm font-semibold text-gray-200">5. Résultats</h3>
        </header>
        <p className="text-xs text-gray-500 italic">
          Définir au moins une paroi et un niveau d'émission L1 pour afficher les résultats.
        </p>
      </section>
    )
  }

  const margin = criterionDBA !== null ? criterionDBA - result.L2_A_global : null
  const pass = margin !== null ? margin >= 0 : null

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <header className="flex items-center gap-2 mb-3">
        <BarChart3 size={14} className="text-emerald-400" />
        <h3 className="text-sm font-semibold text-gray-200">5. Résultats</h3>
        <button
          onClick={exportXlsx}
          className="ml-auto flex items-center gap-1 text-xs text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded px-2 py-1"
        >
          <Download size={11} />
          Exporter Excel
        </button>
      </header>

      {/* Grand chiffre */}
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-gray-500">Niveau reçu L2,A</p>
          <p className="text-4xl font-bold text-emerald-300 tabular-nums">
            {result.L2_A_global.toFixed(1)}<span className="text-lg text-emerald-500 ml-1">dB(A)</span>
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            depuis L1,A = {result.L1_A_global.toFixed(1)} dB(A) · isolement ΔA = {(result.L1_A_global - result.L2_A_global).toFixed(1)} dB
          </p>
        </div>

        <div className="flex flex-col gap-1 ml-auto">
          <label className="text-[11px] uppercase tracking-wider text-gray-500">
            Critère cible (optionnel)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.5"
              placeholder="—"
              value={criterionDBA ?? ''}
              onChange={(e) => {
                const v = parseFloat(e.target.value.replace(',', '.'))
                onCriterionChange(Number.isFinite(v) ? v : null)
              }}
              className="w-24 text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                         px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500
                         [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                         [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-xs text-gray-500">dB(A)</span>
            {margin !== null && (
              <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border ${
                pass
                  ? 'bg-emerald-950/50 border-emerald-700 text-emerald-300'
                  : 'bg-rose-950/50 border-rose-700 text-rose-300'
              }`}>
                {pass ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                {pass ? 'Conforme' : 'Dépassement'} · marge {margin >= 0 ? '+' : ''}{margin.toFixed(1)} dB
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Graphique L1 / L2 */}
      <div className="h-60 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: -8, bottom: 8 }}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis
              dataKey="freq"
              scale="log"
              type="number"
              domain={['dataMin', 'dataMax']}
              ticks={[100, 250, 500, 1000, 2000, 5000]}
              tickFormatter={(v) => v >= 1000 ? `${v / 1000}k` : `${v}`}
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              label={{ value: 'Fréquence (Hz)', position: 'insideBottom', fill: '#64748b', fontSize: 10, offset: -2 }}
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              label={{ value: 'dB', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 11 }}
              labelStyle={{ color: '#e2e8f0' }}
              formatter={(v) => `${typeof v === 'number' ? v.toFixed(1) : v} dB`}
              labelFormatter={(f) => `${f} Hz`}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: '#cbd5e1' }} />
            <Line type="monotone" dataKey="L1" name="L1 (émis)" stroke="#f97316" strokeWidth={2} dot={{ r: 2.5 }} />
            <Line type="monotone" dataKey="L2" name="L2 (reçu)" stroke="#10b981" strokeWidth={2} dot={{ r: 2.5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Tableau par bande */}
      <div className="overflow-x-auto rounded border border-gray-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-gray-500 uppercase tracking-wide bg-gray-900/60">
              <th className="text-left px-2 py-1.5 font-semibold">Fréq (Hz)</th>
              <th className="text-right px-2 py-1.5 font-semibold">L1 (dB)</th>
              <th className="text-right px-2 py-1.5 font-semibold">R′ (dB)</th>
              <th className="text-right px-2 py-1.5 font-semibold">L2 (dB)</th>
              <th className="text-right px-2 py-1.5 font-semibold">L2 + A (dB(A))</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {result.bands.map((b) => (
              <tr key={b.freq} className="border-t border-gray-800">
                <td className="px-2 py-1 text-gray-300">{b.freq}</td>
                <td className="px-2 py-1 text-right text-gray-200">{b.L1.toFixed(1)}</td>
                <td className="px-2 py-1 text-right text-gray-200">{b.Rprime.toFixed(1)}</td>
                <td className="px-2 py-1 text-right text-gray-200">{b.L2.toFixed(1)}</td>
                <td className="px-2 py-1 text-right text-emerald-300">{b.L2_A.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
