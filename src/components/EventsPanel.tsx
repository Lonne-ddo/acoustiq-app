/**
 * Panneau de gestion des événements de sources sonores
 * Permet d'ajouter des événements horodatés qui s'affichent sur le graphique
 */
import { useState } from 'react'
import { Plus, Trash2, Clock, Sparkles, Check, X } from 'lucide-react'
import type { SourceEvent, CandidateEvent } from '../types'

// Couleurs prédéfinies pour les événements
const PRESET_COLORS = [
  '#f43f5e', // rose
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#a855f7', // purple
]

interface Props {
  events: SourceEvent[]
  availableDates: string[]
  onAdd: (event: SourceEvent) => void
  onRemove: (id: string) => void
  candidates: CandidateEvent[]
  onDetect: () => void
  onConfirmCandidate: (id: string) => void
  onDismissCandidate: (id: string) => void
}

export default function EventsPanel({
  events, availableDates, onAdd, onRemove,
  candidates, onDetect, onConfirmCandidate, onDismissCandidate,
}: Props) {
  const [label, setLabel] = useState('')
  const [time, setTime] = useState('00:00')
  const [day, setDay] = useState(() => availableDates[0] ?? '')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [open, setOpen] = useState(true)

  // Synchronise le jour sélectionné si les dates disponibles changent
  const effectiveDay = availableDates.includes(day) ? day : (availableDates[0] ?? '')

  function handleAdd() {
    if (!label.trim() || !effectiveDay) return
    onAdd({
      id: crypto.randomUUID(),
      label: label.trim(),
      time,
      day: effectiveDay,
      color,
    })
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
            title="Détecte les montées ≥ 6 dB en 60 s sur tous les points assignés"
          >
            <Sparkles size={12} />
            Détecter événements
          </button>

          {candidates.length > 0 && (
            <div className="bg-orange-950/20 border border-orange-900/40 rounded-md p-2 space-y-1">
              <p className="text-xs font-semibold text-orange-300 uppercase tracking-wider">
                Candidats détectés ({candidates.length})
              </p>
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {candidates.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-1.5 bg-gray-900/60 rounded px-2 py-1"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-200 truncate">
                        {c.point} · +{c.delta.toFixed(1)} dB
                      </p>
                      <p className="text-[10px] text-gray-500">
                        {c.day} · {c.time} · {c.laeq.toFixed(1)} dB(A)
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
            </div>
          )}

          {/* Formulaire d'ajout */}
          <div className="space-y-2 bg-gray-800/50 rounded-md p-2">
            {/* Label */}
            <input
              type="text"
              placeholder="Libellé (ex: Passage camion)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded
                         px-2 py-1.5 placeholder:text-gray-600
                         focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />

            {/* Heure + Jour */}
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

            {/* Bouton ajouter */}
            <button
              onClick={handleAdd}
              disabled={!label.trim() || !effectiveDay}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded
                         bg-gray-700 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed
                         text-xs font-medium text-gray-200 transition-colors"
            >
              <Plus size={12} />
              Ajouter l'événement
            </button>
          </div>

          {/* Liste des événements */}
          {events.length === 0 ? (
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
                  {/* Pastille colorée */}
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: ev.color }}
                  />
                  {/* Infos */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-200 truncate">{ev.label}</p>
                    <p className="text-xs text-gray-500">
                      {ev.day} · {ev.time}
                    </p>
                  </div>
                  {/* Supprimer */}
                  <button
                    onClick={() => onRemove(ev.id)}
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
