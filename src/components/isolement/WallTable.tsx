/**
 * Section 3 — Tableau des parois séparatives.
 *
 * Chaque ligne du tableau : paroi (par id bibliothèque ou saisie manuelle)
 * + surface (m²). Le composant gère aussi la correction forfaitaire des
 * transmissions latérales (slider 0 à -10 dB).
 */
import { useState } from 'react'
import { Plus, Trash2, Layers } from 'lucide-react'
import {
  WALL_DATABASE,
  WALLS_BY_CATEGORY,
  WALL_BANDS,
  findWall,
  type WallCategory,
} from '../../data/wallDatabase'

/** Paroi instanciée dans la scène (référence à la bibliothèque OU spectre ad-hoc). */
export interface ScenarioWall {
  id: string              // uuid local
  name: string
  area: number            // m²
  Rw: number
  R_by_band: Record<string, number>
  /** Référence à la bibliothèque — pour affichage uniquement. */
  libRef?: string
}

interface Props {
  walls: ScenarioWall[]
  onChange: (walls: ScenarioWall[]) => void
  flankCorrectionDb: number
  onFlankChange: (v: number) => void
}

const CATEGORY_LABEL: Record<WallCategory, string> = {
  'maçonnerie': 'Maçonnerie',
  'cloison':    'Cloisons légères',
  'vitrage':    'Vitrages',
  'porte':      'Portes',
  'toiture':    'Toitures',
  'plancher':   'Planchers / dalles',
}

