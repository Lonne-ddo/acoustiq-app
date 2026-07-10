/**
 * Lecteur audio flottant en mode streaming — propulsé par un HTMLAudioElement
 * partagé via useAudioSync. Conçu pour les MP3/M4A/OGG de plusieurs
 * centaines de Mo : aucun decodeAudioData, la mémoire reste plate.
 *
 * Affichage : panneau sous le graphique LAeq, collapsible, visible
 * uniquement quand une entrée audio est associée au point actif.
 */
import { Play, Pause, Square, Volume2, VolumeX, Gauge, ChevronDown, ChevronUp, Clock, AlertTriangle, MapPin, Sliders, HelpCircle, Loader2, RotateCcw, Music, Plus } from 'lucide-react'
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

/** Durée totale lisible : « 11h 07m » / « 7m 12s » / « 0s ». */
function fmtDurationLong(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return '0s'
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = Math.floor(totalSec % 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/** Taille lisible : « 1.5 GB » / « 612 MB ». */
function fmtSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Minutes-depuis-minuit → heure d'horloge « HH:MM:SS » (= ancre = instant
 *  de la courbe LAeq qui correspond à la position 0 de l'audio). */
function minToClock(m: number): string {
  const totalSec = Math.max(0, Math.round(m * 60))
  return `${pad2(Math.floor(totalSec / 3600) % 24)}:${pad2(Math.floor((totalSec % 3600) / 60))}:${pad2(totalSec % 60)}`
}

/** Parse une heure d'horloge « HH:MM » / « HH:MM:SS » → minutes depuis minuit,
 *  ou null si invalide. */
function parseClock(v: string): number | null {
  const m = v.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const h = +m[1], mi = +m[2], s = m[3] ? +m[3] : 0
  if (h > 23 || mi > 59 || s > 59) return null
  return h * 60 + mi + s / 60
}

const AUDIO_RE = /\.(mp3|wav|m4a|ogg|flac)$/i
const BIG_FILE_BYTES = 500 * 1024 * 1024
/** Vrai si l'événement de drag transporte des fichiers (et pas du texte/HTML). */
function dragHasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
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
  /** Applique une ancre saisie inline (heure d'horloge du début de l'audio).
   *  Même chemin que le calage du modal → caleStatus passe à "calibrated". */
  onApplyCalage?: (entryId: string, patch: { startMin: number; date: string }) => void
  /** Importe de nouveaux fichiers audio (probe + ajout au state). Async. */
  onAddFiles?: (files: File[]) => void | Promise<void>
  /** Compteur incrémental : à chaque changement de valeur, la zone clignote
   *  (utilisé par le drag-and-drop global de la page Visualisation). */
  flashSignal?: number
  /** Hauteur du panneau pilotée par le parent (redimensionnement à somme
   *  nulle géré au niveau App). Si défini, la poignée interne est masquée et
   *  c'est le parent qui persiste la hauteur. */
  controlledHeight?: number
}

export default function AudioPlayer({ entries, sync, pointName, defaultCollapsed = false, onOpenCalage, onApplyCalage, onAddFiles, flashSignal, controlledHeight }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  // Édition inline de l'ancre (heure d'horloge du début de l'audio).
  const [editAnchor, setEditAnchor] = useState(false)
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
    // En mode contrôlé, c'est le parent (App) qui possède et persiste la
    // hauteur — on n'écrit pas la clé pour ne pas la concurrencer.
    if (controlledHeight !== undefined) return
    try { localStorage.setItem(AUDIO_HEIGHT_KEY, String(height)) } catch { /* ignore */ }
  }, [height, controlledHeight])

  /** Hauteur effective : pilotée par le parent si fournie, sinon état interne. */
  const panelHeight = controlledHeight ?? height

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
  const expanded = !collapsed && panelHeight >= EXPANDED_THRESHOLD

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

  // Cible de navigation : le fichier actif, ou à défaut le 1er chargé. Permet
  // aux flèches de naviguer dès qu'un fichier est CHARGÉ (pas forcément joué).
  const targetEntry = active ?? entries[0] ?? null
  const targetTotalSec = targetEntry?.durationSec ?? 0

  /** Applique l'ancre saisie inline : `v` est l'heure d'horloge (HH:MM:SS)
   *  à laquelle correspond la position 0 de l'audio. On garde la date du
   *  fichier et on délègue au même chemin de calage que le modal. */
  const applyAnchor = useCallback((entry: AudioFileEntry, v: string) => {
    setEditAnchor(false)
    const startMin = parseClock(v)
    if (startMin === null || !onApplyCalage) return
    onApplyCalage(entry.id, { startMin, date: entry.date })
    showToast('🕑', minToClock(startMin))
  }, [onApplyCalage, showToast])

  // ─── Helpers de contrôle pilotés par les raccourcis ───
  /** Saute à une position absolue (secondes depuis le début du fichier cible).
   *  Si aucun fichier n'est encore actif, on charge + positionne le curseur
   *  sans démarrer la lecture (prepareAt). */
  const seekToSec = useCallback((sec: number) => {
    if (!targetEntry) return
    const min = targetEntry.startMin + clamp(sec, 0, targetEntry.durationSec) / 60
    if (active) sync.seekMin(min)
    else sync.prepareAt(targetEntry.id, min)
  }, [active, targetEntry, sync])

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

  // ─────────────────────────────────────────────────────────────────────
  // Import de fichiers audio (zone de téléversement permanente)
  // ─────────────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [importing, setImporting] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [flash, setFlash] = useState(false)
  // Avertissement « gros fichier » (> 500 Mo) — persistant tant qu'un tel
  // fichier reste chargé ; informatif, ne bloque pas l'import.
  const [bigFileNote, setBigFileNote] = useState<string | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const triggerFlash = useCallback(() => {
    setFlash(true)
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => setFlash(false), 700)
  }, [])
  useEffect(() => () => { if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current) }, [])

  /** Probe + ajoute les fichiers audio sélectionnés/déposés. */
  const ingestFiles = useCallback(async (list: File[]) => {
    const audios = list.filter((f) => AUDIO_RE.test(f.name))
    if (audios.length === 0 || !onAddFiles) return
    const big = audios.find((f) => f.size > BIG_FILE_BYTES)
    if (big) {
      setBigFileNote(
        `Gros fichier audio (${fmtSize(big.size)}). Le téléversement reste rapide mais ` +
        `certaines opérations (forme d'onde, Auto RMS) seront limitées.`,
      )
      showToast('⚠️', fmtSize(big.size))
    }
    setImporting(true)
    try {
      await onAddFiles(audios)
    } finally {
      setImporting(false)
    }
  }, [onAddFiles, showToast])

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (list.length) void ingestFiles(list)
  }
  const openFilePicker = () => fileInputRef.current?.click()

  // Drag-and-drop sur le panneau (état vide ou chargé).
  const onPanelDragOver = (e: React.DragEvent) => {
    if (!onAddFiles || !dragHasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }
  const onPanelDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
  }
  const onPanelDrop = (e: React.DragEvent) => {
    if (!onAddFiles || !dragHasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    const list = Array.from(e.dataTransfer.files)
    if (list.some((f) => AUDIO_RE.test(f.name))) {
      triggerFlash()
      void ingestFiles(list)
    }
  }

  // Flash déclenché de l'extérieur (drag-and-drop global de la page).
  useEffect(() => {
    if (flashSignal && flashSignal > 0) triggerFlash()
  }, [flashSignal, triggerFlash])

  // Nettoie l'avertissement gros fichier s'il n'y a plus de fichier volumineux.
  useEffect(() => {
    if (bigFileNote && !entries.some((e) => e.size > BIG_FILE_BYTES)) setBigFileNote(null)
  }, [entries, bigFileNote])

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
    if (!targetEntry) return
    const newSec = clamp(currentSec - 5, 0, targetEntry.durationSec)
    const min = targetEntry.startMin + newSec / 60
    if (active) {
      sync.seekMin(min)
      if (!sync.playing) sync.togglePlayPause()
    } else {
      // Pas encore engagé : on lance directement la lecture à la position.
      sync.playAt(targetEntry.id, min)
    }
    showToast('⏪', 'Replay 5s')
  }, [active, targetEntry, currentSec, sync, showToast])

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
  //
  // Arbitrage : dès qu'un fichier audio est CHARGÉ (hook activé via `enabled`),
  // les flèches ←/→ contrôlent l'audio (±5 s). Maj + ←/→ NE sont PAS consommées
  // → elles retombent sur le pan du graphique géré par App.tsx. Ctrl + ←/→
  // restent un saut audio ±1 min.
  // ─────────────────────────────────────────────────────────────────────
  useKeyboardShortcuts((ev) => {
    const lower = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key

    // Aide — toujours disponible (touche ? = Maj+/)
    if (ev.key === '?') { setHelpOpen((v) => !v); return true }

    // Lecture / Pause — démarre le 1er fichier si rien d'actif
    if (ev.key === ' ' || lower === 'k') {
      showToast('⏯', sync.playing ? 'Pause' : 'Lecture')
      handlePlayPause()
      return true
    }

    switch (ev.key) {
      case 'ArrowLeft':
        if (ev.shift) return false // Maj + ← → pan du graphique (App.tsx)
        seekToSec(currentSec + (ev.mod ? -60 : -5))
        showToast('⏪', ev.mod ? '-1min' : '-5s')
        return true
      case 'ArrowRight':
        if (ev.shift) return false // Maj + → → pan du graphique (App.tsx)
        seekToSec(currentSec + (ev.mod ? 60 : 5))
        showToast('⏩', ev.mod ? '+1min' : '+5s')
        return true
      case 'ArrowUp': adjustVolume(0.1); return true
      case 'ArrowDown': adjustVolume(-0.1); return true
      case 'Home': seekToSec(0); showToast('⏮', 'Début'); return true
      case 'End': seekToSec(targetTotalSec); showToast('⏭', 'Fin'); return true
      case '>': cycleSpeed(1); return true
      case '<': cycleSpeed(-1); return true
    }
    switch (lower) {
      case 'j': seekToSec(currentSec - 10); showToast('⏪', '-10s'); return true
      case 'l': seekToSec(currentSec + 10); showToast('⏩', '+10s'); return true
      case 'm': toggleMute(); return true
      case 'n': if (targetEntry) { onOpenCalage(targetEntry.id); showToast('📍', 'Marqueur') } return true
      case 'r': replay5(); return true
    }
    // Chiffres 0–9 → 0 % … 90 % de la durée
    if (ev.key >= '0' && ev.key <= '9' && !ev.mod && !ev.shift && !ev.alt) {
      const d = Number(ev.key)
      seekToSec(targetTotalSec * (d / 10))
      showToast('⏱', `${d * 10}%`)
      return true
    }
    return false
  }, { enabled: entries.length > 0 })

  const isEmpty = entries.length === 0

  return (
    <div
      className={`relative border-t bg-gray-950/70 flex flex-col transition-colors ${
        flash
          ? 'border-emerald-400 ring-2 ring-emerald-400/70'
          : dragActive
          ? 'border-blue-500 ring-2 ring-blue-500/50'
          : 'border-gray-800'
      }`}
      style={collapsed ? undefined : { height: panelHeight }}
      onDragOver={onPanelDragOver}
      onDragLeave={onPanelDragLeave}
      onDrop={onPanelDrop}
    >
      {/* Toast transitoire des raccourcis — flotte au centre-bas du graphique */}
      <AudioFeedbackToast toast={toast} />
      {/* Input fichier caché — partagé par la zone vide et « Ajouter » */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,.wav,.m4a,.ogg,.flac,audio/*"
        multiple
        className="hidden"
        onChange={onPickFiles}
      />
      {/* Voile de confirmation au drop / drag */}
      {dragActive && !collapsed && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-blue-950/40">
          <span className="text-sm font-semibold text-blue-200">Déposer pour ajouter l'audio</span>
        </div>
      )}
      {/* Poignée de redimensionnement interne (3 px, cursor ns-resize).
          Masquée quand le panneau est replié, ou en mode contrôlé (la
          poignée est alors fournie par le parent au-dessus du panneau). */}
      {!collapsed && controlledHeight === undefined && (
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
          {isEmpty ? (
            'glissez vos fichiers audio ici'
          ) : (
            <>
              {pointName ? `${pointName} · ` : ''}
              {entries.length} fichier{entries.length > 1 ? 's' : ''}
              {' · '}{fmtDurationLong(entries.reduce((s, e) => s + e.durationSec, 0))}
              {active && (
                <> · <span className={`inline-block w-1.5 h-1.5 rounded-full align-middle mx-1 ${statusDot(active.caleStatus).color}`} /><span className="font-mono text-gray-400">{active.name}</span></>
              )}
            </>
          )}
        </span>
        {importing && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-blue-300">
            <Loader2 size={11} className="animate-spin" />
            Préparation…
          </span>
        )}
        {!importing && sync.playing && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Lecture
          </span>
        )}
      </button>

      {/* ÉTAT VIDE — zone de téléversement permanente */}
      {!collapsed && isEmpty && (
        <div className="px-4 pb-4 flex-1 min-h-0 flex flex-col">
          <button
            type="button"
            onClick={openFilePicker}
            className={`flex-1 min-h-0 w-full rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 px-4 py-3 text-center transition-colors ${
              dragActive || flash
                ? 'border-emerald-400 bg-emerald-950/20'
                : 'border-gray-700 hover:border-gray-500 hover:bg-gray-900/40'
            }`}
          >
            <Music size={22} className="text-blue-400" />
            <span className="text-[12px] font-medium text-gray-200">Glissez vos fichiers audio ici</span>
            <span className="text-[11px] text-gray-400">ou cliquez pour parcourir</span>
            <span className="text-[10px] text-gray-500">MP3, WAV, M4A, OGG · jusqu'à 10h+</span>
            {importing && (
              <span className="mt-1 flex items-center gap-1 text-[11px] text-blue-300">
                <Loader2 size={12} className="animate-spin" /> Préparation…
              </span>
            )}
          </button>
        </div>
      )}

      {!collapsed && !isEmpty && (
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
                disabled={importing || (!active && entries.length === 0)}
                className="p-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
                title={importing ? 'Préparation du fichier…' : 'Lecture'}
              >
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
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

            {/* Ancre de calage — heure d'horloge du début de l'audio (position 0).
                Lecture claire + saisie manuelle inline (HH:MM:SS). C'est la
                correspondance qui pilote le curseur et le clic-pour-positionner. */}
            {targetEntry && (
              editAnchor && onApplyCalage ? (
                <input
                  autoFocus
                  type="text"
                  defaultValue={minToClock(targetEntry.startMin)}
                  onBlur={(e) => applyAnchor(targetEntry, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditAnchor(false)
                  }}
                  placeholder="HH:MM:SS"
                  className="w-[92px] text-[10px] font-mono bg-gray-800 text-gray-100 border border-emerald-600 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  title="Heure d'horloge à laquelle commence l'audio (position 0)"
                />
              ) : (
                <button
                  onClick={() => onApplyCalage && setEditAnchor(true)}
                  disabled={!onApplyCalage}
                  className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1 disabled:cursor-default"
                  title="Heure de début de l'audio — cliquer pour saisir manuellement"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${statusDot(targetEntry.caleStatus).color}`} />
                  Démarre à <span className="font-mono text-gray-200">{minToClock(targetEntry.startMin)}</span>
                </button>
              )
            )}

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

          {/* Bandeau anti-curseur-faux : tant que le fichier actif n'est pas
              calé, son début est forcé à 00:00 → le curseur de lecture pointe
              un mauvais instant. On bascule proprement vers la saisie manuelle. */}
          {active && active.caleStatus === 'none' && onApplyCalage && !editAnchor && (
            <div className="flex items-center gap-2 text-[10px] text-rose-200 bg-rose-950/40 border border-rose-800/60 rounded px-2 py-1">
              <AlertTriangle size={11} className="shrink-0 text-rose-400" />
              <span className="leading-snug">
                Non calé — la position du curseur n'est pas fiable. Définissez l'heure de début de l'audio.
              </span>
              <button
                onClick={() => setEditAnchor(true)}
                className="ml-auto shrink-0 text-rose-100 bg-rose-800/60 hover:bg-rose-700/60 border border-rose-700 rounded px-2 py-0.5"
              >
                Définir l'heure
              </button>
            </div>
          )}

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
                  height={Math.max(60, panelHeight - 150)}
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

          {/* Avertissement gros fichier (> 500 Mo) — informatif */}
          {bigFileNote && (
            <div className="flex items-start gap-1.5 mt-1 text-[10px] text-amber-300 bg-amber-950/30 border border-amber-800/50 rounded px-2 py-1">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" />
              <span className="leading-snug">{bigFileNote}</span>
            </div>
          )}

          {/* + Ajouter d'autres fichiers audio */}
          {onAddFiles && (
            <button
              onClick={openFilePicker}
              disabled={importing}
              className="flex items-center gap-1 self-start text-[11px] text-blue-300 hover:text-blue-200 bg-gray-900 hover:bg-gray-800 border border-gray-700 rounded px-2 py-1 mt-1 disabled:opacity-50"
              title="Ajouter d'autres fichiers audio"
            >
              {importing ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Ajouter d'autres fichiers audio
            </button>
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
