/**
 * Section 2 — Niveau d'émission L1.
 *
 * Deux modes :
 *  - Global : l'utilisateur entre Lp(A) et choisit un spectre type (pink / road /
 *    industrial / speech / personnalisé). Le spectre est régénéré à chaque saisie.
 *  - Mesure AcoustiQ : on moyenne le spectre du point sélectionné sur toute la
 *    journée et on le reprojette sur les 18 bandes 100–5000 Hz.
 */
import { useMemo, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { WALL_BANDS } from '../../data/wallDatabase'
import { levelsForSource, globalDBA, type SourceKind } from '../../utils/isolementCalculator'
import type { MeasurementFile } from '../../types'

export type SourceMode = 'global' | 'measurement'

const SPECTRUM_OPTIONS: Array<{ id: SourceKind | 'custom'; label: string }> = [
  { id: 'pink',        label: 'Bruit rose' },
  { id: 'road',        label: 'Bruit route (trafic)' },
  { id: 'industrial',  label: 'Bruit industriel' },
  { id: 'speech',      label: 'Parole' },
  { id: 'custom',      label: 'Personnalisé (18 valeurs)' },
]

interface Props {
  files: MeasurementFile[]
  selectedDate: string
  pointMap: Record<string, string>
  L1_by_band: Record<string, number>
  onL1Change: (byBand: Record<string, number>) => void
}

/**
 * Calcule le spectre moyen d'un point pour une date donnée, projeté sur les
 * 18 bandes 100–5000 Hz. Moyenne énergétique (10·log10 moyenne linéaire).
 */
function averageSpectrumForPoint(
  files: MeasurementFile[],
  pointName: string,
  selectedDate: string,
  pointMap: Record<string, string>,
): Record<string, number> | null {
  const matched = files.filter((f) => pointMap[f.id] === pointName && f.date === selectedDate)
  if (matched.length === 0) return null

  // Accumulateurs par bande cible (somme des 10^(L/10))
  const accum: Record<string, { sum: number; n: number }> = {}
  for (const f of WALL_BANDS) accum[String(f)] = { sum: 0, n: 0 }

  for (const file of matched) {
    const freqs = file.spectraFreqs
    if (!freqs || freqs.length === 0) continue
    const freqToIdx = new Map(freqs.map((fr, i) => [fr, i]))
    for (const dp of file.data) {
      if (!dp.spectra || dp.spectra.length === 0) continue
      for (const target of WALL_BANDS) {
        const idx = freqToIdx.get(target)
        if (idx === undefined) continue
        const v = dp.spectra[idx]
        if (!Number.isFinite(v)) continue
        accum[String(target)].sum += Math.pow(10, v / 10)
        accum[String(target)].n += 1
      }
    }
  }

  const out: Record<string, number> = {}
  let hasAny = false
  for (const f of WALL_BANDS) {
    const { sum, n } = accum[String(f)]
    if (n === 0) { out[String(f)] = 0; continue }
    out[String(f)] = 10 * Math.log10(sum / n)
    hasAny = true
  }
  return hasAny ? out : null
}

export default function SourceLevel({
  files, selectedDate, pointMap,
  L1_by_band, onL1Change,
}: Props) {
  const [mode, setMode] = useState<SourceMode>('global')
  const [lpA, setLpA] = useState('75')
  const [kind, setKind] = useState<SourceKind | 'custom'>('pink')
  const [customText, setCustomText] = useState('')
  const [selectedPoint, setSelectedPoint] = useState<string>('')

  const availablePoints = useMemo(() => {
    const set = new Set<string>()
    for (const f of files) {
      if (f.date !== selectedDate) continue
      const pt = pointMap[f.id]
      if (!pt) continue
      // n'afficher que les points qui ont des spectres
      if (!f.spectraFreqs || f.spectraFreqs.length === 0) continue
      set.add(pt)
    }
    return Array.from(set).sort()
  }, [files, selectedDate, pointMap])

  // Recalcul auto du spectre quand mode global + paramètres changent
  function updateGlobal(next: { lpA?: string; kind?: SourceKind | 'custom'; custom?: string }) {
    const newLp = next.lpA ?? lpA
    const newKind = next.kind ?? kind
    const newCustom = next.custom ?? customText
    if (next.lpA !== undefined) setLpA(next.lpA)
    if (next.kind !== undefined) setKind(next.kind)
    if (next.custom !== undefined) setCustomText(next.custom)

    const lp = parseFloat(newLp.replace(',', '.'))
    if (newKind === 'custom') {
      // Parse 18 valeurs séparées par virgule, espace, tab ou retour ligne
      const tokens = newCustom.split(/[\s,;]+/).filter((s) => s.length > 0)
      const out: Record<string, number> = {}
      for (let i = 0; i < WALL_BANDS.length; i++) {
        const v = parseFloat((tokens[i] ?? '').replace(',', '.'))
        out[String(WALL_BANDS[i])] = Number.isFinite(v) ? v : 0
      }
      onL1Change(out)
    } else {
      if (!Number.isFinite(lp)) { onL1Change({}); return }
      onL1Change(levelsForSource(lp, newKind as SourceKind))
    }
  }

  function applyMeasurementPoint(pt: string) {
    setSelectedPoint(pt)
    if (!pt) { onL1Change({}); return }
    const avg = averageSpectrumForPoint(files, pt, selectedDate, pointMap)
    if (!avg) { onL1Change({}); return }
    onL1Change(avg)
  }

  const globalLpA = useMemo(() => globalDBA(L1_by_band), [L1_by_band])

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <header className="flex items-center gap-2 mb-3">
        <Volume2 size={14} className="text-emerald-400" />
        <h3 className="text-sm font-semibold text-gray-200">2. Niveau d'émission (source)</h3>
      </header>

      {/* Tabs mode */}
      <div className="flex gap-1 mb-3">
        <button
          onClick={() => { setMode('global'); updateGlobal({}) }}
          className={`text-xs px-3 py-1 rounded border transition-colors ${
            mode === 'global'
              ? 'bg-emerald-950/60 border-emerald-600 text-emerald-200'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
          }`}
        >
          Mode A — Niveau global
        </button>
        <button
          onClick={() => setMode('measurement')}
          disabled={availablePoints.length === 0}
          className={`text-xs px-3 py-1 rounded border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            mode === 'measurement'
              ? 'bg-emerald-950/60 border-emerald-600 text-emerald-200'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
          }`}
          title={availablePoints.length === 0 ? 'Aucun point de mesure avec spectre disponible pour la date sélectionnée' : undefined}
        >
          Mode B — Depuis mesure AcoustiQ
        </button>
      </div>

      {mode === 'global' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Lp,source (dB(A))</label>
              <input
                type="number"
                step="0.1"
                value={lpA}
                onChange={(e) => updateGlobal({ lpA: e.target.value })}
                className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                           px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500
                           [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                           [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Type de spectre</label>
              <select
                value={kind}
                onChange={(e) => updateGlobal({ kind: e.target.value as SourceKind | 'custom' })}
                className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                           px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {SPECTRUM_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          {kind === 'custom' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">
                Spectre personnalisé — 18 valeurs (dB non pondéré) pour {WALL_BANDS[0]} → {WALL_BANDS[WALL_BANDS.length - 1]} Hz
              </label>
              <textarea
                rows={2}
                value={customText}
                onChange={(e) => updateGlobal({ custom: e.target.value })}
                placeholder="60, 62, 63, 64, 65, 66, 66, 65, 64, 63, 62, 61, 60, 58, 56, 54, 52, 50"
                className="text-xs font-mono bg-gray-800 text-gray-100 border border-gray-700 rounded
                           px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <p className="text-[10px] text-gray-600">Séparez les valeurs par virgule, espace ou saut de ligne.</p>
            </div>
          )}
        </div>
      )}

      {mode === 'measurement' && (
        <div className="space-y-3">
          {availablePoints.length === 0 ? (
            <p className="text-xs text-gray-500 italic">Aucun point de mesure avec spectre disponible pour la date sélectionnée.</p>
          ) : (
            <div className="flex flex-col gap-1 md:w-1/2">
              <label className="text-xs text-gray-500">Point de mesure source</label>
              <select
                value={selectedPoint}
                onChange={(e) => applyMeasurementPoint(e.target.value)}
                className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                           px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">— Choisir un point —</option>
                {availablePoints.map((pt) => <option key={pt} value={pt}>{pt}</option>)}
              </select>
              <p className="text-[10px] text-gray-600">
                Spectre moyenné énergétiquement sur toute la journée, reprojeté sur 18 bandes 100 Hz – 5 kHz.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Aperçu du spectre L1 */}
      {Object.keys(L1_by_band).length > 0 && (
        <div className="mt-3 border-t border-gray-800 pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] uppercase tracking-wider text-gray-500">Spectre L1</span>
            <span className="text-xs text-emerald-400 font-mono">
              Lp(A) global = {globalLpA.toFixed(1)} dB(A)
            </span>
          </div>
          <div className="grid grid-cols-9 gap-1 text-[10px] font-mono">
            {WALL_BANDS.map((f) => (
              <div key={f} className="flex flex-col items-center bg-gray-800/60 rounded px-1 py-0.5">
                <span className="text-gray-500">{f}</span>
                <span className="text-gray-200">{(L1_by_band[String(f)] ?? 0).toFixed(1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
