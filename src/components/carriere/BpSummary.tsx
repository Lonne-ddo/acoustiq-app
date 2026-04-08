/**
 * Résumé Bp par période — 3 cartes (Jour / Soir / Nuit)
 *
 * Bp = 10·log10( 10^(LAeq_amb/10) − 10^(LAeq_res/10) )
 * Affiché « — » si non calculable (LAeq_amb ≤ LAeq_res ou pas assez d'heures).
 */
import { Sun, Sunset, Moon } from 'lucide-react'
import type { BpPeriode } from '../../utils/carriereParser'

const ICONS = {
  Jour: Sun,
  Soir: Sunset,
  Nuit: Moon,
} as const

const TINTS = {
  Jour: 'border-amber-800/60 bg-amber-950/20',
  Soir: 'border-orange-800/60 bg-orange-950/20',
  Nuit: 'border-indigo-800/60 bg-indigo-950/20',
} as const

interface Props {
  periodes: BpPeriode[]
}

function fmt(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '—' : n.toFixed(1)
}

export default function BpSummary({ periodes }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {periodes.map((p) => {
        const Icon = ICONS[p.label]
        return (
          <div
            key={p.label}
            className={`rounded-lg border p-4 ${TINTS[p.label]}`}
          >
            <div className="flex items-center gap-2 mb-3">
              <Icon size={14} className="text-gray-300" />
              <span className="text-xs font-semibold text-gray-200 uppercase tracking-wider">
                {p.label}
              </span>
              <span className="text-[10px] text-gray-500 ml-auto">{p.rangeLabel}</span>
            </div>

            <div className="space-y-1.5 text-xs tabular-nums">
              <div className="flex justify-between">
                <span className="text-gray-500">LAeq amb.</span>
                <span className="text-gray-200 font-semibold">
                  {fmt(p.laeqAmb)} <span className="text-gray-600 text-[10px]">dB(A)</span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">LAeq rés.</span>
                <span className="text-gray-200 font-semibold">
                  {fmt(p.laeqRes)} <span className="text-gray-600 text-[10px]">dB(A)</span>
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-800/60 pt-1.5 mt-1.5">
                <span className="text-emerald-400 font-semibold">Bp</span>
                <span className="text-emerald-300 font-bold text-sm">
                  {fmt(p.bp)} <span className="text-emerald-600 text-[10px]">dB(A)</span>
                </span>
              </div>
              <div className="flex justify-between text-[10px] text-gray-600 pt-1">
                <span>{p.hoursA} h actives</span>
                <span>{p.hoursR} h résiduelles</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
