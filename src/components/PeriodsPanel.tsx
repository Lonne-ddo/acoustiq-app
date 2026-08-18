/**
 * Panneau « Périodes » — tableau compact des périodes définies sur le graphique.
 *
 * Les catégories (création, visibilité, mode de calcul) sont gérées dans la
 * sidebar (CategoriesManager). Ce panneau ne fait qu'afficher / éditer les
 * périodes et leur assignation de catégorie.
 *
 * Édition : le nom, l'heure de début et l'heure de fin sont modifiables en
 * place (clic → champ, Entrée valide, Échap annule). La durée n'est jamais
 * saisie, elle se déduit des bornes. Les bornes gardent leur jour civil —
 * voir utils/periodEdit.
 */
import { Fragment, useMemo, useRef, useState } from 'react'
import { ChevronDown, Plus, Trash2, Check, AlertTriangle, CalendarPlus } from 'lucide-react'
import type { Period, Category } from '../types'
import {
  validatePeriodEdit,
  applyTimeChange,
  parseHHMMSS,
  shiftToNextDay,
  fmtDayMonth,
  dateToMsAtMidnight,
  sameCivilDay,
  type MeasureRange,
} from '../utils/periodEdit'

interface Props {
  periods: Period[]
  onAdd: (p: Period) => void
  onUpdate: (id: string, patch: Partial<Period>) => void
  onRemove: (id: string) => void
  categories: Category[]
  selectedDate: string // YYYY-MM-DD — ancre pour les périodes ajoutées manuellement
  /** Plage couverte par les fichiers de mesure du jour. Omise → aucun
   *  avertissement de hors-plage (comportement d'avant cette fonctionnalité). */
  measureRange?: MeasureRange | null
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

type BoundField = 'start' | 'end'

export default function PeriodsPanel({ periods, onAdd, onUpdate, onRemove, categories, selectedDate, measureRange }: Props) {
  const [open, setOpen] = useState(true)
  const [adding, setAdding] = useState(false)
  const [formName, setFormName] = useState('')
  const [formStart, setFormStart] = useState('09:00:00')
  const [formEnd, setFormEnd] = useState('17:00:00')
  const [formCat, setFormCat] = useState<string>('')
  const [formNotes, setFormNotes] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingBound, setEditingBound] = useState<{ id: string; field: BoundField } | null>(null)
  const [boundDraft, setBoundDraft] = useState('')
  /** Message de refus affiché sous la ligne en cours d'édition. */
  const [rowError, setRowError] = useState<{ id: string; msg: string } | null>(null)
  const [filterCat, setFilterCat] = useState<string>('all')

  /** Échap démonte l'input ; ce drapeau garantit que le onBlur qui suit ne
   *  valide pas la saisie abandonnée. Sans lui, T6 dépendrait du fait qu'un
   *  navigateur n'émet pas `blur` sur un élément retiré du DOM — vrai
   *  aujourd'hui, mais jamais garanti. */
  const skipBlurRef = useRef(false)

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const visiblePeriods = useMemo(
    () => (filterCat === 'all' ? periods : periods.filter((p) => p.categoryId === filterCat)),
    [periods, filterCat],
  )

  /** Contrôle permanent de chaque période — les avertissements ne sont pas
   *  réservés au moment de l'édition. Une période hors plage doit se signaler
   *  d'elle-même, y compris si elle a été créée par glisser sur le graphique. */
  const checks = useMemo(
    () =>
      new Map(
        periods.map((p) => [
          p.id,
          validatePeriodEdit({ name: p.name, startMs: p.startMs, endMs: p.endMs }, measureRange),
        ]),
      ),
    [periods, measureRange],
  )

  /** Minuit du jour affiché — référence pour décider si une borne appartient
   *  à un autre jour et doit donc porter sa date visible. */
  const selectedDayMs = useMemo(() => dateToMsAtMidnight(selectedDate), [selectedDate])

  const defaultAddCat = categories.find((c) => c.visible && c.mode === 'include')?.id ?? categories[0]?.id ?? ''

  /** Jour de la fin si le formulaire d'ajout va reporter la borne au lendemain.
   *  Rend visible le +24 h que submitAdd applique — même calcul, à l'identique. */
  const addWrapDay = useMemo(() => {
    const s = parseHHMMSS(formStart)
    const e = parseHHMMSS(formEnd)
    if (s === null || e === null || !selectedDate) return null
    const base = dateToMsAtMidnight(selectedDate)
    if (!Number.isFinite(base)) return null
    if (base + e > base + s) return null
    return fmtDayMonth(base + e + 24 * 3600 * 1000)
  }, [formStart, formEnd, selectedDate])

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

