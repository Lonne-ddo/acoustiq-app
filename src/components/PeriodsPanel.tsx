/**
 * Panneau « Périodes » — tableau compact des périodes définies sur le graphique.
 *
 * Les catégories (création, visibilité, mode de calcul) sont gérées dans la
 * sidebar (CategoriesManager). Ce panneau ne fait qu'afficher / éditer les
 * périodes et leur assignation de catégorie.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, Plus, Trash2, Check } from 'lucide-react'
import type { Period, Category } from '../types'

interface Props {
  periods: Period[]
  onAdd: (p: Period) => void
  onUpdate: (id: string, patch: Partial<Period>) => void
  onRemove: (id: string) => void
  categories: Category[]
  selectedDate: string // YYYY-MM-DD — ancre pour les périodes ajoutées manuellement
}

function fmtHHMMSS(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function fmtDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0 || h > 0) parts.push(`${String(m).padStart(h > 0 ? 2 : 1, '0')}m`)
  parts.push(`${String(s).padStart(2, '0')}s`)
  return parts.join('')
}

function parseHHMMSS(s: string): number | null {
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const mi = parseInt(m[2], 10)
  const se = m[3] ? parseInt(m[3], 10) : 0
  if (h > 23 || mi > 59 || se > 59) return null
  return ((h * 60 + mi) * 60 + se) * 1000
}

function dateToMsAtMidnight(iso: string): number {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return NaN
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)).getTime()
}

export default function PeriodsPanel({ periods, onAdd, onUpdate, onRemove, categories, selectedDate }: Props) {
  const [open, setOpen] = useState(true)
  const [adding, setAdding] = useState(false)
  const [formName, setFormName] = useState('')
  const [formStart, setFormStart] = useState('09:00:00')
  const [formEnd, setFormEnd] = useState('17:00:00')
  const [formCat, setFormCat] = useState<string>('')
  const [formNotes, setFormNotes] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [filterCat, setFilterCat] = useState<string>('all')

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const visiblePeriods = useMemo(
    () => (filterCat === 'all' ? periods : periods.filter((p) => p.categoryId === filterCat)),
    [periods, filterCat],
  )

  const defaultAddCat = categories.find((c) => c.visible && c.mode === 'include')?.id ?? categories[0]?.id ?? ''

  function submitAdd() {
    const start = parseHHMMSS(formStart)
    const end = parseHHMMSS(formEnd)
    if (start === null || end === null || !selectedDate) return
    const base = dateToMsAtMidnight(selectedDate)
    if (!Number.isFinite(base)) return
    const startMs = base + start
    let endMs = base + end
    if (endMs <= startMs) endMs += 24 * 3600 * 1000
    onAdd({
      id: crypto.randomUUID(),
      name: formName.trim() || `Période ${periods.length + 1}`,
      startMs,
      endMs,
      categoryId: formCat || defaultAddCat,
      notes: formNotes.trim() || undefined,
    })
    setAdding(false); setFormName(''); setFormNotes('')
  }

  return (
    <div className="border-t border-gray-800 bg-gray-950/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-900/60 transition-colors"
      >
        <ChevronDown size={11} className={`text-gray-500 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">
          Périodes{periods.length > 0 ? ` (${periods.length})` : ''}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setAdding((v) => !v) }}
          className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-0.5"
        >
          <Plus size={10} /> Ajouter une période
        </button>
      </button>

      {open && (
        <div className="px-4 pb-3 space-y-2">
          {/* Formulaire d'ajout manuel */}
          {adding && (
            <div className="p-2 rounded border border-gray-700/60 bg-gray-900/70 space-y-2">
              <div className="grid grid-cols-[2fr_1fr_1fr_1.4fr] gap-2">
                <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder={`Période ${periods.length + 1}`}
                  className="text-[11px] bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                <input value={formStart} onChange={(e) => setFormStart(e.target.value)} placeholder="HH:MM:SS"
                  className="text-[11px] font-mono bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                <input value={formEnd} onChange={(e) => setFormEnd(e.target.value)} placeholder="HH:MM:SS"
                  className="text-[11px] font-mono bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                <select value={formCat || defaultAddCat} onChange={(e) => setFormCat(e.target.value)}
                  className="text-[11px] bg-gray-800 text-gray-100 border border-gray-700 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={2} placeholder="Notes (optionnel)"
                className="w-full text-[11px] bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none" />
              <div className="flex gap-1 justify-end">
                <button onClick={() => setAdding(false)} className="text-[10px] text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded px-2 py-1">Annuler</button>
                <button onClick={submitAdd} className="text-[10px] text-white bg-emerald-600 hover:bg-emerald-500 rounded px-2 py-1 flex items-center gap-1"><Check size={10} /> Ajouter</button>
              </div>
            </div>
          )}

          {/* Tableau des périodes */}
          {periods.length > 0 ? (
            <div className="rounded border border-gray-800">
              {categories.length > 1 && (
                <div className="flex items-center gap-2 px-2 py-1 border-b border-gray-800">
                  <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
                    className="ml-auto text-[10px] bg-gray-800 text-gray-300 border border-gray-700 rounded px-1 py-0.5 focus:outline-none">
                    <option value="all">Toutes les catégories</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-[10px] text-gray-500 uppercase tracking-wide border-b border-gray-800">
                    <th className="text-left px-2 py-1 font-semibold">Nom</th>
                    <th className="text-left px-2 py-1 font-semibold">Cat.</th>
                    <th className="text-left px-2 py-1 font-semibold">Début</th>
                    <th className="text-left px-2 py-1 font-semibold">Fin</th>
                    <th className="text-left px-2 py-1 font-semibold">Durée</th>
                    <th className="text-right px-2 py-1 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePeriods.map((p) => {
                    const dur = Math.max(0, p.endMs - p.startMs)
                    const isEditing = editingId === p.id
                    const cat = catById.get(p.categoryId)
                    return (
                      <tr key={p.id} className="border-b border-gray-900 last:border-0">
                        <td className="px-2 py-1 text-gray-200">
                          {isEditing ? (
                            <input
                              autoFocus value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onBlur={() => { onUpdate(p.id, { name: editingName.trim() || p.name }); setEditingId(null) }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { onUpdate(p.id, { name: editingName.trim() || p.name }); setEditingId(null) }
                                else if (e.key === 'Escape') setEditingId(null)
                              }}
                              className="text-[11px] bg-gray-800 text-gray-100 border border-gray-700 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-full"
                            />
                          ) : (
                            <button onClick={() => { setEditingId(p.id); setEditingName(p.name) }} className="text-left w-full hover:text-emerald-300 truncate" title={p.notes || 'Renommer'}>
                              {p.name}
                            </button>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-1">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat?.color ?? '#6b7280' }} />
                            <select
                              value={p.categoryId}
                              onChange={(e) => onUpdate(p.id, { categoryId: e.target.value })}
                              className="text-[10px] bg-transparent text-gray-300 border border-transparent hover:border-gray-700 rounded px-0.5 py-0.5 focus:outline-none focus:border-emerald-500"
                              title="Changer de catégorie"
                            >
                              {categories.map((c) => <option key={c.id} value={c.id} className="bg-gray-800">{c.name}</option>)}
                            </select>
                          </div>
                        </td>
                        <td className="px-2 py-1 font-mono text-gray-300">{fmtHHMMSS(p.startMs)}</td>
                        <td className="px-2 py-1 font-mono text-gray-300">{fmtHHMMSS(p.endMs)}</td>
                        <td className="px-2 py-1 font-mono text-gray-400">{fmtDuration(dur)}</td>
                        <td className="px-2 py-1 text-right">
                          <button onClick={() => onRemove(p.id)} className="text-gray-600 hover:text-red-400" title="Supprimer"><Trash2 size={11} /></button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[11px] text-gray-500 italic leading-tight py-1">
              Aucune période définie. Cliquez-glissez sur le graphique pour en créer une.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
