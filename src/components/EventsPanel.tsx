/**
 * Panneau « Événements » — détection automatique + liste compacte.
 *
 * La création manuelle d'événements / annotations a été retirée : elle est
 * obsolète depuis le système de catégories (création par cliquer-glisser sur
 * la courbe). Ce panneau ne fait plus que :
 *   - lancer la détection automatique (bouton + ⚙ paramètres repliables) ;
 *   - lister les candidats détectés (confirmer / rejeter) ;
 *   - lister les événements confirmés (écouter / supprimer).
 */
import { useState } from 'react'
import { Trash2, Clock, Sparkles, Check, X, Play, Settings as SettingsIcon } from 'lucide-react'
import type { SourceEvent, CandidateEvent } from '../types'
import type { AudioCoverageRange } from '../hooks/useAudioSync'
import { findCoveringRange } from '../hooks/useAudioSync'

export interface DetectParams {
  emergenceDb: number
  minDurationSec: number
  mergeGapSec: number
}

interface Props {
  events: SourceEvent[]
  availableDates: string[]
  onRemove: (id: string) => void
  candidates: CandidateEvent[]
  onDetect: () => void
  onConfirmCandidate: (id: string) => void
  onDismissCandidate: (id: string) => void
  detectParams: DetectParams
  onDetectParamsChange: (p: DetectParams) => void
  /** Plages de couverture audio pour activer le bouton ▶ sur les événements */
  audioCoverage?: AudioCoverageRange[]
  /** Index des jours pour le mapping multi-jours (ev.day → offset minutes) */
  dayIndexOf?: (d: string) => number
  onAudioPlayAt?: (entryId: string, minutes: number) => void
}

const MAX_CANDIDATES_DISPLAYED = 50

function formatDurationCandidate(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s === 0 ? `${m}min` : `${m}min${s}s`
}

export default function EventsPanel({
  events, availableDates, onRemove,
  candidates, onDetect, onConfirmCandidate, onDismissCandidate,
  detectParams, onDetectParamsChange,
  audioCoverage, dayIndexOf, onAudioPlayAt,
}: Props) {
  const [open, setOpen] = useState(true)
  // Sliders de détection masqués par défaut (déployables via le bouton ⚙)
  const [showDetectParams, setShowDetectParams] = useState(false)

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
          {/* Détection automatique : bouton principal + ⚙ Paramètres (replié) */}
          <div className="flex gap-1">
            <button
              onClick={onDetect}
              disabled={availableDates.length === 0}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded
                         bg-orange-900/40 hover:bg-orange-900/60 disabled:opacity-30
                         border border-orange-800/60 text-xs font-medium text-orange-300
                         transition-colors"
              title="Détecte les émergences ≥ seuil dB sur le bruit de fond local (60 s)"
            >
              <Sparkles size={12} />
              Détecter automatiquement
            </button>
            <button
              onClick={() => setShowDetectParams((v) => !v)}
              className={`px-2 py-1.5 rounded border text-xs transition-colors ${
                showDetectParams
                  ? 'bg-orange-900/60 border-orange-700 text-orange-200'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
              }`}
              title="Paramètres de détection (seuil, durée, fusion)"
              aria-label="Paramètres de détection"
              aria-expanded={showDetectParams}
            >
              <SettingsIcon size={11} />
            </button>
          </div>

          {/* Paramètres configurables (déployés à la demande) */}
          {showDetectParams && (
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
          )}

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

          {/* Liste compacte des événements confirmés */}
          {events.length === 0 ? (
            <div className="text-center text-gray-600 text-xs py-3">
              <Clock size={20} className="mx-auto mb-1 opacity-40" />
              Aucun événement — utilisez « Détecter automatiquement »
            </div>
          ) : (
            <ul className="space-y-1">
              {events.map((ev) => {
                // Minute absolue sur l'axe X chart pour tester la couverture audio
                const [hStr = '0', mStr = '0'] = ev.time.split(':')
                const evMin = parseInt(hStr, 10) * 60 + parseInt(mStr, 10)
                const offset = dayIndexOf ? dayIndexOf(ev.day) * 1440 : 0
                const audioRange = audioCoverage
                  ? findCoveringRange(audioCoverage, offset + evMin)
                  : null
                return (
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
                    {audioRange && onAudioPlayAt && (
                      <button
                        onClick={() => onAudioPlayAt(
                          audioRange.entryId,
                          Math.max(audioRange.startMin, offset + evMin - 5 / 60),
                        )}
                        className="shrink-0 p-1 rounded text-blue-400 hover:text-blue-300 hover:bg-blue-950/40"
                        title="Écouter l'audio (−5 s) à cet événement"
                        aria-label="Écouter"
                      >
                        <Play size={12} />
                      </button>
                    )}
                    <button
                      onClick={() => onRemove(ev.id)}
                      className="text-gray-600 hover:text-red-400 shrink-0 transition-colors"
                      title="Supprimer"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
