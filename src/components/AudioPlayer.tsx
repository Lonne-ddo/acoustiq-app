/**
 * Lecteur audio .wav avec forme d'onde sur canvas
 * Utilise le Web Audio API pour le décodage et la lecture
 * Curseur synchronisé avec le graphique temporel principal
 */
import { useRef, useEffect, useState, useCallback } from 'react'
import { Play, Pause, Square, Volume2 } from 'lucide-react'
import type { AudioFile } from '../types'

/** Hauteur du canvas de la forme d'onde */
const WAVE_H = 64

interface Props {
  audio: AudioFile
  /** Position courante du graphique en minutes depuis minuit */
  chartTimeMin: number | null
  /** Appelé quand l'utilisateur clique sur la forme d'onde pour naviguer */
  onSeek: (timeMin: number) => void
  onRemove: () => void
}

export default function AudioPlayer({ audio, chartTimeMin, onSeek, onRemove }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const startTimeRef = useRef(0)
  const offsetRef = useRef(0)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [canvasW, setCanvasW] = useState(0)
  const animRef = useRef<number>(0)

  // Observer la largeur du conteneur
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setCanvasW(Math.floor(el.clientWidth)))
    obs.observe(el)
    setCanvasW(Math.floor(el.clientWidth))
    return () => obs.disconnect()
  }, [])

  // Dessiner la forme d'onde
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || canvasW === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasW * dpr
    canvas.height = WAVE_H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Fond
    ctx.fillStyle = '#111827'
    ctx.fillRect(0, 0, canvasW, WAVE_H)

    // Extraire les données du premier canal
    const raw = audio.buffer.getChannelData(0)
    const step = Math.max(1, Math.floor(raw.length / canvasW))
    const mid = WAVE_H / 2

    ctx.strokeStyle = '#10b981'
    ctx.lineWidth = 1
    ctx.beginPath()

    for (let x = 0; x < canvasW; x++) {
      const start = x * step
      let min = 1, max = -1
      for (let j = 0; j < step && start + j < raw.length; j++) {
        const v = raw[start + j]
        if (v < min) min = v
        if (v > max) max = v
      }
      const yMin = mid + min * mid
      const yMax = mid + max * mid
      ctx.moveTo(x, yMin)
      ctx.lineTo(x, yMax)
    }

    ctx.stroke()
  }, [audio.buffer, canvasW])

  // Boucle d'animation pour la position de lecture
  useEffect(() => {
    if (!playing) return
    function tick() {
      if (!audioCtxRef.current) return
      const elapsed = audioCtxRef.current.currentTime - startTimeRef.current + offsetRef.current
      setCurrentTime(Math.min(elapsed, audio.duration))
      if (elapsed < audio.duration) {
        animRef.current = requestAnimationFrame(tick)
      } else {
        setPlaying(false)
      }
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [playing, audio.duration])

  // Nettoyage à la destruction
  useEffect(() => {
    return () => {
      sourceRef.current?.stop()
      audioCtxRef.current?.close()
    }
  }, [])

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    return audioCtxRef.current
  }, [])

  const handlePlay = useCallback(() => {
    const ctx = getAudioContext()
    // Arrêter la source précédente
    sourceRef.current?.stop()
    const source = ctx.createBufferSource()
    source.buffer = audio.buffer
    source.connect(ctx.destination)
    source.onended = () => setPlaying(false)
    sourceRef.current = source

    const offset = currentTime >= audio.duration ? 0 : currentTime
    offsetRef.current = offset
    startTimeRef.current = ctx.currentTime
    source.start(0, offset)
    setPlaying(true)
  }, [audio.buffer, audio.duration, currentTime, getAudioContext])

  const handlePause = useCallback(() => {
    sourceRef.current?.stop()
    const ctx = audioCtxRef.current
    if (ctx) {
      const elapsed = ctx.currentTime - startTimeRef.current + offsetRef.current
      setCurrentTime(Math.min(elapsed, audio.duration))
    }
    setPlaying(false)
  }, [audio.duration])

  const handleStop = useCallback(() => {
    sourceRef.current?.stop()
    setPlaying(false)
    setCurrentTime(0)
    offsetRef.current = 0
  }, [])

  // Clic sur la forme d'onde = seek
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    const seekTime = frac * audio.duration
    setCurrentTime(seekTime)
    offsetRef.current = seekTime

    // Convertir en minutes depuis minuit et notifier le parent
    const seekMin = audio.startOffsetMin + seekTime / 60
    onSeek(seekMin)

    // Si en lecture, relancer depuis la nouvelle position
    if (playing) {
      sourceRef.current?.stop()
      const ctx = getAudioContext()
      const source = ctx.createBufferSource()
      source.buffer = audio.buffer
      source.connect(ctx.destination)
      source.onended = () => setPlaying(false)
      sourceRef.current = source
      startTimeRef.current = ctx.currentTime
      source.start(0, seekTime)
    }
  }, [audio, playing, onSeek, getAudioContext])

  // Curseur de position du graphique sur la forme d'onde
  const chartCursorPct = chartTimeMin !== null
    ? Math.max(0, Math.min(100, ((chartTimeMin - audio.startOffsetMin) / (audio.duration / 60)) * 100))
    : null

  // Curseur de lecture
  const playCursorPct = (currentTime / audio.duration) * 100

  function formatTime(sec: number): string {
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  return (
    <div className="px-3 py-3 border-b border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Volume2 size={12} className="text-emerald-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Audio</span>
        </div>
        <button
          onClick={onRemove}
          className="text-gray-600 hover:text-red-400 text-xs transition-colors"
          title="Retirer l'audio"
        >
          ✕
        </button>
      </div>

      <p className="text-xs text-gray-500 truncate mb-1.5" title={audio.name}>
        {audio.name}
      </p>
      <p className="text-xs text-gray-600 mb-2">
        {audio.date} · {formatTime(audio.duration)}
      </p>

      {/* Forme d'onde */}
      <div ref={containerRef} className="relative cursor-pointer mb-2">
        <canvas
          ref={canvasRef}
          className="block w-full rounded"
          style={{ height: WAVE_H }}
          onClick={handleCanvasClick}
        />

        {/* Curseur de lecture */}
        <div
          className="pointer-events-none absolute inset-y-0"
          style={{
            left: `${playCursorPct}%`,
            width: 1.5,
            backgroundColor: '#f59e0b',
          }}
        />

        {/* Curseur du graphique */}
        {chartCursorPct !== null && chartCursorPct >= 0 && chartCursorPct <= 100 && (
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{
              left: `${chartCursorPct}%`,
              width: 1,
              backgroundColor: 'rgba(255,255,255,0.4)',
              borderLeft: '1px dashed rgba(255,255,255,0.4)',
            }}
          />
        )}
      </div>

      {/* Contrôles */}
      <div className="flex items-center gap-1.5">
        {playing ? (
          <button
            onClick={handlePause}
            className="p-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700
                       border border-gray-600 transition-colors"
            title="Pause"
          >
            <Pause size={12} />
          </button>
        ) : (
          <button
            onClick={handlePlay}
            className="p-1 rounded bg-emerald-700 text-white hover:bg-emerald-600
                       transition-colors"
            title="Lecture"
          >
            <Play size={12} />
          </button>
        )}
        <button
          onClick={handleStop}
          className="p-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700
                     border border-gray-600 transition-colors"
          title="Stop"
        >
          <Square size={10} />
        </button>
        <span className="text-xs text-gray-400 tabular-nums ml-1">
          {formatTime(currentTime)} / {formatTime(audio.duration)}
        </span>
      </div>
    </div>
  )
}
