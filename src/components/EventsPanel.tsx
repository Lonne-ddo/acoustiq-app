/**
 * Panneau de gestion des événements de sources sonores
 * Permet d'ajouter des événements horodatés qui s'affichent sur le graphique
 */
import { useState } from 'react'
import { Plus, Trash2, Clock, Sparkles, Check, X, MessageSquare, MousePointerClick } from 'lucide-react'
import type { SourceEvent, CandidateEvent, ChartAnnotation } from '../types'

// Couleurs prédéfinies pour les événements
const PRESET_COLORS = [
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#a855f7', // purple
]

export interface DetectParams {
  emergenceDb: number
  minDurationSec: number
  mergeGapSec: number
}

interface Props {
  events: SourceEvent[]
  availableDates: string[]
  onAdd: (event: SourceEvent) => void
  onRemove: (id: string) => void
  candidates: CandidateEvent[]
  onDetect: () => void
  onConfirmCandidate: (id: string) => void
  onDismissCandidate: (id: string) => void
  annotations: ChartAnnotation[]
  onAnnotationAdd: (a: ChartAnnotation) => void
  onAnnotationRemove: (id: string) => void
  onAnnotationUpdate: (id: string, text: string) => void
  pendingAnnotationText: string | null
  onPendingAnnotationChange: (text: string | null) => void
  detectParams: DetectParams
  onDetectParamsChange: (p: DetectParams) => void
}

const MAX_CANDIDATES_DISPLAYED = 50

function formatDurationCandidate(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s === 0 ? `${m}min` : `${m}min${s}s`
}

