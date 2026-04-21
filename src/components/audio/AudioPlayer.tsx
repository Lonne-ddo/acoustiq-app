/**
 * Lecteur audio flottant en mode streaming — propulsé par un HTMLAudioElement
 * partagé via useAudioSync. Conçu pour les MP3/M4A/OGG de plusieurs
 * centaines de Mo : aucun decodeAudioData, la mémoire reste plate.
 *
 * Affichage : panneau sous le graphique LAeq, collapsible, visible
 * uniquement quand une entrée audio est associée au point actif.
 */
import { Play, Pause, Square, Volume2, Gauge, ChevronDown, ChevronUp } from 'lucide-react'
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

interface Props {
  /** Entrées audio disponibles pour le point actif, triées chronologiquement */
  entries: AudioFileEntry[]
  sync: UseAudioSyncResult
  pointName: string | null
  defaultCollapsed?: boolean
}

export default function AudioPlayer({ entries, sync, pointName, defaultCollapsed = false }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const active = entries.find((e) => e.id === sync.activeEntryId) ?? null
  const currentSec = active && sync.currentMin !== null
    ? Math.max(0, (sync.currentMin - active.startMin) * 60)
    : 0
  const totalSec = active?.durationSec ?? 0

  function handlePlayPause() {
    if (!active) {
      // Rien n'est chargé → lancer la première entrée du point
      const first = entries[0]
      if (first) sync.playAt(first.id, first.startMin)
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
        <span className="text-[10px] text-gray-500">
          {pointName ? `${pointName} · ` : ''}{entries.length} fichier{entries.length > 1 ? 's' : ''}
          {active && (
            <> · <span className="font-mono text-gray-400">{active.name}</span></>
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

          {/* Liste des fichiers audio — permet de basculer rapidement */}
          {entries.length > 1 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {entries.map((e) => (
                <button
                  key={e.id}
                  onClick={() => sync.playAt(e.id, e.startMin)}
                  className={`text-[10px] rounded px-1.5 py-0.5 border transition-colors ${
                    sync.activeEntryId === e.id
                      ? 'bg-blue-950/60 border-blue-600 text-blue-200'
                      : 'bg-gray-900 border-gray-700 text-gray-400 hover:text-gray-200'
                  }`}
                  title={`${e.name} · ${fmtSec(e.durationSec)}`}
                >
                  {e.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