export default function WallTable({ walls, onChange, flankCorrectionDb, onFlankChange }: Props) {
  const [addMode, setAddMode] = useState<'lib' | 'manual' | null>(null)
  const [libId, setLibId] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualRw, setManualRw] = useState('')
  const [manualSpectrumText, setManualSpectrumText] = useState('')
  const [areaInput, setAreaInput] = useState('10')

  const Stot = walls.reduce((s, w) => s + Math.max(0, w.area), 0)

  function updateArea(id: string, raw: string) {
    const v = parseFloat(raw.replace(',', '.'))
    const area = Number.isFinite(v) && v > 0 ? v : 0
    onChange(walls.map((w) => w.id === id ? { ...w, area } : w))
  }

  function removeWall(id: string) {
    onChange(walls.filter((w) => w.id !== id))
  }

  function submitAddFromLibrary() {
    const lib = findWall(libId)
    const a = parseFloat(areaInput.replace(',', '.'))
    if (!lib || !Number.isFinite(a) || a <= 0) return
    const item: ScenarioWall = {
      id: crypto.randomUUID(),
      name: lib.name,
      area: a,
      Rw: lib.Rw,
      R_by_band: { ...lib.R_by_band },
      libRef: lib.id,
    }
    onChange([...walls, item])
    setAddMode(null)
    setLibId('')
    setAreaInput('10')
  }

  function submitAddManual() {
    const name = manualName.trim()
    const a = parseFloat(areaInput.replace(',', '.'))
    if (!name || !Number.isFinite(a) || a <= 0) return
    // Parse spectre : soit 18 valeurs, soit vide → utiliser Rw plat
    const tokens = manualSpectrumText.split(/[\s,;]+/).filter((s) => s.length > 0)
    const rw = parseFloat(manualRw.replace(',', '.'))
    const byBand: Record<string, number> = {}
    if (tokens.length >= WALL_BANDS.length) {
      for (let i = 0; i < WALL_BANDS.length; i++) {
        const v = parseFloat((tokens[i] ?? '').replace(',', '.'))
        byBand[String(WALL_BANDS[i])] = Number.isFinite(v) ? v : (Number.isFinite(rw) ? rw : 0)
      }
    } else if (Number.isFinite(rw)) {
      for (const f of WALL_BANDS) byBand[String(f)] = rw
    } else {
      return
    }
    const effectiveRw = Number.isFinite(rw)
      ? rw
      : (byBand[String(500)] ?? Object.values(byBand).reduce((a, b) => a + b, 0) / WALL_BANDS.length)
    onChange([...walls, {
      id: crypto.randomUUID(),
      name,
      area: a,
      Rw: effectiveRw,
      R_by_band: byBand,
    }])
    setAddMode(null)
    setManualName(''); setManualRw(''); setManualSpectrumText('')
    setAreaInput('10')
  }

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <header className="flex items-center gap-2 mb-3">
        <Layers size={14} className="text-emerald-400" />
        <h3 className="text-sm font-semibold text-gray-200">3. Parois de séparation</h3>
      </header>

      {walls.length === 0 ? (
        <p className="text-xs text-gray-500 italic mb-3">
          Aucune paroi définie. Ajoutez au moins une paroi (mur, vitrage, porte…) entre la source et la pièce réceptrice.
        </p>
      ) : (
        <div className="rounded border border-gray-800 overflow-hidden mb-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-gray-500 uppercase tracking-wide bg-gray-900/60">
                <th className="text-left px-2 py-1.5 font-semibold">Paroi</th>
                <th className="text-left px-2 py-1.5 font-semibold">Surface</th>
                <th className="text-left px-2 py-1.5 font-semibold">Rw</th>
                <th className="text-left px-2 py-1.5 font-semibold">Part Stot</th>
                <th className="text-right px-2 py-1.5 font-semibold w-10"></th>
              </tr>
            </thead>
            <tbody>
              {walls.map((w) => (
                <tr key={w.id} className="border-t border-gray-800">
                  <td className="px-2 py-1.5 text-gray-200">{w.name}</td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      step="0.1"
                      value={w.area}
                      onChange={(e) => updateArea(w.id, e.target.value)}
                      className="w-20 text-xs font-mono bg-gray-800 text-gray-100 border border-gray-700 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500
                                 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-gray-500 ml-1">m²</span>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-gray-300">{w.Rw} dB</td>
                  <td className="px-2 py-1.5 font-mono text-gray-400">
                    {Stot > 0 ? `${((w.area / Stot) * 100).toFixed(0)} %` : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      onClick={() => removeWall(w.id)}
                      className="text-gray-600 hover:text-red-400"
                      aria-label="Supprimer cette paroi"
                      title="Supprimer"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-gray-800 bg-gray-900/40">
                <td className="px-2 py-1.5 text-gray-400 text-[11px] uppercase tracking-wide">Total Stot</td>
                <td colSpan={4} className="px-2 py-1.5 font-mono text-emerald-300">{Stot.toFixed(2)} m²</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Ajouter une paroi */}
      {addMode === null && (
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setAddMode('lib')}
            className="flex items-center gap-1 text-xs text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-800 rounded px-2 py-1"
          >
            <Plus size={11} />
            Choisir dans la bibliothèque
          </button>
          <button
            onClick={() => setAddMode('manual')}
            className="flex items-center gap-1 text-xs text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded px-2 py-1"
          >
            <Plus size={11} />
            Saisir manuellement
          </button>
        </div>
      )}

      {addMode === 'lib' && (
        <div className="rounded border border-gray-700 bg-gray-900/70 p-3 space-y-2 mb-3">
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Paroi (bibliothèque, {WALL_DATABASE.length} entrées)</label>
              <select
                value={libId}
                onChange={(e) => setLibId(e.target.value)}
                className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                           px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">— Choisir une paroi —</option>
                {(Object.keys(WALLS_BY_CATEGORY) as WallCategory[]).map((cat) => (
                  <optgroup key={cat} label={CATEGORY_LABEL[cat]}>
                    {WALLS_BY_CATEGORY[cat].map((w) => (
                      <option key={w.id} value={w.id}>{w.name} (Rw {w.Rw})</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Surface (m²)</label>
              <input
                type="number"
                step="0.1"
                value={areaInput}
                onChange={(e) => setAreaInput(e.target.value)}
                className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                           px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500
                           [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                           [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setAddMode(null)}
              className="text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded px-2 py-1"
            >Annuler</button>
            <button
              onClick={submitAddFromLibrary}
              disabled={!libId}
              className="text-xs text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded px-2 py-1"
            >Ajouter</button>
          </div>
        </div>
      )}

      {addMode === 'manual' && (
        <div className="rounded border border-gray-700 bg-gray-900/70 p-3 space-y-2 mb-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Nom</label>
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="ex. Mur extérieur sur mesure"
                className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                           px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Rw (fallback)</label>
              <input
                type="number"
                step="1"
                value={manualRw}
                onChange={(e) => setManualRw(e.target.value)}
                placeholder="45"
                className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                           px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500
                           [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                           [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Surface (m²)</label>
              <input
                type="number"
                step="0.1"
                value={areaInput}
                onChange={(e) => setAreaInput(e.target.value)}
                className="text-xs bg-gray-800 text-gray-100 border border-gray-700 rounded
                           px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500
                           [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                           [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">
              Spectre R(f) optionnel — 18 valeurs pour {WALL_BANDS[0]}…{WALL_BANDS[WALL_BANDS.length - 1]} Hz
            </label>
            <textarea
              rows={2}
              value={manualSpectrumText}
              onChange={(e) => setManualSpectrumText(e.target.value)}
              placeholder="36, 38, 40, 42, 44, 45, 46, 46, 47, 48, 48, 47, 46, 44, 45, 47, 49, 50"
              className="text-xs font-mono bg-gray-800 text-gray-100 border border-gray-700 rounded
                         px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
            <p className="text-[10px] text-gray-600">
              Vide → le Rw saisi est appliqué uniformément à toutes les bandes.
            </p>
          </div>
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setAddMode(null)}
              className="text-xs text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded px-2 py-1"
            >Annuler</button>
            <button
              onClick={submitAddManual}
              className="text-xs text-white bg-emerald-600 hover:bg-emerald-500 rounded px-2 py-1"
            >Ajouter</button>
          </div>
        </div>
      )}

      {/* Correction flancs */}
      <div className="mt-4 pt-3 border-t border-gray-800">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-400">
            Correction transmissions latérales (flancs)
          </label>
          <span className="text-xs font-mono text-gray-200">
            R′ = R{flankCorrectionDb >= 0 ? '+' : ''}{flankCorrectionDb} dB
          </span>
        </div>
        <input
          type="range"
          min={-10}
          max={0}
          step={0.5}
          value={flankCorrectionDb}
          onChange={(e) => onFlankChange(parseFloat(e.target.value))}
          className="w-full accent-emerald-500"
        />
        <p className="text-[10px] text-gray-500 mt-1">
          Par défaut −5 dB : approximation conservatrice ISO 12354-1 pour un chantier typique sans traitement des flancs.
        </p>
      </div>
    </section>
  )
}