  // ── Édition du nom ────────────────────────────────────────────────────────
  function startEditName(p: Period) {
    setEditingBound(null)
    setRowError(null)
    setEditingId(p.id)
    setEditingName(p.name)
  }

  /** @returns vrai si la modification a été acceptée. */
  function commitName(p: Period): boolean {
    const v = validatePeriodEdit(
      { name: editingName, startMs: p.startMs, endMs: p.endMs },
      measureRange,
    )
    if (!v.ok) {
      // Refus explicite. On NE rétablit PAS l'ancien nom en silence : le champ
      // reste ouvert avec la saisie fautive et le motif s'affiche.
      setRowError({ id: p.id, msg: v.errors.join(' ') })
      return false
    }
    onUpdate(p.id, { name: editingName.trim() })
    setEditingId(null)
    setRowError(null)
    return true
  }

  function cancelEdit() {
    skipBlurRef.current = true
    setEditingId(null)
    setEditingBound(null)
    setRowError(null)
  }

  // ── Édition des bornes ────────────────────────────────────────────────────
  function startEditBound(p: Period, field: BoundField) {
    setEditingId(null)
    setRowError(null)
    setEditingBound({ id: p.id, field })
    setBoundDraft(fmtHHMMSS(field === 'start' ? p.startMs : p.endMs))
  }

  function commitBound(p: Period, field: BoundField): boolean {
    const originalMs = field === 'start' ? p.startMs : p.endMs
    const nextMs = applyTimeChange(originalMs, boundDraft)
    if (nextMs === null) {
      setRowError({ id: p.id, msg: 'Heure illisible — format attendu HH:MM ou HH:MM:SS.' })
      return false
    }
    const draft = field === 'start'
      ? { name: p.name, startMs: nextMs, endMs: p.endMs }
      : { name: p.name, startMs: p.startMs, endMs: nextMs }
    const v = validatePeriodEdit(draft, measureRange)
    if (!v.ok) {
      setRowError({ id: p.id, msg: v.errors.join(' ') })
      return false
    }
    // Les avertissements (bornes inversées, hors plage) n'empêchent jamais
    // l'écriture : ils s'affichent ensuite sous la ligne, en permanence.
    onUpdate(p.id, field === 'start' ? { startMs: nextMs } : { endMs: nextMs })
    setEditingBound(null)
    setRowError(null)
    return true
  }