export default function EventsPanel({
  events, availableDates, onAdd, onRemove,
  candidates, onDetect, onConfirmCandidate, onDismissCandidate,
  annotations, onAnnotationAdd, onAnnotationRemove, onAnnotationUpdate,
  pendingAnnotationText, onPendingAnnotationChange,
  detectParams, onDetectParamsChange,
}: Props) {
  const [label, setLabel] = useState('')
  const [time, setTime] = useState('00:00')
  const [day, setDay] = useState(() => availableDates[0] ?? '')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [open, setOpen] = useState(true)
  const [type, setType] = useState<'event' | 'annotation'>('event')
  const [annLevel, setAnnLevel] = useState('60')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  // Synchronise le jour sélectionné si les dates disponibles changent
  const effectiveDay = availableDates.includes(day) ? day : (availableDates[0] ?? '')

  function handleAdd() {
    if (!label.trim() || !effectiveDay) return
    if (type === 'event') {
      onAdd({
        id: crypto.randomUUID(),
        label: label.trim(),
        time,
        day: effectiveDay,
        color,
      })
    } else {
      const lv = parseFloat(annLevel.replace(',', '.'))
      onAnnotationAdd({
        id: crypto.randomUUID(),
        text: label.trim(),
        time,
        day: effectiveDay,
        laeq: Number.isFinite(lv) ? lv : 60,
        color,
      })
    }
    setLabel('')
  }

  function handlePlaceOnChart() {
    if (!label.trim()) return
    onPendingAnnotationChange(label.trim())
    setLabel('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleAdd()
  }

  return (
    <div className="border-t border-gray-700">
      {/* En-tête collapsible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left
                   hover:bg-gray-800 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Événements ({events.length})
        </span>
        <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Détection automatique */}
          <button
            onClick={onDetect}
            disabled={availableDates.length === 0}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded
                       bg-orange-900/40 hover:bg-orange-900/60 disabled:opacity-30
                       border border-orange-800/60 text-xs font-medium text-orange-300
                       transition-colors"
            title="Détecte les émergences ≥ seuil dB sur le bruit de fond local (60 s)"
          >
            <Sparkles size={12} />
            Détecter événements
          </button>

          {/* Paramètres configurables */}
          <div className="bg-gray-800/40 border border-gray-700/50 rounded-md p-2 space-y-1.5">
            <div>
              <div className="flex items-center justify-between text-[10px] text-gray-400">
                <span>Seuil d'émergence</span>
                <span className="text-orange-300 font-mono">{detectParams.emergenceDb} dB</span>
              </div>
              <input
                type="range"
                min={3}
                max={15}
                step={1}
                value={detectParams.emergenceDb}
                onChange={(e) => onDetectParamsChange({ ...detectParams, emergenceDb: Number(e.target.value) })}
                className="w-full accent-orange-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between text-[10px] text-gray-400">
                <span>Durée minimale</span>
                <span className="text-orange-300 font-mono">{detectParams.minDurationSec} s</span>
              </div>
              <input
                type="range"
                min={5}
                max={60}
                step={1}
                value={detectParams.minDurationSec}
                onChange={(e) => onDetectParamsChange({ ...detectParams, minDurationSec: Number(e.target.value) })}
                className="w-full accent-orange-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between text-[10px] text-gray-400">
                <span>Fusion si écart &lt;</span>
                <span className="text-orange-300 font-mono">{detectParams.mergeGapSec} s</span>
              </div>
              <input
                type="range"
                min={10}
                max={120}
                step={5}
                value={detectParams.mergeGapSec}
                onChange={(e) => onDetectParamsChange({ ...detectParams, mergeGapSec: Number(e.target.value) })}
                className="w-full accent-orange-500"
              />
            </div>
          </div>

          {candidates.length > 0 && (
            <div className="bg-orange-950/20 border border-orange-900/40 rounded-md p-2 space-y-1">
              <p className="text-xs font-semibold text-orange-300 uppercase tracking-wider">
                Candidats détectés ({candidates.length})
              </p>
              <ul className="space-y-1 max-h-72 overflow-y-auto">
                {candidates.slice(0, MAX_CANDIDATES_DISPLAYED).map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-1.5 bg-gray-900/60 rounded px-2 py-1"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-200 truncate">
                        {c.point} · {c.time}{c.endTime ? `→${c.endTime}` : ''} · +{c.delta.toFixed(1)} dB · {c.laeq.toFixed(1)} dB(A){c.durationSec ? ` · ${formatDurationCandidate(c.durationSec)}` : ''}
                      </p>
                      <p className="text-[10px] text-gray-500">
                        {c.day}{c.lafmax ? ` · LAFmax ${c.lafmax.toFixed(1)} dB(A)` : ''}{c.baseline ? ` · fond ${c.baseline.toFixed(1)} dB(A)` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => onConfirmCandidate(c.id)}
                      className="p-1 rounded text-emerald-400 hover:text-emerald-300 hover:bg-gray-800"
                      title="Confirmer comme événement"
                    >
                      <Check size={12} />
                    </button>
                    <button
                      onClick={() => onDismissCandidate(c.id)}
                      className="p-1 rounded text-gray-600 hover:text-rose-400 hover:bg-gray-800"
                      title="Rejeter"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              {candidates.length > MAX_CANDIDATES_DISPLAYED && (
                <p className="text-[10px] text-gray-500 italic pt-1 border-t border-orange-900/30">
                  et {candidates.length - MAX_CANDIDATES_DISPLAYED} autres événements moins significatifs
                </p>
              )}
            </div>
          )}

          {/* Formulaire d'ajout */}
          <div className="space-y-2 bg-gray-800/50 rounded-md p-2">
            {/* Type tabs */}
            <div className="flex gap-1">
              <button
                onClick={() => setType('event')}
                className={`flex-1 text-[10px] uppercase tracking-wider font-semibold py-1 rounded transition-colors ${
                  type === 'event'
                    ? 'bg-gray-700 text-emerald-300'
                    : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                }`}
              >
                Événement
              </button>
              <button
                onClick={() => setType('annotation')}
                className={`flex-1 text-[10px] uppercase tracking-wider font-semibold py-1 rounded transition-colors ${
                  type === 'annotation'
                    ? 'bg-gray-700 text-emerald-300'
                    : 'bg-gray-800 text-gray-500 hover:text-gray-300'
                }`}
              >
                Annotation
              </button>
            </div>

            {pendingAnnotationText && (
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-300 bg-emerald-950/40
                              border border-emerald-800/50 rounded px-2 py-1">
                <MousePointerClick size={10} />
                <span className="flex-1 truncate">Cliquez sur le graphique pour placer « {pendingAnnotationText} »</span>
                <button
                  onClick={() => onPendingAnnotationChange(null)}
                  className="text-emerald-400 hover:text-emerald-200"
                >
                  <X size={10} />
                </button>
              </div>
            )}

            {/* Label */}
            <input
              type="text"
              placeholder={type === 'event' ? 'Libellé (ex: Passage camion)' : 'Texte de l\'annotation'}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                         px-2 py-1.5 placeholder:text-gray-600
                         focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />

            {/* Heure + Jour (et niveau dB pour annotation) */}
            <div className="flex gap-2">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="flex-1 text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                           px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              {availableDates.length > 0 ? (
                <select
                  value={effectiveDay}
                  onChange={(e) => setDay(e.target.value)}
                  className="flex-1 text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                             px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  {availableDates.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              ) : (
                <div className="flex-1 text-xs text-gray-600 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded">
                  Aucune date
                </div>
              )}
            </div>

            {type === 'annotation' && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Niveau</label>
                <input
                  type="number"
                  step="0.1"
                  value={annLevel}
                  onChange={(e) => setAnnLevel(e.target.value)}
                  className="flex-1 text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                             px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <span className="text-xs text-gray-500">dB(A)</span>
              </div>
            )}

            {/* Couleur : nuancier + input libre */}
            <div className="flex items-center gap-2">
              <div className="flex gap-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? '#fff' : 'transparent',
                    }}
                    title={c}
                  />
                ))}
              </div>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0"
                title="Couleur personnalisée"
              />
            </div>

            {/* Boutons d'ajout */}
            <div className="flex gap-1">
              <button
                onClick={handleAdd}
                disabled={!label.trim() || !effectiveDay}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded
                           bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed
                           text-xs font-medium text-gray-200 transition-colors"
              >
                <Plus size={12} />
                {type === 'event' ? 'Ajouter l\'événement' : 'Ajouter l\'annotation'}
              </button>
              {type === 'annotation' && (
                <button
                  onClick={handlePlaceOnChart}
                  disabled={!label.trim()}
                  className="flex items-center justify-center gap-1 px-2 py-1.5 rounded
                             bg-emerald-800/40 hover:bg-emerald-800/60 border border-emerald-800/60
                             disabled:opacity-30 text-xs font-medium text-emerald-300 transition-colors"
                  title="Place l'annotation à l'endroit du prochain clic sur le graphique"
                >
                  <MousePointerClick size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Liste des événements */}
          {events.length === 0 && annotations.length === 0 ? (
            <div className="text-center text-gray-600 text-xs py-3">
              <Clock size={20} className="mx-auto mb-1 opacity-40" />
              Aucun événement
            </div>
          ) : (
            <ul className="space-y-1">
              {events.map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1.5"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: ev.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-200 truncate">{ev.label}</p>
                    <p className="text-xs text-gray-500">
                      {ev.day} · {ev.time}
                    </p>
                  </div>
                  <button
                    onClick={() => onRemove(ev.id)}
                    className="text-gray-600 hover:text-red-400 shrink-0 transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
              {annotations.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1.5"
                >
                  <MessageSquare size={11} className="shrink-0" style={{ color: a.color ?? '#9ca3af' }} />
                  <div className="flex-1 min-w-0">
                    {editingId === a.id ? (
                      <input
                        autoFocus
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onAnnotationUpdate(a.id, editingText.trim() || a.text)
                            setEditingId(null)
                          } else if (e.key === 'Escape') {
                            setEditingId(null)
                          }
                        }}
                        onBlur={() => {
                          onAnnotationUpdate(a.id, editingText.trim() || a.text)
                          setEditingId(null)
                        }}
                        className="w-full text-xs bg-gray-900 text-gray-100 border border-gray-600 rounded
                                   px-1 py-0 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    ) : (
                      <p
                        className="text-xs text-gray-200 truncate cursor-text"
                        onDoubleClick={() => { setEditingId(a.id); setEditingText(a.text) }}
                        title="Double-clic pour éditer"
                      >
                        {a.text}
                      </p>
                    )}
                    <p className="text-xs text-gray-500">
                      {a.day} · {a.time} · {a.laeq.toFixed(1)} dB
                    </p>
                  </div>
                  <button
                    onClick={() => onAnnotationRemove(a.id)}
                    className="text-gray-600 hover:text-red-400 shrink-0 transition-colors"
                    title="Supprimer"
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
