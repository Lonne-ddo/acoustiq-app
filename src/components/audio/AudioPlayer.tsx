/**
 * Lecteur audio flottant en mode streaming — propulsé par un HTMLAudioElement
 * partagé via useAudioSync. Conçu pour les MP3/M4A/OGG de plusieurs
 * centaines de Mo : aucun decodeAudioData, la mémoire reste plate.
 *
 * Affichage : panneau sous le graphique LAeq, collapsible, visible
 * uniquement quand une entrée audio est associée au point actif.
 */
import { Play, Pause, Square, Volume2, Gauge, ChevronDown, ChevronUp, Clock, AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import type { AudioFileEntry } from '../../types'
import type { UseAudioSyncResult } from '../../hooks/useAudioSync'

const SPEEDS: Array<1 | 1.5 | 2 | 4> = [1, 1.5, 2, 4]

function fmtSec(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '--:--'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function statusDot(s: AudioFileEntry['caleStatus']): { color: string; label: string } {
  if (s === 'calibrated') return { color: 'bg-emerald-500', label: 'Calé' }
  if (s === 'date_only') return { color: 'bg-amber-400', label: 'Date estimée, non calé' }
  return { color: 'bg-rose-500', label: 'Non calé' }
}

interface Props {
  /** Entrées audio disponibles pour le point actif, triées chronologiquement */
  entries: AudioFileEntry[]
  sync: UseAudioSyncResult
  pointName: string | null
  defaultCollapsed?: boolean
  /** Ouvre le panneau de calage pour un fichier donné */
  onOpenCalage: (entryId: string) => void
}

export default function AudioPlayer({ entries, sync, pointName, defaultCollapsed = false, onOpenCalage }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  // Modal de confirmation quand on essaie de lire un fichier non calé.
  const [warnUncaled, setWarnUncaled] = useState<AudioFileEntry | null>(null)

  const active = entries.find((e) => e.id === sync.activeEntryId) ?? null
  const currentSec = active && sync.currentMin !== null
    ? Math.max(0, (sync.currentMin - active.startMin) * 60)
    : 0
  const totalSec = active?.durationSec ?? 0

  /** Tente de jouer une entrée, ouvre le warning si pas calée. */
  function playOrWarn(e: AudioFileEntry) {
    if (e.caleStatus === 'none') {
      setWarnUncaled(e)
      return
    }
    sync.playAt(e.id, e.startMin)
  }

  function handlePlayPause() {
    if (!active) {
      const first = entries[0]
      if (first) playOrWarn(first)
      return
    }
    sync.togglePlayPause()
  }

  function handleSeekClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!active) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const seekMin = active.startMin + (active.durationSec / 60) * frac
    sync.seekMin(seekMin)
  }

  if (entries.length === 0) return null

  return (
    <div className="border-t border-gray-800 bg-gray-950/70">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-900/60 transition-colors"
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronUp size={11} className="text-gray-500" /> : <ChevronDown size={11} className="text-gray-500" />}
        <Volume2 size={12} className="text-blue-400" />
        <span className="text-[11px] font-semibold text-gray-300 uppercase tracking-wider">Audio</span>
        <span className="text-[10px] text-gray-500 truncate">
          {pointName ? `${pointName} · ` : ''}{entries.length} fichier{entries.length > 1 ? 's' : ''}
          {active && (
            <> · <span className={`inline-block w-1.5 h-1.5 rounded-full align-middle mx-1 ${statusDot(active.caleStatus).color}`} /><span className="font-mono text-gray-400">{active.name}</span></>
          )}
        </span>
        {sync.playing && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Lecture
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="px-4 pb-3 space-y-2">
          {/* Barre de progression */}
          <div
            className="relative w-full h-2 rounded bg-gray-800 cursor-pointer overflow-hidden"
            onClick={handleSeekClick}
            title="Cliquer pour aller à un instant"
          >
            <div
              className="absolute top-0 bottom-0 bg-blue-500/70"
              style={{ width: totalSec > 0 ? `${(currentSec / totalSec) * 100}%` : 0 }}
            />
            <div
              className="pointer-events-none absolute top-0 bottom-0"
              style={{
                left: totalSec > 0 ? `${(currentSec / totalSec) * 100}%` : 0,
                width: 2,
                backgroundColor: '#3b82f6',
              }}
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {sync.playing ? (
              <button
                onClick={handlePlayPause}
                className="p-1.5 rounded bg-gray-800 text-gray-200 hover:bg-gray-700 border border-gray-600"
                title="Pause"
              >
                <Pause size={13} />
              </button>
            ) : (
              <button
                onClick={handlePlayPause}
                disabled={!active && entries.length === 0}
                className="p-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
                title="Lecture"
              >
                <Play size={13} />
              </button>
            )}
            <button
              onClick={sync.stop}
              className="p-1.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-600"
              title="Arrêter"
            >
              <Square size={11} />
            </button>

            <span className="text-[11px] text-gray-400 tabular-nums font-mono min-w-[96px]">
              {fmtSec(currentSec)} / {fmtSec(totalSec)}
            </span>

            {/* Caler le fichier actif (raccourci global) */}
            {active && (
              <button
                onClick={() => onOpenCalage(active.id)}
                className="flex items-center gap-1 text-[11px] text-amber-300 hover:text-amber-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1"
                title="Caler ce fichier sur la courbe LAeq"
              >
                <Clock size={11} />
                Caler
              </button>
            )}

            <div className="flex items-center gap-1">
              <Volume2 size={11} className="text-gray-500" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={sync.volume}
                onChange={(e) => sync.setVolume(Number(e.target.value))}
                className="w-20 accent-blue-500"
                aria-label="Volume"
              />
            </div>

            <div className="flex items-center gap-1 ml-auto">
              <Gauge size={11} className="text-gray-500" />
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => sync.setSpeed(s)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    sync.speed === s
                      ? 'bg-blue-600 border-blue-400 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>

          {/* Liste des fichiers audio — bascule rapide + indicateur ●  + bouton ⏱ par onglet */}
          {entries.length > 1 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {entries.map((e) => {
                const dot = statusDot(e.caleStatus)
                const isActive = sync.activeEntryId === e.id
                return (
                  <div
                    key={e.id}
                    className={`flex items-stretch rounded border overflow-hidden transition-colors ${
                      isActive
                        ? 'bg-blue-950/60 border-blue-600'
                        : 'bg-gray-900 border-gray-700'
                    }`}
                    title={`${e.name} · ${fmtSec(e.durationSec)} · ${dot.label}`}
                  >
                    <button
                      onClick={() => playOrWarn(e)}
                      className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 transition-colors ${
                        isActive ? 'text-blue-200' : 'text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${dot.color}`} />
                      {e.name}
                    </button>
                    <button
                      onClick={() => onOpenCalage(e.id)}
                      className="flex items-center px-1 border-l border-gray-700/70 text-[10px] text-amber-400 hover:text-amber-200 hover:bg-gray-800/60"
                      title="Caler ce fichier"
                      aria-label={`Caler ${e.name}`}
                    >
                      <Clock size={9} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal d'avertissement : tentative de lecture d'un fichier non calé */}
      {warnUncaled && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setWarnUncaled(null)}
        >
          <div
            className="w-[420px] max-w-[88vw] bg-gray-900 border border-rose-700/60 rounded-lg shadow-2xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-gray-100 font-semibold">Fichier non calé</p>
                <p className="mt-1 text-[11px] text-gray-400 leading-snug">
                  <span className="font-mono text-gray-300">{warnUncaled.name}</span> n'est
                  pas encore calé avec la courbe LAeq. Le début est forcé à 00:00, donc
                  l'écoute ne sera pas synchronisée avec le bon instant. Caler maintenant ?
                </p>
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  // Lire quand même (sync à 00:00, hors phase)
                  const e = warnUncaled
                  setWarnUncaled(null)
                  sync.playAt(e.id, e.startMin)
                }}
                className="text-[11px] text-gray-300 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded px-3 py-1.5"
              >
                Lire quand même
              </button>
              <button
                onClick={() => {
                  const id = warnUncaled.id
                  setWarnUncaled(null)
                  onOpenCalage(id)
                }}
                className="text-[11px] text-white bg-amber-600 hover:bg-amber-500 rounded px-3 py-1.5 flex items-center gap-1"
              >
                <Clock size={11} />
                Caler maintenant
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