  const boundInputClass =
    'text-[11px] font-mono bg-gray-800 text-gray-100 border border-gray-700 rounded px-1 py-0.5 w-[9ch] focus:outline-none focus:ring-1 focus:ring-emerald-500'

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
              {/* Le report au lendemain était appliqué sans rien dire. Il reste
                  le comportement, mais annoncé avant la validation. */}
              {addWrapDay && (
                <p className="flex items-center gap-1.5 text-[10px] text-amber-300">
                  <AlertTriangle size={10} className="shrink-0" />
                  La fin étant antérieure au début, elle sera reportée au lendemain ({addWrapDay}).
                </p>
              )}
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
                    const check = checks.get(p.id)
                    const err = rowError?.id === p.id ? rowError.msg : null
                    const hasMessages = !!err || (check?.warnings.length ?? 0) > 0
                    const editingStart = editingBound?.id === p.id && editingBound.field === 'start'
                    const editingEnd = editingBound?.id === p.id && editingBound.field === 'end'
                    // Une borne qui n'appartient pas au jour affiché porte sa
                    // date, à l'œil. Le tableau alimente un calcul réglementaire :
                    // aucune information ne doit dépendre d'un survol.
                    const dayKnown = Number.isFinite(selectedDayMs)
                    const startOffDay = dayKnown && !sameCivilDay(p.startMs, selectedDayMs)
                    const endOffDay = dayKnown && !sameCivilDay(p.endMs, selectedDayMs)
                    // Ambre seulement si la période est réellement hors plage :
                    // une fin au lendemain (Lnuit) est normale, pas une alerte.
                    const dayChipClass = check?.outsideMeasureRange ? 'text-amber-400' : 'text-gray-500'
                    return (
                      <Fragment key={p.id}>
                      <tr className={hasMessages ? '' : 'border-b border-gray-900 last:border-0'}>
                        <td className="px-2 py-1 text-gray-200">
                          {isEditing ? (
                            <input
                              autoFocus value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onBlur={() => {
                                if (skipBlurRef.current) { skipBlurRef.current = false; return }
                                commitName(p)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { if (commitName(p)) e.currentTarget.blur() }
                                else if (e.key === 'Escape') cancelEdit()
                              }}
                              className={`text-[11px] bg-gray-800 text-gray-100 border rounded px-1 py-0.5 focus:outline-none focus:ring-1 w-full ${
                                err ? 'border-rose-600 focus:ring-rose-500' : 'border-gray-700 focus:ring-emerald-500'
                              }`}
                            />
                          ) : (
                            <button onClick={() => startEditName(p)} className="text-left w-full hover:text-emerald-300 truncate" title={p.notes || 'Renommer'}>
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
                        <td className="px-2 py-1 font-mono text-gray-300">
                          <span className="inline-flex items-baseline gap-1">
                            {editingStart ? (
                              <input
                                autoFocus value={boundDraft}
                                onChange={(e) => setBoundDraft(e.target.value)}
                                onBlur={() => {
                                  if (skipBlurRef.current) { skipBlurRef.current = false; return }
                                  commitBound(p, 'start')
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { if (commitBound(p, 'start')) e.currentTarget.blur() }
                                  else if (e.key === 'Escape') cancelEdit()
                                }}
                                className={boundInputClass}
                              />
                            ) : (
                              <button
                                onClick={() => startEditBound(p, 'start')}
                                className="text-left hover:text-emerald-300"
                                title={`Modifier l'heure de début (${fmtDayMonth(p.startMs)})`}
                              >
                                {fmtHHMMSS(p.startMs)}
                              </button>
                            )}
                            {startOffDay && (
                              <span
                                className={`text-[9px] shrink-0 ${dayChipClass}`}
                                title={`Cette borne est le ${fmtDayMonth(p.startMs)}, pas le jour affiché`}
                              >
                                {fmtDayMonth(p.startMs)}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-2 py-1 font-mono text-gray-300">
                          <span className="inline-flex items-baseline gap-1">
                            {editingEnd ? (
                              <input
                                autoFocus value={boundDraft}
                                onChange={(e) => setBoundDraft(e.target.value)}
                                onBlur={() => {
                                  if (skipBlurRef.current) { skipBlurRef.current = false; return }
                                  commitBound(p, 'end')
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { if (commitBound(p, 'end')) e.currentTarget.blur() }
                                  else if (e.key === 'Escape') cancelEdit()
                                }}
                                className={boundInputClass}
                              />
                            ) : (
                              <button
                                onClick={() => startEditBound(p, 'end')}
                                className="text-left hover:text-emerald-300"
                                title={`Modifier l'heure de fin (${fmtDayMonth(p.endMs)})`}
                              >
                                {fmtHHMMSS(p.endMs)}
                              </button>
                            )}
                            {endOffDay && (
                              <span
                                className={`text-[9px] shrink-0 ${dayChipClass}`}
                                title={`Cette borne est le ${fmtDayMonth(p.endMs)}, pas le jour affiché`}
                              >
                                {fmtDayMonth(p.endMs)}
                              </span>
                            )}
                          </span>
                        </td>
                        {/* Durée : toujours déduite des bornes, jamais saisie. */}
                        <td className="px-2 py-1 font-mono text-gray-400">{fmtDuration(dur)}</td>
                        <td className="px-2 py-1 text-right">
                          <button onClick={() => onRemove(p.id)} className="text-gray-600 hover:text-red-400" title="Supprimer"><Trash2 size={11} /></button>
                        </td>
                      </tr>
                      {/* Messages de la ligne. Les erreurs sont transitoires
                          (le temps de corriger la saisie) ; les avertissements
                          sont permanents — une période hors plage doit se
                          signaler en continu, pas seulement pendant l'édition. */}
                      {hasMessages && (
                        <tr className="border-b border-gray-900 last:border-0">
                          <td colSpan={6} className="px-2 pb-1.5 pt-0">
                            {err && (
                              <p className="flex items-start gap-1.5 text-[10px] text-rose-300">
                                <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                                <span className="flex-1 min-w-0 break-words">{err}</span>
                              </p>
                            )}
                            {(check?.warnings ?? []).map((w, i) => (
                              <p key={i} className="flex items-start gap-1.5 text-[10px] text-amber-300/90">
                                <AlertTriangle size={10} className="mt-0.5 shrink-0" />
                                <span className="flex-1 min-w-0 break-words">{w}</span>
                              </p>
                            ))}
                            {check?.endBeforeStart && (
                              <button
                                onClick={() => onUpdate(p.id, { endMs: shiftToNextDay(p.endMs) })}
                                className="mt-1 inline-flex items-center gap-1 text-[10px] text-amber-200 bg-gray-800 hover:bg-gray-700 border border-amber-800/60 rounded px-1.5 py-0.5"
                                title={`Reporter la fin au ${fmtDayMonth(shiftToNextDay(p.endMs))}`}
                              >
                                <CalendarPlus size={10} />
                                Reporter la fin au lendemain ({fmtDayMonth(shiftToNextDay(p.endMs))})
                              </button>
                            )}
                          </td>
                        </tr>
                      )}
                      </Fragment>
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
