/**
 * Lecteur audio flottant en mode streaming — propulsé par un HTMLAudioElement
 * partagé via useAudioSync. Conçu pour les MP3/M4A/OGG de plusieurs
 * centaines de Mo : aucun decodeAudioData, la mémoire reste plate.
 *
 * Affichage : panneau sous le graphique LAeq, collapsible, visible
 * uniquement quand une entrée audio est associée au point actif.
 */
import { Play, Pause, Square, Volume2, VolumeX, Gauge, ChevronDown, ChevronUp, Clock, AlertTriangle, MapPin, Sliders, HelpCircle, Loader2, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioFileEntry } from '../../types'
import type { UseAudioSyncResult } from '../../hooks/useAudioSync'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import AudioWaveform from './AudioWaveform'
import AudioFeedbackToast, { type AudioToast } from './AudioFeedbackToast'
import AudioShortcutsHelp from './AudioShortcutsHelp'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Hauteur par défaut du panneau (spec : 140 px) + bornes du redimensionnement. */
const AUDIO_HEIGHT_DEFAULT = 140
const AUDIO_HEIGHT_MIN = 80
const AUDIO_HEIGHT_MAX = 500
const AUDIO_HEIGHT_KEY = 'acoustiq_audio_panel_height'
/** Seuil au-dessus duquel on affiche la forme d'onde + timeline détaillée. */
const EXPANDED_THRESHOLD = 200

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
  if (s === 'uncertain') return { color: 'bg-orange-500', label: 'Date estimée non fiable — à vérifier' }
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

  // Hauteur du panneau — spec : 140 px par défaut, 80–500 px, persistée
  // en localStorage pour survivre aux rechargements.
  const [height, setHeight] = useState<number>(() => {
    try {
      const v = localStorage.getItem(AUDIO_HEIGHT_KEY)
      if (v) {
        const n = parseInt(v, 10)
        if (Number.isFinite(n)) return Math.max(AUDIO_HEIGHT_MIN, Math.min(AUDIO_HEIGHT_MAX, n))
      }
    } catch { /* ignore */ }
    return AUDIO_HEIGHT_DEFAULT
  })
  useEffect(() => {
    try { localStorage.setItem(AUDIO_HEIGHT_KEY, String(height)) } catch { /* ignore */ }
  }, [height])

  const resizeRef = useRef<{ startY: number; startH: number } | null>(null)
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { startY: e.clientY, startH: height }
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return
      // Glisser vers le haut (clientY diminue) → agrandit le panneau
      const deltaY = ev.clientY - resizeRef.current.startY
      const newH = resizeRef.current.startH - deltaY
      setHeight(Math.max(AUDIO_HEIGHT_MIN, Math.min(AUDIO_HEIGHT_MAX, newH)))
    }
    const onUp = () => {
      resizeRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [height])

  const active = entries.find((e) => e.id === sync.activeEntryId) ?? null
  const currentSec = active && sync.currentMin !== null
    ? Math.max(0, (sync.currentMin - active.startMin) * 60)
    : 0
  const totalSec = active?.durationSec ?? 0
  const expanded = !collapsed && height >= EXPANDED_THRESHOLD

  // ─────────────────────────────────────────────────────────────────────
  // Toast de feedback des raccourcis (transitoire ~600 ms)
  // ─────────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<AudioToast | null>(null)
  const toastIdRef = useRef(0)
  const toastTimerRef = useRef<number | null>(null)
  const showToast = useCallback((icon: string, label: string) => {
    toastIdRef.current += 1
    setToast({ id: toastIdRef.current, icon, label })
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 650)
  }, [])
  useEffect(() => () => { if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current) }, [])

  // Modale d'aide (icône ? ou touche ?)
  const [helpOpen, setHelpOpen] = useState(false)

  // Volume mémorisé avant un mute, pour restaurer au démute.
  const prevVolumeRef = useRef(sync.volume || 1)

  // ─── État de buffer / chargement (item 5D) ───
  const [bufferedFrac, setBufferedFrac] = useState(0)
  const [buffering, setBuffering] = useState(false)
  useEffect(() => {
    const el = sync.audioEl
    if (!el) return
    const refreshBuffer = () => {
      try {
        const dur = el.duration || totalSec
        if (!Number.isFinite(dur) || dur <= 0) { setBufferedFrac(0); return }
        const b = el.buffered
        const ct = el.currentTime
        let end = 0
        for (let i = 0; i < b.length; i++) {
          if (ct >= b.start(i) - 0.25 && ct <= b.end(i) + 0.25) { end = b.end(i); break }
          end = Math.max(end, b.end(i))
        }
        setBufferedFrac(clamp(end / dur, 0, 1))
      } catch { /* ignore */ }
    }
    const onWaiting = () => setBuffering(true)
    const onResume = () => { setBuffering(false); refreshBuffer() }
    el.addEventListener('progress', refreshBuffer)
    el.addEventListener('timeupdate', refreshBuffer)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('stalled', onWaiting)
    el.addEventListener('playing', onResume)
    el.addEventListener('canplay', onResume)
    el.addEventListener('loadeddata', refreshBuffer)
    refreshBuffer()
    return () => {
      el.removeEventListener('progress', refreshBuffer)
      el.removeEventListener('timeupdate', refreshBuffer)
      el.removeEventListener('waiting', onWaiting)
      el.removeEventListener('stalled', onWaiting)
      el.removeEventListener('playing', onResume)
      el.removeEventListener('canplay', onResume)
      el.removeEventListener('loadeddata', refreshBuffer)
    }
  }, [sync.audioEl, sync.activeEntryId, totalSec])

  // ─── Helpers de contrôle pilotés par les raccourcis ───
  /** Saute à une position absolue (secondes depuis le début du fichier actif). */
  const seekToSec = useCallback((sec: number) => {
    if (!active) return
    sync.seekMin(active.startMin + clamp(sec, 0, totalSec) / 60)
  }, [active, totalSec, sync])

  const adjustVolume = useCallback((delta: number) => {
    const nv = clamp(sync.volume + delta, 0, 1)
    sync.setVolume(nv)
    if (nv > 0) prevVolumeRef.current = nv
    showToast(nv === 0 ? '🔇' : nv < 0.5 ? '🔈' : '🔊', `${Math.round(nv * 100)}%`)
  }, [sync, showToast])

  const toggleMute = useCallback(() => {
    if (sync.volume > 0) {
      prevVolumeRef.current = sync.volume
      sync.setVolume(0)
      showToast('🔇', 'Muet')
    } else {
      const restore = prevVolumeRef.current || 1
      sync.setVolume(restore)
      showToast('🔊', `${Math.round(restore * 100)}%`)
    }
  }, [sync, showToast])

  const cycleSpeed = useCallback((dir: 1 | -1) => {
    const i = SPEEDS.indexOf(sync.speed)
    const ns = SPEEDS[(i + dir + SPEEDS.length) % SPEEDS.length]
    sync.setSpeed(ns)
    showToast('⏩', `${ns}×`)
  }, [sync, showToast])

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

  /** Recule de 5 s et relance la lecture si en pause (raccourci R). */
  const replay5 = useCallback(() => {
    if (!active) return
    seekToSec(currentSec - 5)
    if (!sync.playing) sync.togglePlayPause()
    showToast('⏪', 'Replay 5s')
  }, [active, currentSec, sync, seekToSec, showToast])

  // ─── Barre de progression cliquable / glissable + survol ───
  const progressRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const [hoverFrac, setHoverFrac] = useState<number | null>(null)
  const fracAt = (clientX: number): number => {
    const el = progressRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return clamp((clientX - r.left) / r.width, 0, 1)
  }
  const onBarMouseDown = (e: React.MouseEvent) => {
    if (!active) return
    e.preventDefault()
    draggingRef.current = true
    const apply = (clientX: number) => {
      const f = fracAt(clientX)
      setHoverFrac(f)
      seekToSec(totalSec * f)
    }
    apply(e.clientX)
    const move = (ev: MouseEvent) => apply(ev.clientX)
    const up = () => {
      draggingRef.current = false
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
  const onBarMouseMove = (e: React.MouseEvent) => {
    if (draggingRef.current) return
    setHoverFrac(fracAt(e.clientX))
  }
  const onBarMouseLeave = () => { if (!draggingRef.current) setHoverFrac(null) }

  // ─────────────────────────────────────────────────────────────────────
  // Raccourcis clavier (item 1). Capture sur window : on consomme la touche
  // (preventDefault + stopImmediatePropagation) quand on la traite, ce qui
  // empêche le handler global d'App.tsx (pan/zoom du graphique) d'y réagir.
  // Les raccourcis hors lecture/pause/aide ne sont actifs qu'avec un fichier
  // actif → sinon les flèches continuent de piloter le graphique.
  // ─────────────────────────────────────────────────────────────────────
  useKeyboardShortcuts((ev) => {
    const lower = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key

    // Aide — toujours disponible (touche ? = Maj+/)
    if (ev.key === '?') { setHelpOpen((v) => !v); return true }

    // Lecture / Pause — toujours (démarre le 1er fichier si rien d'actif)
    if (ev.key === ' ' || lower === 'k') {
      showToast('⏯', sync.playing ? 'Pause' : 'Lecture')
      handlePlayPause()
      return true
    }

    // Les raccourcis ci-dessous nécessitent un fichier actif.
    if (!active) return false

    switch (ev.key) {
      case 'ArrowLeft':
        seekToSec(currentSec + (ev.shift ? -30 : ev.mod ? -60 : -5))
        showToast('⏪', ev.shift ? '-30s' : ev.mod ? '-1min' : '-5s')
        return true
      case 'ArrowRight':
        seekToSec(currentSec + (ev.shift ? 30 : ev.mod ? 60 : 5))
        showToast('⏩', ev.shift ? '+30s' : ev.mod ? '+1min' : '+5s')
        return true
      case 'ArrowUp': adjustVolume(0.1); return true
      case 'ArrowDown': adjustVolume(-0.1); return true
      case 'Home': seekToSec(0); showToast('⏮', 'Début'); return true
      case 'End': seekToSec(totalSec); showToast('⏭', 'Fin'); return true
      case '>': cycleSpeed(1); return true
      case '<': cycleSpeed(-1); return true
    }
    switch (lower) {
      case 'j': seekToSec(currentSec - 10); showToast('⏪', '-10s'); return true
      case 'l': seekToSec(currentSec + 10); showToast('⏩', '+10s'); return true
      case 'm': toggleMute(); return true
      case 'n': onOpenCalage(active.id); showToast('📍', 'Marqueur'); return true
      case 'r': replay5(); return true
    }
    // Chiffres 0–9 → 0 % … 90 % de la durée
    if (ev.key >= '0' && ev.key <= '9' && !ev.mod && !ev.shift && !ev.alt) {
      const d = Number(ev.key)
      seekToSec(totalSec * (d / 10))
      showToast('⏱', `${d * 10}%`)
      return true
    }
    return false
  }, { enabled: entries.length > 0 })

  if (entries.length === 0) return null

  return (
    <div
      className="relative border-t border-gray-800 bg-gray-950/70 flex flex-col"
      style={collapsed ? undefined : { height }}
    >
      {/* Toast transitoire des raccourcis — flotte au centre-bas du graphique */}
      <AudioFeedbackToast toast={toast} />
      {/* Poignée de redimensionnement (3 px, cursor ns-resize).
          Masquée quand le panneau est replié (la hauteur est alors dictée
          par le seul en-tête cliquable). */}
      {!collapsed && (
        <div
          onMouseDown={handleResizeStart}
          className="shrink-0 cursor-ns-resize group"
          style={{ height: 3, backgroundColor: 'rgba(107, 114, 128, 0.3)' }}
          title="Glisser pour redimensionner le panneau audio"
        >
          <div
            className="w-full h-full group-hover:opacity-100 opacity-0 transition-opacity"
            style={{ backgroundColor: 'rgba(107, 114, 128, 0.6)' }}
          />
        </div>
      )}

      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-gray-900/60 transition-colors shrink-0"
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
        <div className="px-4 pb-3 space-y-2 flex-1 min-h-0 overflow-hidden flex flex-col">
          {/* Barre de progression — cliquable, glissable, avec aperçu au survol
              et indicateur de buffer (zone décodée) sous la progression. */}
          <div className="relative pt-1">
            <div
              ref={progressRef}
              className="group relative w-full h-2.5 rounded bg-gray-800 cursor-pointer overflow-hidden"
              onMouseDown={onBarMouseDown}
              onMouseMove={onBarMouseMove}
              onMouseLeave={onBarMouseLeave}
              title="Cliquer ou glisser pour aller à un instant"
            >
              {/* Buffer décodé */}
              <div
                className="pointer-events-none absolute top-0 bottom-0 bg-gray-600/50"
                style={{ width: `${bufferedFrac * 100}%` }}
              />
              {/* Progression lue */}
              <div
                className="pointer-events-none absolute top-0 bottom-0 bg-blue-500/70"
                style={{ width: totalSec > 0 ? `${(currentSec / totalSec) * 100}%` : 0 }}
              />
              {/* Marqueur (thumb) */}
              <div
                className="pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-400 shadow opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: totalSec > 0 ? `${(currentSec / totalSec) * 100}%` : 0, width: 10, height: 10 }}
              />
            </div>
            {/* Aperçu de l'heure au survol */}
            {hoverFrac !== null && totalSec > 0 && (
              <div
                className="pointer-events-none absolute -top-5 z-10 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-mono text-white tabular-nums whitespace-nowrap"
                style={{ left: `${hoverFrac * 100}%` }}
              >
                {fmtSec(totalSec * hoverFrac)}
              </div>
            )}
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
            <button
              onClick={replay5}
              disabled={!active}
              className="flex items-center gap-1 p-1.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-600 disabled:opacity-40"
              title="Revenir 5 s en arrière et relire (R)"
            >
              <RotateCcw size={11} />
              <span className="text-[10px]">5s</span>
            </button>

            <span className="flex items-center gap-1 text-[11px] text-gray-400 tabular-nums font-mono min-w-[104px]">
              {fmtSec(currentSec)} / {fmtSec(totalSec)}
              {buffering && <Loader2 size={11} className="animate-spin text-blue-400" />}
            </span>

            <div className="flex items-center gap-1">
              <button
                onClick={toggleMute}
                className="text-gray-500 hover:text-gray-300"
                title={sync.volume === 0 ? 'Réactiver le son (M)' : 'Couper le son (M)'}
                aria-label="Muet"
              >
                {sync.volume === 0 ? <VolumeX size={12} /> : <Volume2 size={11} />}
              </button>
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

            {/* Vitesse de lecture (poussé à droite) */}
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

            {/* ⏱ Caler — TOUJOURS visible. Si aucun fichier actif (lecture
                jamais lancée), on cale par défaut le 1er fichier de la liste. */}
            <button
              onClick={() => {
                const target = active ?? entries[0]
                if (target) onOpenCalage(target.id)
              }}
              className="flex items-center gap-1 text-[11px] text-amber-300 hover:text-amber-200 bg-gray-900 hover:bg-gray-800 border border-amber-700/60 rounded px-2 py-1"
              title="Caler ce fichier sur la courbe LAeq"
            >
              <Clock size={12} />
              Caler
            </button>

            {/* Aide raccourcis clavier */}
            <button
              onClick={() => setHelpOpen(true)}
              className="p-1.5 rounded bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700 border border-gray-600"
              title="Raccourcis clavier (?)"
              aria-label="Afficher les raccourcis clavier"
            >
              <HelpCircle size={13} />
            </button>
          </div>

          {/* Mode étendu : waveform + timeline + actions supplémentaires.
              Uniquement quand le panneau dépasse EXPANDED_THRESHOLD (200 px). */}
          {expanded && active && (
            <div className="flex-1 min-h-0 flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    // "Marquer ici" : ouvre le calage en mode pointage, avec
                    // l'instant courant déjà placé en tant que marqueur audio.
                    if (active) onOpenCalage(active.id)
                  }}
                  className="flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1"
                  title="Placer un marqueur à l'instant courant (ouvre le calage)"
                >
                  <MapPin size={11} />
                  Marquer ici
                </button>
                <button
                  className="flex items-center gap-1 text-[11px] text-gray-500 bg-gray-900 border border-gray-800 rounded px-2 py-1 cursor-not-allowed"
                  title="Égaliseur audio (à venir)"
                  disabled
                >
                  <Sliders size={11} />
                  Égaliseur
                </button>
                <span className="ml-auto text-[10px] text-gray-500 truncate">
                  Forme d'onde — cliquer pour aller à un instant
                </span>
              </div>
              <div className="flex-1 min-h-0">
                <AudioWaveform
                  key={active.id}
                  entry={active}
                  sync={sync}
                  height={Math.max(60, height - 150)}
                />
              </div>
            </div>
          )}

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

      {/* Modale d'aide des raccourcis clavier (icône ? ou touche ?) */}
      <AudioShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
