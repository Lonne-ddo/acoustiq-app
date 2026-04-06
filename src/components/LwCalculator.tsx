/**
 * Module de calcul de puissance acoustique Lw
 * Trois méthodes : Toiture Q=1, Sol Q=2, Parallélépipède ISO 3744
 */
import { useState, useMemo } from 'react'
import { Plus, Trash2, Download, ChevronRight } from 'lucide-react'
import HelpTooltip from './HelpTooltip'
import {
  lwRoof,
  lwGround,
  lwParallelepiped,
  combineLw,
} from '../modules/lwCalculator'

// ---- Types internes --------------------------------------------------------
interface RoofGroundSource {
  id: string
  name: string
  type: 'roof' | 'ground'
  lp: number
  d: number
  correction: number
}

interface ParaSurface {
  id: string
  lp: number
  area: number
}

interface ParaSource {
  id: string
  name: string
  type: 'parallelepiped'
  surfaces: ParaSurface[]
  correction: number
}

type LwSource = RoofGroundSource | ParaSource

type Section = 'roof' | 'ground' | 'parallelepiped'

// ---- Calcul du Lw pour une source ------------------------------------------
function computeLw(src: LwSource): number {
  switch (src.type) {
    case 'roof':           return lwRoof(src.lp, src.d, src.correction)
    case 'ground':         return lwGround(src.lp, src.d, src.correction)
    case 'parallelepiped': return lwParallelepiped(src.surfaces, src.correction)
  }
}

// ---- Libellés --------------------------------------------------------------
const TYPE_LABEL: Record<LwSource['type'], string> = {
  roof:            'Toiture Q=1',
  ground:          'Sol Q=2',
  parallelepiped:  'ISO 3744',
}

const TYPE_HELP: Record<LwSource['type'], string> = {
  roof:            'Lw = Lp + 20·log₁₀(d) + 11 − C  — Rayonnement hémisphérique (source en toiture, Q=1).',
  ground:          'Lw = Lp + 20·log₁₀(d) + 8 − C  — Rayonnement quart de sphère (source au sol, Q=2).',
  parallelepiped:  'Lw = 10·log₁₀(Σ 10^(Lp_i/10) · S_i) − C  — Méthode mobile ISO 3744, somme sur les surfaces.',
}

