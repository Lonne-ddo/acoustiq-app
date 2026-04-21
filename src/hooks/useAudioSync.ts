/**
 * useAudioSync — centralise la lecture audio en mode streaming via un
 * HTMLAudioElement unique, partagé entre le graphique LAeq (curseur de
 * lecture, double-clic pour écouter), le panneau Événements (bouton ▶)
 * et le lecteur flottant.
 *
 * Principes :
 *   - Un seul `<audio>` partagé : quand on change de fichier actif, on
 *     réutilise l'élément (src = blobUrl), ce qui évite de recréer des
 *     décodeurs et garde la mémoire basse.
 *   - Position exposée en "minutes depuis minuit du jour de référence"
 *     pour faciliter la synchro avec l'axe X du chart.
 *   - En mode multi-jours continu, on accepte l'ancre = dateIndex × 1440
 *     + min-sur-la-journée ; l'appelant est libre de fournir un offset.
 *   - Ne charge rien au montage : l'AudioContext n'est jamais créé, seul
 *     l'HTMLAudioElement est utilisé pour le streaming.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioFileEntry } from '../types'

export interface AudioCoverageRange {
  entryId: string
  startMin: number
  endMin: number
  date: string
}

export interface UseAudioSyncResult {
  activeEntryId: string | null
  playing: boolean
  /** Position courante en minutes depuis minuit du jour de l'entrée active */
  currentMin: number | null
  volume: number
  speed: 1 | 1.5 | 2 | 4
  /** Démarre la lecture d'une entrée à une position donnée (minutes depuis minuit).
   *  Si l'entrée est déjà active, on se contente de seek+play. */
  playAt: (entryId: string, minutesSinceMidnight: number) => void
  togglePlayPause: () => void
  pause: () => void
  stop: () => void
  seekMin: (m: number) => void
  setVolume: (v: number) => void
  setSpeed: (s: 1 | 1.5 | 2 | 4) => void
  /** Élément audio sous-jacent — exposé pour attacher des listeners (ex : fin, erreur) */
  audioEl: HTMLAudioElement | null
}

/**
 * Retourne les plages de couverture audio pour un set de fichiers (tri chrono).
 * Chaque plage est exprimée sur l'axe X absolu du chart (minutes) — si
 * `dayIndexOf` est fourni, on utilise dayIndexOf(entry.date)·1440 comme offset
 * pour le mode multi-jours.
 */
export function computeAudioCoverage(
  entries: AudioFileEntry[],
  dayIndexOf?: (d: string) => number,
): AudioCoverageRange[] {
  return entries
    .map((e) => {
      const offset = dayIndexOf ? dayIndexOf(e.date) * 1440 : 0
      return {
        entryId: e.id,
        startMin: offset + e.startMin,
        endMin: offset + e.startMin + e.durationSec / 60,
        date: e.date,
      }
    })
    .sort((a, b) => a.startMin - b.startMin)
}

/**
 * Vrai si le temps `t` (en minutes axe X chart) tombe dans une plage audio.
 * Retourne la première plage correspondante ou null.
 */
export function findCoveringRange(
  ranges: AudioCoverageRange[],
  tMin: number,
): AudioCoverageRange | null {
  for (const r of ranges) {
    if (tMin >= r.startMin && tMin < r.endMin) return r
  }
  return null
}

export function useAudioSync(entries: AudioFileEntry[]): UseAudioSyncResult {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentMin, setCurrentMin] = useState<number | null>(null)
  const [volume, setVolumeState] = useState(1)
  const [speed, setSpeedState] = useState<1 | 1.5 | 2 | 4>(1)

  // Init lazy : on crée l'élément <audio> la première fois qu'on a besoin
  // d'écouter. Pas d'allocation au simple montage du hook.
  const ensureAudioEl = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current
    const el = new Audio()
    el.preload = 'metadata'
    el.volume = volume
    el.playbackRate = speed
    audioRef.current = el
    el.addEventListener('play', () => setPlaying(true))
    el.addEventListener('pause', () => setPlaying(false))
    el.addEventListener('ended', () => setPlaying(false))
    el.addEventListener('timeupdate', () => {
      const active = audioRef.current
      if (!active) return
      // currentMin est dérivé en minutes depuis minuit = startMin (entrée) + el.currentTime/60
      const entryId = (active as HTMLAudioElement & { _entryId?: string })._entryId
      if (!entryId) return
      // Remonter via le dataset set dans playAt (mutable marker)
      const baseMin = (active as HTMLAudioElement & { _startMin?: number })._startMin
      if (typeof baseMin !== 'number') return
      setCurrentMin(baseMin + active.currentTime / 60)
    })
    return el
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Nettoyage au démontage
  useEffect(() => {
    return () => {
      const el = audioRef.current
      if (el) {
        el.pause()
        el.src = ''
      }
    }
  }, [])

  const playAt = useCallback(
    (entryId: string, minutesSinceMidnight: number) => {
      const entry = entries.find((e) => e.id === entryId)
      if (!entry) return
      const el = ensureAudioEl()
      const offsetSec = Math.max(0, (minutesSinceMidnight - entry.startMin) * 60)

      // Si c'est une autre entrée, on recharge la source
      const wasThisEntry =
        (el as HTMLAudioElement & { _entryId?: string })._entryId === entryId
      if (!wasThisEntry) {
        el.pause()
        el.src = entry.blobUrl
        ;(el as HTMLAudioElement & { _entryId?: string })._entryId = entryId
        setActiveEntryId(entryId)
      }
      ;(el as HTMLAudioElement & { _startMin?: number })._startMin = entry.startMin

      // Chrome exige que la source soit chargée avant seek
      const seekAndPlay = () => {
        try {
          el.currentTime = Math.min(offsetSec, entry.durationSec - 0.05)
        } catch { /* ignore */ }
        const maybePromise = el.play()
        if (maybePromise && typeof maybePromise.catch === 'function') {
          maybePromise.catch(() => { /* l'utilisateur peut réessayer */ })
        }
      }
      if (el.readyState >= 1 /* HAVE_METADATA */) {
        seekAndPlay()
      } else {
        el.addEventListener('loadedmetadata', seekAndPlay, { once: true })
      }
    },
    [entries, ensureAudioEl],
  )

  const togglePlayPause = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) el.play().catch(() => { /* ignore */ })
    else el.pause()
  }, [])

  const pause = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  const stop = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    el.pause()
    try { el.currentTime = 0 } catch { /* ignore */ }
    setCurrentMin(null)
  }, [])

  const seekMin = useCallback((m: number) => {
    const el = audioRef.current
    const entryId = el
      ? (el as HTMLAudioElement & { _entryId?: string })._entryId
      : null
    if (!el || !entryId) return
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) return
    const offsetSec = Math.max(0, Math.min(entry.durationSec - 0.05, (m - entry.startMin) * 60))
    try { el.currentTime = offsetSec } catch { /* ignore */ }
  }, [entries])

  const setVolume = useCallback((v: number) => {
    const nv = Math.max(0, Math.min(1, v))
    setVolumeState(nv)
    if (audioRef.current) audioRef.current.volume = nv
  }, [])

  const setSpeed = useCallback((s: 1 | 1.5 | 2 | 4) => {
    setSpeedState(s)
    if (audioRef.current) audioRef.current.playbackRate = s
  }, [])

  return {
    activeEntryId,
    playing,
    currentMin,
    volume,
    speed,
    playAt,
    togglePlayPause,
    pause,
    stop,
    seekMin,
    setVolume,
    setSpeed,
    audioEl: audioRef.current,
  }
}
