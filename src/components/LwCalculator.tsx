/**
 * Module de calcul de puissance acoustique Lw
 * Trois méthodes : Toiture Q=1, Sol Q=2, Parallélépipède ISO 3744
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { Plus, Trash2, Download, ChevronRight, Upload, FileSpreadsheet, Send, AlertCircle, CheckCircle2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import HelpTooltip from './HelpTooltip'
import {
  lwRoof,
  lwGround,
  lwParallelepiped,
  combineLw,
} from '../modules/lwCalculator'
import { parseLpFile, type UniversalParseResult, type ParsedSheetSummary } from '../utils/universalParser'

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

export default function LwCalculator({ onSourcesChange }: { onSourcesChange?: (sources: Array<{ id: string; name: string; lw: number; type: 'roof' | 'ground' | 'parallelepiped' }>) => void } = {}) {
  const [sources, setSources] = useState<LwSource[]>([])
  const [section, setSection] = useState<Section>('roof')
  const [mode, setMode] = useState<'manual' | 'import'>('manual')

  // Notifier le parent quand les sources changent
  useEffect(() => {
    if (onSourcesChange) {
      onSourcesChange(sources.map((s) => ({ id: s.id, name: s.name, lw: computeLw(s), type: s.type })))
    }
  }, [sources, onSourcesChange])

  function addSource(src: LwSource) {
    setSources((prev) => [...prev, src])
  }

  function removeSource(id: string) {
    setSources((prev) => prev.filter((s) => s.id !== id))
  }

  return (
    <div className="flex flex-col h-full">
      {/* En-tête + toggle de mode */}
      <div className="px-6 py-3 border-b border-gray-800 shrink-0 flex items-center justify-between gap-4">
        <p className="text-xs text-gray-500">
          Calcul de puissance acoustique Lw à partir de niveaux de pression mesurés
        </p>
        <div className="flex gap-1 bg-gray-900 p-1 rounded-lg border border-gray-800 shrink-0">
          <button
            onClick={() => setMode('manual')}
            className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
              mode === 'manual' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Saisie manuelle
          </button>
          <button
            onClick={() => setMode('import')}
            className={`text-xs px-3 py-1 rounded-md font-medium transition-colors flex items-center gap-1 ${
              mode === 'import' ? 'bg-gray-700 text-gray-100' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <FileSpreadsheet size={12} /> Import Excel
          </button>
        </div>
      </div>

      {mode === 'manual' ? (
        /* Corps : formulaire + bilan */
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
      ) : (
        <ImportMode onSend={(newSources) => { setSources((prev) => [...prev, ...newSources]); setMode('manual') }} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Import Excel — parser universel + tableau éditable
// ─────────────────────────────────────────────────────────────────────────────

interface ImportRow {
  id: string
  name: string
  lp: number
  distance: number
  k2: number
  q: 'roof' | 'ground'
}

function ImportMode({ onSend }: { onSend: (sources: LwSource[]) => void }) {
  const [result, setResult] = useState<UniversalParseResult | null>(null)
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [defaultQ, setDefaultQ] = useState<'roof' | 'ground'>('ground')
  const [defaultDistance, setDefaultDistance] = useState('10')
  const [defaultK2, setDefaultK2] = useState('0')
  const [rows, setRows] = useState<ImportRow[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeSheet: ParsedSheetSummary | null = useMemo(() => {
    if (!result || !selectedSheet) return null
    return result.sheets.find((s) => s.name === selectedSheet) ?? null
  }, [result, selectedSheet])

  async function handleFile(file: File) {
    setParseError(null)
    setRows([])
    try {
      const r = await parseLpFile(file)
      if (r.sheets.length === 0) {
        setParseError('Aucun onglet exploitable — aucune colonne Lp/LAeq détectée.')
        setResult(null)
        return
      }
      setResult(r)
      setSelectedSheet(r.sheets[0].name)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Erreur de lecture du fichier.')
      setResult(null)
    }
  }

  function populateFromSheet() {
    if (!activeSheet) return
    const d = parseNum(defaultDistance)
    const k2 = parseNum(defaultK2)
    const next: ImportRow[] = activeSheet.rows.map((r, i) => ({
      id: crypto.randomUUID(),
      name: r.name || `Source ${i + 1}`,
      lp: r.lp,
      distance: r.distance ?? (d > 0 ? d : 10),
      k2,
      q: defaultQ,
    }))
    setRows(next)
  }

  function updateRow(id: string, patch: Partial<ImportRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  function addRow() {
    setRows((prev) => [...prev, {
      id: crypto.randomUUID(),
      name: `Source ${prev.length + 1}`,
      lp: 70,
      distance: parseNum(defaultDistance) || 10,
      k2: parseNum(defaultK2),
      q: defaultQ,
    }])
  }

  function computeRowLw(r: ImportRow): number {
    return r.q === 'roof' ? lwRoof(r.lp, r.distance, r.k2) : lwGround(r.lp, r.distance, r.k2)
  }

  const globalLw = useMemo(() => {
    if (rows.length === 0) return null
    return combineLw(rows.map(computeRowLw))
  }, [rows])

  function exportExcel() {
    if (rows.length === 0) return
    const data = [
      ['Nom', 'Lp (dBA)', 'Distance (m)', 'Q', 'K2 (dB)', 'Lw (dBA)'],
      ...rows.map((r) => [
        r.name,
        r.lp,
        r.distance,
        r.q === 'roof' ? 'Toiture (Q=1)' : 'Sol (Q=2)',
        r.k2,
        Number(computeRowLw(r).toFixed(1)),
      ]),
      [],
      ['Lw global (somme énergétique)', '', '', '', '', globalLw !== null ? Number(globalLw.toFixed(1)) : ''],
    ]
    const ws = XLSX.utils.aoa_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Lw calculés')
    XLSX.writeFile(wb, 'acoustiq_lw_import.xlsx')
  }

  function sendToManual() {
    const newSources: LwSource[] = rows.map((r) => ({
      id: crypto.randomUUID(),
      name: r.name,
      type: r.q,
      lp: r.lp,
      d: r.distance,
      correction: r.k2,
    }))
    onSend(newSources)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-5 space-y-5">
        {/* 1. Upload */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5">
            <Upload size={12} /> 1. Importer un fichier de mesures
          </h3>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            className="block w-full text-xs text-gray-400 file:mr-3 file:px-3 file:py-1.5 file:rounded file:border file:border-gray-600 file:bg-gray-800 file:text-gray-200 file:text-xs file:cursor-pointer hover:file:bg-gray-700"
          />
          {parseError && (
            <p className="mt-2 text-[11px] text-red-400 flex items-center gap-1">
              <AlertCircle size={11} /> {parseError}
            </p>
          )}
        </div>

        {/* 2. Détection + paramètres */}
        {result && result.sheets.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
            <h3 className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-emerald-400" /> 2. Paramètres détectés
            </h3>
            {result.sheets.length > 1 && (
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-gray-500">Onglet source</label>
                <select
                  value={selectedSheet ?? ''}
                  onChange={(e) => setSelectedSheet(e.target.value)}
                  className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {result.sheets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} — {s.rows.length} source{s.rows.length > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {activeSheet && (
              <div className="text-[11px] text-gray-400 space-y-1">
                <div className="flex flex-wrap gap-2">
                  <span className="px-2 py-0.5 bg-emerald-950/40 border border-emerald-800 rounded text-emerald-300">
                    {activeSheet.rows.length} sources détectées
                  </span>
                  <span className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded">
                    Ligne en-tête : {activeSheet.headerRow + 1}
                  </span>
                  {activeSheet.columns.lp !== undefined && (
                    <span className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded">
                      Lp : col. {activeSheet.columns.lp + 1}
                    </span>
                  )}
                  {activeSheet.columns.distance !== undefined && (
                    <span className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded">
                      Distance : col. {activeSheet.columns.distance + 1}
                    </span>
                  )}
                  {activeSheet.columns.name !== undefined && (
                    <span className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded">
                      Nom : col. {activeSheet.columns.name + 1}
                    </span>
                  )}
                </div>
                {activeSheet.warning && (
                  <p className="text-amber-400 italic">⚠ {activeSheet.warning}</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-gray-800">
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] text-gray-500">Type de surface</label>
                <select
                  value={defaultQ}
                  onChange={(e) => setDefaultQ(e.target.value as 'roof' | 'ground')}
                  className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="roof">Toiture (Q=1)</option>
                  <option value="ground">Sol (Q=2)</option>
                </select>
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] text-gray-500">Distance par défaut (m)</label>
                <input
                  type="number"
                  step="any"
                  value={defaultDistance}
                  onChange={(e) => setDefaultDistance(e.target.value)}
                  className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[11px] text-gray-500">K2 météo (dB)</label>
                <input
                  type="number"
                  step="any"
                  value={defaultK2}
                  onChange={(e) => setDefaultK2(e.target.value)}
                  className="text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
            <button
              onClick={populateFromSheet}
              disabled={!activeSheet || activeSheet.rows.length === 0}
              className="w-full text-xs bg-emerald-700 hover:bg-emerald-600 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed text-white font-medium rounded px-3 py-1.5 transition-colors"
            >
              Calculer les Lw
            </button>
          </div>
        )}

        {/* 3. Tableau résultat */}
        {rows.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
            <h3 className="text-xs font-semibold text-gray-300">3. Résultats (éditable)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-1.5 px-2 font-medium">Nom</th>
                    <th className="text-right py-1.5 px-2 font-medium">Lp (dBA)</th>
                    <th className="text-right py-1.5 px-2 font-medium">Dist. (m)</th>
                    <th className="text-left py-1.5 px-2 font-medium">Q</th>
                    <th className="text-right py-1.5 px-2 font-medium">K2</th>
                    <th className="text-right py-1.5 px-2 font-medium text-emerald-400">Lw (dBA)</th>
                    <th className="py-1.5 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-gray-800/60 hover:bg-gray-800/30">
                      <td className="py-1 px-2">
                        <input
                          type="text"
                          value={r.name}
                          onChange={(e) => updateRow(r.id, { name: e.target.value })}
                          className="w-full bg-transparent text-gray-200 focus:outline-none focus:bg-gray-800 rounded px-1"
                        />
                      </td>
                      <td className="py-1 px-2">
                        <input
                          type="number"
                          step="any"
                          value={r.lp}
                          onChange={(e) => updateRow(r.id, { lp: parseFloat(e.target.value) || 0 })}
                          className="w-20 bg-transparent text-right text-gray-200 focus:outline-none focus:bg-gray-800 rounded px-1"
                        />
                      </td>
                      <td className="py-1 px-2">
                        <input
                          type="number"
                          step="any"
                          value={r.distance}
                          onChange={(e) => updateRow(r.id, { distance: parseFloat(e.target.value) || 0 })}
                          className="w-20 bg-transparent text-right text-gray-200 focus:outline-none focus:bg-gray-800 rounded px-1"
                        />
                      </td>
                      <td className="py-1 px-2">
                        <select
                          value={r.q}
                          onChange={(e) => updateRow(r.id, { q: e.target.value as 'roof' | 'ground' })}
                          className="bg-transparent text-gray-200 focus:outline-none focus:bg-gray-800 rounded px-1"
                        >
                          <option value="roof">Toiture</option>
                          <option value="ground">Sol</option>
                        </select>
                      </td>
                      <td className="py-1 px-2">
                        <input
                          type="number"
                          step="any"
                          value={r.k2}
                          onChange={(e) => updateRow(r.id, { k2: parseFloat(e.target.value) || 0 })}
                          className="w-16 bg-transparent text-right text-gray-200 focus:outline-none focus:bg-gray-800 rounded px-1"
                        />
                      </td>
                      <td className="py-1 px-2 text-right font-semibold text-emerald-300 tabular-nums">
                        {computeRowLw(r).toFixed(1)}
                      </td>
                      <td className="py-1 px-2 text-right">
                        <button
                          onClick={() => removeRow(r.id)}
                          className="text-gray-600 hover:text-red-400"
                          aria-label={`Supprimer ${r.name}`}
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-emerald-800/60 bg-emerald-950/20">
                    <td colSpan={5} className="py-2 px-2 text-right text-gray-300 font-semibold">
                      Lw global (somme énergétique)
                    </td>
                    <td className="py-2 px-2 text-right font-bold text-emerald-300 tabular-nums">
                      {globalLw !== null ? `${globalLw.toFixed(1)}` : '—'}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button
                onClick={addRow}
                className="text-xs flex items-center gap-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded px-3 py-1.5 transition-colors"
              >
                <Plus size={12} /> Ajouter une source
              </button>
              <button
                onClick={exportExcel}
                className="text-xs flex items-center gap-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 rounded px-3 py-1.5 transition-colors"
              >
                <Download size={12} /> Exporter Excel
              </button>
              <button
                onClick={sendToManual}
                className="ml-auto text-xs flex items-center gap-1 bg-blue-700 hover:bg-blue-600 text-white rounded px-3 py-1.5 transition-colors"
                title="Ajoute les sources au bilan manuel (elles seront alors disponibles dans la Vue 3D)"
              >
                <Send size={12} /> Envoyer vers Vue 3D
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