// ---- Export CSV ------------------------------------------------------------
function exportCSV(sources: LwSource[]) {
  const header = 'Nom;Type;Lw (dB);Détail'
  const rows = sources
    .map((s) => {
      const lw = computeLw(s).toFixed(1)
      let detail = ''
      if (s.type === 'roof' || s.type === 'ground') {
        detail = `Lp=${s.lp} dB, d=${s.d} m, C=${s.correction} dB`
      } else if (s.type === 'parallelepiped') {
        detail = `${s.surfaces.length} surface(s), C=${s.correction} dB`
      }
      return [s.name, TYPE_LABEL[s.type], lw, detail].join(';')
    })
  const total = combineLw(sources.map(computeLw)).toFixed(1)
  rows.push(`Total combiné;;${total};`)

  const csv = '\uFEFF' + [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'bilan_lw_acoustiq.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ---- Utilitaires formulaire ------------------------------------------------
function parseNum(s: string): number {
  const v = parseFloat(s.replace(',', '.'))
  return isNaN(v) ? 0 : v
}

function isValidNum(s: string): boolean {
  return s.trim() !== '' && !isNaN(parseFloat(s.replace(',', '.')))
}

// ---- Champ numérique stylé -------------------------------------------------
function NumInput({
  value, onChange, placeholder, label, unit, step = 'any',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  label: string
  unit?: string
  step?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs text-gray-500">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full text-xs bg-gray-800 text-gray-100 border border-gray-600
                     rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500
                     [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                     [&::-webkit-inner-spin-button]:appearance-none"
        />
        {unit && <span className="text-xs text-gray-500 shrink-0">{unit}</span>}
      </div>
    </div>
  )
}

// ---- Résultat Lw en direct -------------------------------------------------
function LiveResult({ lw, valid }: { lw: number; valid: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
      valid
        ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
        : 'bg-gray-800 border-gray-700 text-gray-600'
    }`}>
      <ChevronRight size={13} />
      <span className="text-xs font-medium">Lw calculé :</span>
      <span className="text-sm font-bold tabular-nums">
        {valid ? `${lw.toFixed(1)} dB(A)` : '—'}
      </span>
    </div>
  )
}

// ---- Section Toiture / Sol -------------------------------------------------
function SimpleSection({
  type, onAdd,
}: {
  type: 'roof' | 'ground'
  onAdd: (src: LwSource) => void
}) {
  const [name, setName] = useState('')
  const [lp, setLp] = useState('')
  const [d, setD] = useState('')
  const [corr, setCorr] = useState('0')

  const valid = name.trim() !== '' && isValidNum(lp) && isValidNum(d) && parseNum(d) > 0
  const liveLw = valid
    ? (type === 'roof'
        ? lwRoof(parseNum(lp), parseNum(d), parseNum(corr))
        : lwGround(parseNum(lp), parseNum(d), parseNum(corr)))
    : 0

  function handleAdd() {
    if (!valid) return
    onAdd({
      id: crypto.randomUUID(),
      name: name.trim(),
      type,
      lp: parseNum(lp),
      d: parseNum(d),
      correction: parseNum(corr),
    })
    setName(''); setLp(''); setD(''); setCorr('0')
  }

  const label = type === 'roof' ? 'Toiture — Q = 1' : 'Sol — Q = 2'
  const formula = type === 'roof'
    ? 'Lw = Lp + 20·log(d) + 11 − C'
    : 'Lw = Lp + 20·log(d) + 8 − C'

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-gray-300">{label}</p>
        <p className="text-xs text-gray-600 mt-0.5 font-mono">{formula}</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {/* Nom */}
        <div className="col-span-2 flex flex-col gap-0.5">
          <label className="text-xs text-gray-500">Nom de la source</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex. Groupe froid toiture T1"
            className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                       px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        {/* Lp */}
        <NumInput value={lp} onChange={setLp} label="Lp mesuré" unit="dB(A)" placeholder="65.0" />
        {/* Distance */}
        <NumInput value={d} onChange={setD} label="Distance" unit="m" placeholder="10.0" step="0.1" />
        {/* Correction météo */}
        <div className="col-span-2">
          <NumInput value={corr} onChange={setCorr} label="Correction météo (K2)" unit="dB" placeholder="0" />
        </div>
      </div>

      <LiveResult lw={liveLw} valid={valid} />

      <button
        onClick={handleAdd}
        disabled={!valid}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md
                   bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40
                   disabled:cursor-not-allowed text-sm font-medium transition-colors"
      >
        <Plus size={13} />
        Ajouter cette source
      </button>
    </div>
  )
}

// ---- Section Parallélépipède (ISO 3744) ------------------------------------
interface ParaRow { id: string; lp: string; area: string }

function ParallelepipedSection({ onAdd }: { onAdd: (src: LwSource) => void }) {
  const [name, setName] = useState('')
  const [corr, setCorr] = useState('0')
  const [rows, setRows] = useState<ParaRow[]>([
    { id: crypto.randomUUID(), lp: '', area: '' },
  ])

  const parsedRows = rows
    .filter((r) => isValidNum(r.lp) && isValidNum(r.area) && parseNum(r.area) > 0)
    .map((r) => ({ lp: parseNum(r.lp), area: parseNum(r.area) }))

  const valid = name.trim() !== '' && parsedRows.length > 0
  const liveLw = valid ? lwParallelepiped(parsedRows, parseNum(corr)) : 0

  function updateRow(id: string, field: 'lp' | 'area', val: string) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: val } : r))
  }

  function addRow() {
    setRows((prev) => [...prev, { id: crypto.randomUUID(), lp: '', area: '' }])
  }

  function removeRow(id: string) {
    setRows((prev) => prev.length > 1 ? prev.filter((r) => r.id !== id) : prev)
  }

  function handleAdd() {
    if (!valid) return
    onAdd({
      id: crypto.randomUUID(),
      name: name.trim(),
      type: 'parallelepiped',
      surfaces: parsedRows.map((r) => ({ id: crypto.randomUUID(), ...r })),
      correction: parseNum(corr),
    })
    setName('')
    setCorr('0')
    setRows([{ id: crypto.randomUUID(), lp: '', area: '' }])
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-gray-300">Méthode mobile — ISO 3744</p>
        <p className="text-xs text-gray-600 mt-0.5 font-mono">Lw = 10·log(Σ 10^(Lp_i/10) · S_i) − C</p>
      </div>

      {/* Nom + Correction */}
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 flex flex-col gap-0.5">
          <label className="text-xs text-gray-500">Nom de la source</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex. Compresseur extérieur"
            className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                       px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div className="col-span-2">
          <NumInput value={corr} onChange={setCorr} label="Correction météo (K2)" unit="dB" placeholder="0" />
        </div>
      </div>

      {/* Tableau des surfaces */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs text-gray-500">Mesures de surface</p>
          <button
            onClick={addRow}
            className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
          >
            <Plus size={11} /> Ajouter une surface
          </button>
        </div>

        <div className="space-y-1.5">
          {/* En-tête */}
          <div className="grid grid-cols-[1fr_1fr_28px] gap-1.5 px-1">
            <span className="text-xs text-gray-600">Lp (dB)</span>
            <span className="text-xs text-gray-600">Surface (m²)</span>
            <span />
          </div>

          {rows.map((row) => (
            <div key={row.id} className="grid grid-cols-[1fr_1fr_28px] gap-1.5 items-center">
              <input
                type="number"
                step="any"
                value={row.lp}
                onChange={(e) => updateRow(row.id, 'lp', e.target.value)}
                placeholder="65.0"
                className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                           px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500
                           [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                           [&::-webkit-inner-spin-button]:appearance-none"
              />
              <input
                type="number"
                step="any"
                value={row.area}
                onChange={(e) => updateRow(row.id, 'area', e.target.value)}
                placeholder="4.0"
                className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                           px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500
                           [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                           [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                onClick={() => removeRow(row.id)}
                disabled={rows.length === 1}
                className="text-gray-600 hover:text-red-400 disabled:opacity-30 transition-colors"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs text-gray-700 mt-1">
          {parsedRows.length}/{rows.length} ligne{rows.length > 1 ? 's' : ''} valide{parsedRows.length > 1 ? 's' : ''}
        </p>
      </div>

      <LiveResult lw={liveLw} valid={valid} />

      <button
        onClick={handleAdd}
        disabled={!valid}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md
                   bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40
                   disabled:cursor-not-allowed text-sm font-medium transition-colors"
      >
        <Plus size={13} />
        Ajouter cette source
      </button>
    </div>
  )
}

// ---- Tableau bilan ---------------------------------------------------------
function SummaryTable({
  sources, onRemove,
}: {
  sources: LwSource[]
  onRemove: (id: string) => void
}) {
  const sorted = useMemo(
    () => [...sources].sort((a, b) => computeLw(b) - computeLw(a)),
    [sources],
  )

  const lwValues = sorted.map(computeLw)
  const total = sorted.length > 0 ? combineLw(lwValues) : null

  if (sorted.length === 0) {
    return (
      <div className="text-center text-gray-700 text-xs py-6">
        Aucune source ajoutée — utilisez les sections ci-dessus pour calculer des Lw.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Bilan des sources
        </p>
        <button
          onClick={() => exportCSV(sources)}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded
                     bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700
                     transition-colors"
        >
          <Download size={11} />
          Exporter CSV
        </button>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-800">
            <th className="text-left px-2 py-1.5 text-gray-500 font-medium">Source</th>
            <th className="text-left px-2 py-1.5 text-gray-500 font-medium">Type</th>
            <th className="text-right px-2 py-1.5 text-gray-500 font-medium">Lw</th>
            <th className="w-7" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((src, i) => {
            const lw = lwValues[i]
            return (
              <tr key={src.id} className="border-b border-gray-800/60 hover:bg-gray-900/40">
                <td className="px-2 py-1.5 text-gray-200 font-medium truncate max-w-0 w-1/2">
                  {src.name}
                </td>
                <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    {TYPE_LABEL[src.type]}
                    <HelpTooltip text={TYPE_HELP[src.type]} position="right" />
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-gray-100 font-semibold whitespace-nowrap">
                  {lw.toFixed(1)}
                  <span className="text-gray-600 font-normal ml-0.5">dB(A)</span>
                </td>
                <td className="pl-1 pr-2 py-1.5">
                  <button
                    onClick={() => onRemove(src.id)}
                    className="text-gray-700 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
        {total !== null && (
          <tfoot>
            <tr className="border-t-2 border-gray-700">
              <td colSpan={2} className="px-2 py-2 text-gray-400 font-semibold text-xs uppercase tracking-wide">
                Total combiné
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-emerald-300 font-bold whitespace-nowrap">
                {total.toFixed(1)}
                <span className="text-emerald-600 font-normal ml-0.5">dB(A)</span>
              </td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ---- Composant principal ---------------------------------------------------
const SECTION_LABELS: Record<Section, string> = {
  roof:           'Toiture',
  ground:         'Sol',
  parallelepiped: 'Mobile ISO 3744',
}

export default function LwCalculator() {
  const [sources, setSources] = useState<LwSource[]>([])
  const [section, setSection] = useState<Section>('roof')

  function addSource(src: LwSource) {
    setSources((prev) => [...prev, src])
  }

  function removeSource(id: string) {
    setSources((prev) => prev.filter((s) => s.id !== id))
  }

  return (
    <div className="flex flex-col h-full">
      {/* En-tête */}
      <div className="px-6 py-3 border-b border-gray-800 shrink-0">
        <p className="text-xs text-gray-500">
          Calcul de puissance acoustique Lw à partir de niveaux de pression mesurés
        </p>
      </div>

      {/* Corps : formulaire + bilan */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-5 space-y-6">

          {/* Sélecteur de section */}
          <div className="flex gap-1 bg-gray-900 p-1 rounded-lg border border-gray-800">
            {(Object.keys(SECTION_LABELS) as Section[]).map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
                  section === s
                    ? 'bg-gray-700 text-gray-100 shadow-sm'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {SECTION_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Formulaire de la section active */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            {section === 'roof' && (
              <SimpleSection type="roof" onAdd={addSource} />
            )}
            {section === 'ground' && (
              <SimpleSection type="ground" onAdd={addSource} />
            )}
            {section === 'parallelepiped' && (
              <ParallelepipedSection onAdd={addSource} />
            )}
          </div>

          {/* Tableau bilan */}
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <SummaryTable sources={sources} onRemove={removeSource} />
          </div>
        </div>
      </div>
    </div>
  )
}
