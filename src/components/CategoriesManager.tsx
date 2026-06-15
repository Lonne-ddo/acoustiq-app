/**
 * Gestionnaire de catégories de périodes — affiché dans la sidebar.
 *
 * Vue compacte : case (visibilité), pastille couleur, nom (renommer),
 * nombre de périodes, mode de calcul, bouton Voir/Masqué, suppression.
 * Clic sur la ligne → pulse des bandes sur le graphique (CustomEvent).
 */
import { useMemo, useState } from 'react'
import { Plus, Trash2, Check, X } from 'lucide-react'
import type { Period, Category, CategoryMode } from '../types'
import { PERIOD_PALETTE, DEFAULT_CATEGORY_IDS } from '../types'

interface Props {
  categories: Category[]
  periods: Period[]
  onCategoryAdd: (c: Category) => void
  onCategoryUpdate: (id: string, patch: Partial<Category>) => void
  onCategoryRemove: (id: string, reassignTo: string | null) => void
}

function fmtDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  if (h > 0) return `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}`
  if (m > 0) return `${m}m`
  return `${totalSec}s`
}

export default function CategoriesManager({
  categories, periods, onCategoryAdd, onCategoryUpdate, onCategoryRemove,
}: Props) {
  const [catEditId, setCatEditId] = useState<string | null>(null)
  const [catEditName, setCatEditName] = useState('')
  const [colorPickerId, setColorPickerId] = useState<string | null>(null)
  const [newCat, setNewCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatColor, setNewCatColor] = useState<string>(PERIOD_PALETTE[0])
  const [newCatMode, setNewCatMode] = useState<CategoryMode>('include')

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

  function modeLabel(c: Category): string {
    if (c.mode === 'include') return c.id === DEFAULT_CATEGORY_IDS.residuel ? 'Inclus (référence)' : 'Inclus dans le calcul'
    if (c.mode === 'exclude') return 'Exclu du calcul'
    return 'Annotation seulement'
  }
  function cycleMode(c: Category) {
    const next: CategoryMode = c.mode === 'include' ? 'exclude' : c.mode === 'exclude' ? 'annotation' : 'include'
    onCategoryUpdate(c.id, { mode: next })
  }
  function pulseCategory(id: string) {
    document.dispatchEvent(new CustomEvent('acoustiq:pulse-category', { detail: id }))
  }
  function removeCategory(c: Category) {
    const stat = statsByCat.get(c.id)
    if (!stat || stat.count === 0) {
      if (!window.confirm(`Supprimer la catégorie « ${c.name} » ?`)) return
      onCategoryRemove(c.id, null)
      return
    }
    const target = categories.find((o) => o.id !== c.id)
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

  return (
    <div className="space-y-0.5">
      {categories.map((c) => {
        const stat = statsByCat.get(c.id) ?? { count: 0, ms: 0 }
        const stop = (e: React.MouseEvent) => e.stopPropagation()
        return (
          <div
            key={c.id}
            onClick={() => pulseCategory(c.id)}
            className={`rounded px-1 py-1 cursor-pointer hover:bg-gray-800/50 ${c.visible ? '' : 'opacity-55'}`}
            title="Cliquer pour localiser les bandes sur le graphique"
          >
            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={c.visible}
                onClick={stop}
                onChange={(e) => onCategoryUpdate(c.id, { visible: e.target.checked })}
                title="Afficher les bandes et activer dans les calculs"
                className="accent-emerald-500 shrink-0"
              />
              <div className="relative shrink-0" onClick={stop}>
                <button
                  onClick={() => setColorPickerId((v) => (v === c.id ? null : c.id))}
                  className="w-3 h-3 rounded-full border border-black/30 block"
                  style={{ backgroundColor: c.color }}
                  title="Changer la couleur"
                />
                {colorPickerId === c.id && (
                  <div className="absolute z-30 top-4 left-0 flex flex-wrap gap-1 p-1 bg-gray-900 border border-gray-700 rounded shadow-lg w-24">
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
                  className="flex-1 min-w-0 text-[11px] bg-gray-800 text-gray-100 border border-gray-700 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              ) : (
                <button
                  onClick={(e) => { stop(e); setCatEditId(c.id); setCatEditName(c.name) }}
                  className="flex-1 min-w-0 text-left text-[11px] text-gray-200 hover:text-emerald-300 truncate"
                  title="Renommer"
                >
                  {c.name}
                </button>
              )}
              <span className="text-[10px] text-gray-500 shrink-0">
                {stat.count}{c.mode !== 'annotation' && stat.count > 0 ? ` · ${fmtDuration(stat.ms)}` : ''}
              </span>
              <button
                onClick={(e) => { stop(e); onCategoryUpdate(c.id, { visible: !c.visible }) }}
                className={`text-[9px] px-1 py-0.5 rounded border shrink-0 ${c.visible ? 'border-gray-700 text-gray-400 hover:text-gray-200' : 'border-gray-700 text-gray-600'}`}
                title={c.visible ? 'Masquer les bandes' : 'Afficher les bandes'}
              >
                {c.visible ? 'Voir' : 'Masqué'}
              </button>
              <button
                onClick={(e) => { stop(e); removeCategory(c) }}
                className="text-gray-600 hover:text-red-400 shrink-0"
                title="Supprimer cette catégorie"
              >
                <Trash2 size={11} />
              </button>
            </div>
            <button
              onClick={(e) => { stop(e); cycleMode(c) }}
              className="ml-5 text-[9px] text-gray-500 hover:text-gray-300"
              title="Cliquer pour changer le mode (Inclure → Exclure → Annotation)"
            >
              {modeLabel(c)}
            </button>
          </div>
        )
      })}

      {/* + Nouvelle catégorie */}
      <div className="pt-1">
        {newCat ? (
          <div className="flex items-center gap-1 flex-wrap">
            <input
              autoFocus
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createCategory(); else if (e.key === 'Escape') setNewCat(false) }}
              placeholder="Nom"
              className="flex-1 min-w-0 text-[11px] bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
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
            <div className="flex gap-0.5">
              {PERIOD_PALETTE.slice(0, 5).map((col) => (
                <button
                  key={col}
                  onClick={() => setNewCatColor(col)}
                  className={`w-3.5 h-3.5 rounded-full border ${newCatColor === col ? 'border-white scale-110' : 'border-gray-700'}`}
                  style={{ backgroundColor: col }}
                  aria-label={`Couleur ${col}`}
                />
              ))}
            </div>
            <button onClick={createCategory} className="text-emerald-400 hover:text-emerald-300" title="Créer"><Check size={13} /></button>
            <button onClick={() => setNewCat(false)} className="text-gray-500 hover:text-gray-300" title="Annuler"><X size={13} /></button>
          </div>
        ) : (
          <button onClick={() => setNewCat(true)} className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300">
            <Plus size={11} /> Nouvelle catégorie
          </button>
        )}
      </div>
    </div>
  )
}
