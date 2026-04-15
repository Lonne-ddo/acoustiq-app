/**
 * Panneau de gestion des périodes nommées — pilote le filtre des indices.
 *
 * Une période a un statut include/exclude :
 *   - S'il y a ≥ 1 « include », seules les données dans l'union des includes
 *     sont utilisées.
 *   - Les « exclude » retirent systématiquement leurs points.
 *   - Aucune période → calcul sur tout.
 */
import { useMemo, useState } from 'react'
import { ChevronDown, Plus, Trash2, Check, X } from 'lucide-react'
import type { Period } from '../types'

interface Props {
  periods: Period[]
  onAdd: (p: Period) => void
  onUpdate: (id: string, patch: Partial<Period>) => void
  onRemove: (id: string) => void
  selectedDate: string // YYYY-MM-DD — sert d'ancre pour les périodes ajoutées manuellement
}

function fmtHHMMSS(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function fmtDateTime(ms: number): string {
  const d = new Date(ms)
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `${iso} ${fmtHHMMSS(ms)}`
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

export default function PeriodsPanel({ periods, onAdd, onUpdate, onRemove, selectedDate }: Props) {
  const [open, setOpen] = useState(true)
  const [adding, setAdding] = useState(false)
  const [formName, setFormName] = useState('')
  const [formStart, setFormStart] = useState('09:00:00')
  const [formEnd, setFormEnd] = useState('17:00:00')
  const [formStatus, setFormStatus] = useState<'include' | 'exclude'>('include')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const totals = useMemo(() => {
    const includes = periods.filter((p) => p.status === 'include')
    const anchors = includes.length > 0 ? includes : periods.filter((p) => p.status === 'exclude')
    const totalMs = anchors.reduce((sum, p) => sum + Math.max(0, p.endMs - p.startMs), 0)
    return {
      includeCount: includes.length,
      excludeCount: periods.length - includes.length,
      totalMs,
    }
  }, [periods])

  function submitAdd() {
    const start = parseHHMMSS(formStart)
    const end = parseHHMMSS(formEnd)
    if (start === null || end === null || !selectedDate) return
    const base = dateToMsAtMidnight(selectedDate)
    if (!Number.isFinite(base)) return
    let startMs = base + start
    let endMs = base + end
    if (endMs <= startMs) endMs += 24 * 3600 * 1000
    onAdd({
      id: crypto.randomUUID(),
      name: formName.trim() || `Période ${periods.length + 1}`,
      startMs,
      endMs,
      status: formStatus,
    })
    setAdding(false)
    setFormName('')
  }

  function updateBounds(p: Period, field: 'start' | 'end', hhmmss: string) {
    const parsed = parseHHMMSS(hhmmss)
    if (parsed === null) return
    const dayBase = new Date(p.startMs)
    dayBase.setHours(0, 0, 0, 0)
    const newMs = dayBase.getTime() + parsed
    if (field === 'start') {
      onUpdate(p.id, { startMs: newMs })
    } else {
      const endMs = newMs <= p.startMs ? newMs + 24 * 3600 * 1000 : newMs
      onUpdate(p.id, { endMs })
    }
  }

  return (
    <div className="border-t border-gray-800 bg-gray-950/40">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-900/60 transition-colors"
      >
        <ChevronDown
          size={11}
          className={`text-gray-500 transition-transform ${open ? '' : '-rotate-90'}`}
        />
        <span className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">
          Périodes
        </span>
        <span className="text-[10px] text-gray-500">
          {periods.length === 0
            ? 'aucune — calcul sur tout'
            : `${totals.includeCount} incluse${totals.includeCount > 1 ? 's' : ''} · ${totals.excludeCount} exclue${totals.excludeCount > 1 ? 's' : ''}`}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setAdding((v) => !v) }}
          className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-0.5"
        >
          <Plus size={10} />
          Ajouter une période
        </button>
      </button>

      {open && (
        <div className="px-4 pb-3">
          {adding && (
            <div className="mb-2 p-2 rounded border border-gray-700/60 bg-gray-900/70 space-y-2">
              <div className="grid grid-cols-4 gap-2">
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={`Période ${periods.length + 1}`}
                  className="text-[11px] bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <input
                  type="text"
                  value={formStart}
                  onChange={(e) => setFormStart(e.target.value)}
                  placeholder="HH:MM:SS"
                  className="text-[11px] font-mono bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <input
                  type="text"
                  value={formEnd}
                  onChange={(e) => setFormEnd(e.target.value)}
                  placeholder="HH:MM:SS"
                  className="text-[11px] font-mono bg-gray-800 text-gray-100 border border-gray-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <div className="flex gap-1">
                  <button
                    onClick={() => setFormStatus('include')}
                    className={`flex-1 text-[10px] rounded px-1 py-1 border ${
                      formStatus === 'include'
                        ? 'bg-emerald-950/60 border-emerald-600 text-emerald-200'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    Inclure
                  </button>
                  <button
                    onClick={() => setFormStatus('exclude')}
                    className={`flex-1 text-[10px] rounded px-1 py-1 border ${
                      formStatus === 'exclude'
                        ? 'bg-rose-950/60 border-rose-600 text-rose-200'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    Exclure
                  </button>
                </div>
              </div>
              <div className="flex gap-1 justify-end">
                <button
                  onClick={() => setAdding(false)}
                  className="text-[10px] text-gray-400 hover:text-gray-200 bg-gray-800 hover:bg-gray-700 rounded px-2 py-1"
                >
                  Annuler
                </button>
                <button
                  onClick={submitAdd}
                  className="text-[10px] text-white bg-emerald-600 hover:bg-emerald-500 rounded px-2 py-1 flex items-center gap-1"
                >
                  <Check size={10} />
                  Ajouter
                </button>
              </div>
            </div>
          )}

          {periods.length > 0 && (
            <div className="rounded border border-gray-800">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-[10px] text-gray-500 uppercase tracking-wide border-b border-gray-800">
                    <th className="text-left px-2 py-1 font-semibold">Nom</th>
                    <th className="text-left px-2 py-1 font-semibold">Début</th>
                    <th className="text-left px-2 py-1 font-semibold">Fin</th>
                    <th className="text-left px-2 py-1 font-semibold">Durée</th>
                    <th className="text-left px-2 py-1 font-semibold">Statut</th>
                    <th className="text-right px-2 py-1 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p) => {
                    const dur = Math.max(0, p.endMs - p.startMs)
                    const isEditing = editingId === p.id
                    return (
                      <tr key={p.id} className="border-b border-gray-900 last:border-0">
                        <td className="px-2 py-1 text-gray-200">
                          {isEditing ? (
                            <input
                              autoFocus
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onBlur={() => {
                                onUpdate(p.id, { name: editingName.trim() || p.name })
                                setEditingId(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  onUpdate(p.id, { name: editingName.trim() || p.name })
                                  setEditingId(null)
                                } else if (e.key === 'Escape') setEditingId(null)
                              }}
                              className="text-[11px] bg-gray-800 text-gray-100 border border-gray-700 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-full"
                            />
                          ) : (
                            <button
                              onClick={() => { setEditingId(p.id); setEditingName(p.name) }}
                              className="text-left w-full hover:text-emerald-300 truncate"
                              title="Cliquer pour renommer"
                            >
                              {p.name}
                            </button>
                          )}
                        </td>
                        <td className="px-2 py-1 font-mono text-gray-300" title={fmtDateTime(p.startMs)}>
                          <input
                            type="text"
                            defaultValue={fmtHHMMSS(p.startMs)}
                            onBlur={(e) => updateBounds(p, 'start', e.currentTarget.value)}
                            className="text-[11px] font-mono bg-transparent text-gray-200 border border-transparent hover:border-gray-700 focus:border-emerald-500 focus:outline-none rounded px-1 w-[82px]"
                          />
                        </td>
                        <td className="px-2 py-1 font-mono text-gray-300" title={fmtDateTime(p.endMs)}>
                          <input
                            type="text"
                            defaultValue={fmtHHMMSS(p.endMs)}
                            onBlur={(e) => updateBounds(p, 'end', e.currentTarget.value)}
                            className="text-[11px] font-mono bg-transparent text-gray-200 border border-transparent hover:border-gray-700 focus:border-emerald-500 focus:outline-none rounded px-1 w-[82px]"
                          />
                        </td>
                        <td className="px-2 py-1 font-mono text-gray-400">{fmtDuration(dur)}</td>
                        <td className="px-2 py-1">
                          <button
                            onClick={() => onUpdate(p.id, { status: p.status === 'include' ? 'exclude' : 'include' })}
                            className={`text-[10px] rounded px-2 py-0.5 border ${
                              p.status === 'include'
                                ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300 hover:bg-emerald-900/80'
                                : 'bg-rose-950/60 border-rose-700 text-rose-300 hover:bg-rose-900/80 line-through'
                            }`}
                            title="Basculer Inclure / Exclure"
                          >
                            {p.status === 'include' ? 'Inclure' : 'Exclure'}
                          </button>
                        </td>
                        <td className="px-2 py-1 text-right">
                          <button
                            onClick={() => onRemove(p.id)}
                            className="text-gray-600 hover:text-red-400"
                            aria-label="Supprimer la période"
                            title="Supprimer"
                          >
                            <Trash2 size={11} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="px-2 py-1 text-[10px] text-gray-500 border-t border-gray-900 flex items-center gap-2">
                <span>
                  Calculé sur {totals.includeCount > 0 ? `${totals.includeCount} période${totals.includeCount > 1 ? 's' : ''} « Inclure »` : 'tout SAUF les exclusions'}
                  {' — durée totale '}
                  <span className="font-mono text-gray-400">{fmtDuration(totals.totalMs)}</span>
                </span>
              </div>
            </div>
          )}

          {periods.length === 0 && (
            <p className="text-[11px] text-gray-500 italic leading-tight">
              Glissez sur le graphique (sans Shift) pour créer une période, ou utilisez <X size={10} className="inline-block mx-0.5 opacity-0" /><button onClick={() => setAdding(true)} className="underline hover:text-gray-300">+ Ajouter une période</button>.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
