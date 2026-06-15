/**
 * Panneau de gestion des périodes — système de catégories.
 *
 * Chaque période est assignée à une catégorie. Chaque catégorie a un toggle
 * « incluse dans les calculs ». Les indices acoustiques sont calculés sur
 * l'union des périodes des catégories `included === true && isAnnotation === false`.
 * Aucune période active → calcul sur tout.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, Plus, Trash2, Check, X } from 'lucide-react'
import type { Period, Category, CategoryMode } from '../types'
import { PERIOD_PALETTE, DEFAULT_CATEGORY_IDS } from '../types'

interface Props {
  periods: Period[]
  onAdd: (p: Period) => void
  onUpdate: (id: string, patch: Partial<Period>) => void
  onRemove: (id: string) => void
  categories: Category[]
  onCategoryAdd: (c: Category) => void
  onCategoryUpdate: (id: string, patch: Partial<Category>) => void
  onCategoryRemove: (id: string, reassignTo: string | null) => void
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

export default function PeriodsPanel({
  periods, onAdd, onUpdate, onRemove,
  categories, onCategoryAdd, onCategoryUpdate, onCategoryRemove,
  selectedDate,
}: Props) {
  const [open, setOpen] = useState(true)
  const [adding, setAdding] = useState(false)
  const [formName, setFormName] = useState('')
  const [formStart, setFormStart] = useState('09:00:00')
  const [formEnd, setFormEnd] = useState('17:00:00')
  const [formCat, setFormCat] = useState<string>('')
  const [formNotes, setFormNotes] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  // Catégories
  const [catEditId, setCatEditId] = useState<string | null>(null)
  const [catEditName, setCatEditName] = useState('')
  const [colorPickerId, setColorPickerId] = useState<string | null>(null)
  const [newCat, setNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatColor, setNewCatColor] = useState<string>(PERIOD_PALETTE[0])
  const [newCatMode, setNewCatMode] = useState<CategoryMode>('include')
  const [filterCat, setFilterCat] = useState<string>('all')

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  // Statistiques par catégorie : nombre de périodes + durée cumulée.
  const statsByCat = useMemo(() => {
    const m = new Map<string, { count: number; ms: number }>()
    for (const c of categories) m.set(c.id, { count: 0, ms: 0 })
    for (const p of periods) {
      const s = m.get(p.categoryId)
      if (!s) continue
      s.count++
      s.ms += Math.max(0, p.endMs - p.startMs)
    }
    return m
  }, [periods, categories])

  // Résumé « calculé sur » : catégories visibles en mode include avec périodes.
  const calcSummary = useMemo(() => {
    const active = categories.filter((c) => c.visible && c.mode === 'include')
    const activeIds = new Set(active.map((c) => c.id))
    const used = periods.filter((p) => activeIds.has(p.categoryId))
    const totalMs = used.reduce((sum, p) => sum + Math.max(0, p.endMs - p.startMs), 0)
    return { names: active.map((c) => c.name), count: used.length, totalMs }
  }, [categories, periods])

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

  function removeCategory(c: Category) {
    const stat = statsByCat.get(c.id)
    if (!stat || stat.count === 0) {
      if (!window.confirm(`Supprimer la catégorie « ${c.name} » ?`)) return
      onCategoryRemove(c.id, null)
      return
    }
    const others = categories.filter((o) => o.id !== c.id)
    const target = others[0]
    const reassign = window.confirm(
      `La catégorie « ${c.name} » contient ${stat.count} période(s).\n\n` +
      (target
        ? `OK = réaffecter ses périodes à « ${target.name} »\nAnnuler = supprimer aussi ces périodes`
        : `Aucune autre catégorie : OK = supprimer aussi ces périodes`),
    )
    onCategoryRemove(c.id, reassign && target ? target.id : null)
  }

  function createCategory() {
    onCategoryAdd({
      id: crypto.randomUUID(),
      name: newCatName.trim() || `Catégorie ${categories.length + 1}`,
      color: newCatColor,
      mode: newCatMode,
      visible: true,
    })
    setNewCat(false); setNewCatName('')
  }

  // Libellé du mode de contribution au calcul (affiché sous le nom).
  function modeLabel(c: Category): string {
    if (c.mode === 'include') return c.id === DEFAULT_CATEGORY_IDS.residuel ? 'Inclus dans le calcul (référence)' : 'Inclus dans le calcul'
    if (c.mode === 'exclude') return 'Exclu du calcul'
    return 'Annotation seulement'
  }
  // Cycle le mode include → exclude → annotation.
  function cycleMode(c: Category) {
    const next: CategoryMode = c.mode === 'include' ? 'exclude' : c.mode === 'exclude' ? 'annotation' : 'include'
    onCategoryUpdate(c.id, { mode: next })
  }
  function pulseCategory(id: string) {
    document.dispatchEvent(new CustomEvent('acoustiq:pulse-category', { detail: id }))
  }

  return (
    <div className="border-t border-gray-800 bg-gray-950/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-900/60 transition-colors"
      >
        <ChevronDown size={11} className={`text-gray-500 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">Périodes</span>
        <span className="text-[10px] text-gray-500">
          {periods.length === 0
            ? 'aucune — calcul sur tout'
            : `${periods.length} période${periods.length > 1 ? 's' : ''} · ${categories.length} catégorie${categories.length > 1 ? 's' : ''}`}
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
          {/* ── Gestionnaire de catégories ─────────────────────────────── */}
          <div className="rounded border border-gray-800">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
              Catégories
            </div>
            <div className="divide-y divide-gray-900">
              {categories.map((c) => {
                const stat = statsByCat.get(c.id) ?? { count: 0, ms: 0 }
                const stop = (e: React.MouseEvent) => e.stopPropagation()
                return (
                  <div
                    key={c.id}
                    onClick={() => pulseCategory(c.id)}
                    className={`px-2 py-1 cursor-pointer hover:bg-gray-900/50 ${c.visible ? '' : 'opacity-60'}`}
                    title="Cliquer pour localiser les bandes sur le graphique"
                  >
                    <div className="flex items-center gap-2">
                      {/* Case = visibilité (affichage des bandes + activation calcul) */}
                      <input
                        type="checkbox"
                        checked={c.visible}
                        onClick={stop}
                        onChange={(e) => onCategoryUpdate(c.id, { visible: e.target.checked })}
                        title="Afficher les bandes et activer dans les calculs"
                        className="accent-emerald-500"
                      />
                      {/* Pastille couleur — clic = palette */}
                      <div className="relative" onClick={stop}>
                        <button
                          onClick={() => setColorPickerId((v) => (v === c.id ? null : c.id))}
                          className="w-3 h-3 rounded-full border border-black/30 shrink-0 block"
                          style={{ backgroundColor: c.color }}
                          title="Changer la couleur"
                        />
                        {colorPickerId === c.id && (
                          <div className="absolute z-30 top-4 left-0 flex gap-1 p-1 bg-gray-900 border border-gray-700 rounded shadow-lg">
                            {PERIOD_PALETTE.map((col) => (
                              <button
                                key={col}
                                onClick={() => { onCategoryUpdate(c.id, { color: col }); setColorPickerId(null) }}
                                className="w-3.5 h-3.5 rounded-full border border-gray-700 hover:scale-110 transition-transform"
                                style={{ backgroundColor: col }}
                                aria-label={`Couleur ${col}`}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Nom — clic = renommer */}
                      {catEditId === c.id ? (
                        <input
                          autoFocus
                          value={catEditName}
                          onClick={stop}
                          onChange={(e) => setCatEditName(e.target.value)}
                          onBlur={() => { onCategoryUpdate(c.id, { name: catEditName.trim() || c.name }); setCatEditId(null) }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { onCategoryUpdate(c.id, { name: catEditName.trim() || c.name }); setCatEditId(null) }
                            else if (e.key === 'Escape') setCatEditId(null)
                          }}
                          className="text-[11px] bg-gray-800 text-gray-100 border border-gray-700 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                        />
                      ) : (
                        <button
                          onClick={(e) => { stop(e); setCatEditId(c.id); setCatEditName(c.name) }}
                          className="text-[11px] text-gray-200 hover:text-emerald-300"
                          title="Renommer"
                        >
                          {c.name}
                        </button>
                      )}
                      <span className="text-[10px] text-gray-500">
                        {stat.count} période{stat.count > 1 ? 's' : ''}
                        {c.mode !== 'annotation' && stat.count > 0 && <> · <span className="font-mono text-gray-400">{fmtDuration(stat.ms)}</span></>}
                      </span>
                      {/* Voir / Masqué */}
                      <button
                        onClick={(e) => { stop(e); onCategoryUpdate(c.id, { visible: !c.visible }) }}
                        className={`ml-auto text-[9px] px-1.5 py-0.5 rounded border ${c.visible ? 'border-gray-700 text-gray-400 hover:text-gray-200' : 'border-gray-700 text-gray-600'}`}
                        title={c.visible ? 'Masquer les bandes' : 'Afficher les bandes'}
                      >
                        {c.visible ? 'Voir' : 'Masqué'}
                      </button>
                      <button
                        onClick={(e) => { stop(e); removeCategory(c) }}
                        className="text-gray-600 hover:text-red-400"
                        title="Supprimer cette catégorie"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    {/* Mode de contribution au calcul — clic = changer */}
                    <button
                      onClick={(e) => { stop(e); cycleMode(c) }}
                      className="ml-6 text-[9px] text-gray-500 hover:text-gray-300"
                      title="Cliquer pour changer le mode (Inclure → Exclure → Annotation)"
                    >
                      {modeLabel(c)}
                    </button>
                  </div>
                )
              })}
            </div>
            {/* + Nouvelle catégorie */}
            <div className="px-2 py-1 border-t border-gray-800">
              {newCat ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') createCategory(); else if (e.key === 'Escape') setNewCat(false) }}
                    placeholder="Nom"
                    className="flex-1 text-[11px] bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <div className="flex gap-0.5">
                    {PERIOD_PALETTE.map((col) => (
                      <button
                        key={col}
                        onClick={() => setNewCatColor(col)}
                        className={`w-3.5 h-3.5 rounded-full border ${newCatColor === col ? 'border-white scale-110' : 'border-gray-700'}`}
                        style={{ backgroundColor: col }}
                        aria-label={`Couleur ${col}`}
                      />
                    ))}
                  </div>
                  <select
                    value={newCatMode}
                    onChange={(e) => setNewCatMode(e.target.value as CategoryMode)}
                    className="text-[10px] bg-gray-800 text-gray-300 border border-gray-700 rounded px-1 py-0.5 focus:outline-none"
                    title="Mode de contribution au calcul"
                  >
                    <option value="include">Inclure</option>
                    <option value="exclude">Exclure</option>
                    <option value="annotation">Annotation</option>
                  </select>
                  <button onClick={createCategory} className="text-emerald-400 hover:text-emerald-300" title="Créer"><Check size={12} /></button>
                  <button onClick={() => setNewCat(false)} className="text-gray-500 hover:text-gray-300" title="Annuler"><X size={12} /></button>
                </div>
              ) : (
                <button onClick={() => setNewCat(true)} className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300">
                  <Plus size={10} /> Nouvelle catégorie
                </button>
              )}
            </div>
          </div>

          {/* ── Formulaire d'ajout manuel ──────────────────────────────── */}
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

          {/* ── Tableau des périodes ───────────────────────────────────── */}
          {periods.length > 0 && (
            <div className="rounded border border-gray-800">
              <div className="flex items-center gap-2 px-2 py-1 border-b border-gray-800">
                <span className="text-[10px] uppercase tracking-wide text-gray-500">Périodes</span>
                <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
                  className="ml-auto text-[10px] bg-gray-800 text-gray-300 border border-gray-700 rounded px-1 py-0.5 focus:outline-none">
                  <option value="all">Toutes les catégories</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
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
              <div className="px-2 py-1 text-[10px] text-gray-500 border-t border-gray-900">
                {calcSummary.count > 0
                  ? <>Calculé sur les catégories : <span className="text-gray-300">{calcSummary.names.join(', ')}</span> ({calcSummary.count} période{calcSummary.count > 1 ? 's' : ''} · <span className="font-mono text-gray-400">{fmtDuration(calcSummary.totalMs)}</span>)</>
                  : 'Calculé sur l\'ensemble du fichier'}
              </div>
            </div>
          )}

          {periods.length === 0 && (
            <p className="text-[11px] text-gray-500 italic leading-tight">
              Glissez sur le graphique (sans Shift) pour créer une période et l'assigner à une catégorie.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
