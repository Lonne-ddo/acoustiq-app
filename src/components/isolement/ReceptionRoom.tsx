/**
 * Section 4 — Pièce réceptrice : volume + temps de réverbération.
 * A = 0.16·V/T (Sabine) est calculée en direct et affichée à l'utilisateur.
 */
import { Home } from 'lucide-react'
import { sabineAbsorption, TYPICAL_RT } from '../../utils/isolementCalculator'

interface Props {
  volumeM3: number
  rtSeconds: number
  onVolumeChange: (v: number) => void
  onRtChange: (v: number) => void
}

export default function ReceptionRoom({ volumeM3, rtSeconds, onVolumeChange, onRtChange }: Props) {
  const A = sabineAbsorption(volumeM3, rtSeconds)

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <header className="flex items-center gap-2 mb-3">
        <Home size={14} className="text-emerald-400" />
        <h3 className="text-sm font-semibold text-gray-200">4. Pièce réceptrice</h3>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Volume V (m³)</label>
          <input
            type="number"
            step="0.5"
            value={volumeM3}
            onChange={(e) => {
              const v = parseFloat(e.target.value.replace(',', '.'))
              onVolumeChange(Number.isFinite(v) ? v : 0)
            }}
            className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                       px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500
                       [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                       [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">
            Temps de réverbération T (s)
          </label>
          <input
            type="number"
            step="0.1"
            value={rtSeconds}
            onChange={(e) => {
              const v = parseFloat(e.target.value.replace(',', '.'))
              onRtChange(Number.isFinite(v) && v > 0 ? v : 0.5)
            }}
            className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                       px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500
                       [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                       [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">Valeurs typiques</label>
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) onRtChange(v)
            }}
            className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                       px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <option value="">— Appliquer un T typique —</option>
            {TYPICAL_RT.map((r) => (
              <option key={r.label} value={r.value}>{r.label} ({r.value}s)</option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-400">
        <span className="font-mono">
          A = 0.16·V/T = <span className="text-emerald-300">{A.toFixed(2)} m²</span>
        </span>
        <span className="text-gray-600">
          Aire d'absorption équivalente Sabine de la pièce réceptrice.
        </span>
      </div>
    </section>
  )
}
