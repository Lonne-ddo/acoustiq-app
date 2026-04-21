/**
 * AudioWaveform — affiche la forme d'onde (enveloppe RMS par seconde) d'un
 * fichier audio, avec curseur de lecture et timeline de graduations.
 *
 * Stratégie mémoire : on décode l'audio à la demande via decodeBlobUrl puis
 * on calcule `computeRmsEnvelope(buffer, 1)` pour obtenir 1 point/seconde.
 * Pour un MP3 de 600 Mo / 2 h / 44.1 kHz stéréo, cela représente ~7 200 points
 * sur le canvas — largement suffisant, et on garde en mémoire quelques KB de
 * dB/sec plutôt que les centaines de Mo du PCM décodé (le buffer est libéré
 * après le calcul de l'enveloppe).
 *
 * Le calcul n'est lancé que si le composant est monté (panneau agrandi).
 * Tant que la décodage n'est pas fini, on affiche un loader.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { AudioFileEntry } from '../../types'
import type { UseAudioSyncResult } from '../../hooks/useAudioSync'
import { decodeBlobUrl, computeRmsEnvelope } from '../../utils/audioEnvelope'

/** Seuil au-delà duquel on avertit l'utilisateur avant de décoder (octets). */
const LARGE_FILE_WARNING = 200 * 1024 * 1024 // 200 Mo

function fmtSec(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '--:--'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** Intervalle adaptatif des graduations en secondes. */
function tickIntervalSec(durationSec: number, widthPx: number): number {
  // Vise ~1 graduation tous les 100 px
  const targetTicks = Math.max(2, Math.floor(widthPx / 100))
  const rough = durationSec / targetTicks
  // Arrondir à un intervalle lisible : 60 s, 5 min, 10 min, 30 min, 1 h
  const steps = [60, 300, 600, 1800, 3600, 7200]
  for (const s of steps) if (rough <= s) return s
  return 14400
}

// Cache process-wide : les enveloppes ne sont pas invalidées tant que le
// fichier n'est pas rechargé (le blobUrl est stable pendant la session).
const envelopeCache = new Map<string, number[]>()

interface Props {
  entry: AudioFileEntry
  sync: UseAudioSyncResult
  /** Hauteur disponible en px (canvas + timeline) */
  height: number
}

export default function AudioWaveform({ entry, sync, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [canvasW, setCanvasW] = useState(0)
  const [envelope, setEnvelope] = useState<number[] | null>(() => envelopeCache.get(entry.id) ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [acceptLarge, setAcceptLarge] = useState(false)
  const isLarge = entry.size > LARGE_FILE_WARNING
  const canDecode = !isLarge || acceptLarge

  // Suivi de la largeur du conteneur
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setCanvasW(Math.floor(el.clientWidth)))
    obs.observe(el)
    setCanvasW(Math.floor(el.clientWidth))
    return () => obs.disconnect()
  }, [])

  // Décodage à la demande (annulable si l'entrée change avant la fin)
  useEffect(() => {
    let cancelled = false
    if (envelope || !canDecode) return
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const buffer = await decodeBlobUrl(entry.blobUrl)
        if (cancelled) return
        const env = computeRmsEnvelope(buffer, 1)
        const dbs = env.map((p) => p.db)
        envelopeCache.set(entry.id, dbs)
        setEnvelope(dbs)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Décodage audio impossible')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [entry.id, entry.blobUrl, canDecode, envelope])

  const waveH = Math.max(30, height - 22 /* timeline */ - 4 /* margins */)

  // Dessin du canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || canvasW === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasW * dpr
    canvas.height = waveH * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#030712'
    ctx.fillRect(0, 0, canvasW, waveH)

    if (!envelope || envelope.length === 0) return

    // Normalise l'enveloppe dB → [0..1]
    let lo = Infinity, hi = -Infinity
    for (const v of envelope) {
      if (Number.isFinite(v)) {
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return
    const mid = waveH / 2

    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 1
    ctx.beginPath()
    const nPts = envelope.length
    for (let x = 0; x < canvasW; x++) {
      const startIdx = Math.floor((x / canvasW) * nPts)
      const endIdx = Math.floor(((x + 1) / canvasW) * nPts)
      let peak = -Infinity
      for (let i = startIdx; i < Math.max(startIdx + 1, endIdx); i++) {
        const v = envelope[i]
        if (v > peak) peak = v
      }
      if (!Number.isFinite(peak)) continue
      const norm = (peak - lo) / (hi - lo)   // 0..1
      const amp = mid * (0.15 + norm * 0.85) // 15% minimum pour rester lisible
      ctx.moveTo(x, mid - amp)
      ctx.lineTo(x, mid + amp)
    }
    ctx.stroke()
  }, [envelope, canvasW, waveH])

  // Position du curseur de lecture (en secondes depuis le début du fichier)
  const currentSec = sync.activeEntryId === entry.id && sync.currentMin !== null
    ? Math.max(0, (sync.currentMin - entry.startMin) * 60)
    : 0
  const durationSec = entry.durationSec
  const cursorPct = durationSec > 0 ? (currentSec / durationSec) * 100 : 0

  // Gradations temporelles
  const ticks = useMemo(() => {
    if (canvasW === 0 || durationSec <= 0) return [] as Array<{ x: number; label: string }>
    const interval = tickIntervalSec(durationSec, canvasW)
    const out: Array<{ x: number; label: string }> = []
    for (let t = 0; t <= durationSec; t += interval) {
      const x = (t / durationSec) * canvasW
      out.push({ x, label: fmtSec(t) })
    }
    return out
  }, [canvasW, durationSec])

  function handleCanvasClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const seekSec = frac * durationSec
    sync.seekMin(entry.startMin + seekSec / 60)
  }

  return (
    <div className="w-full select-none">
      <div
        ref={containerRef}
        className="relative w-full cursor-pointer"
        style={{ height: waveH }}
        onClick={handleCanvasClick}
      >
        <canvas ref={canvasRef} className="block w-full rounded" style={{ height: waveH }} />

        {/* Curseur de lecture */}
        {sync.activeEntryId === entry.id && cursorPct > 0 && (
          <div
            className="pointer-events-none absolute top-0 bottom-0"
            style={{
              left: `${cursorPct}%`,
              width: 0,
              borderLeft: '1px solid rgba(255,255,255,0.85)',
            }}
          >
            <div
              className="absolute"
              style={{
                top: -3, left: 0,
                width: 6, height: 6, borderRadius: 9999,
                backgroundColor: 'white',
                transform: 'translateX(-50%)',
              }}
            />
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-[11px] text-gray-400 bg-gray-950/70">
            <Loader2 size={13} className="animate-spin" />
            Décodage de la forme d'onde…
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-rose-300 bg-gray-950/70 px-4 text-center">
            {error}
          </div>
        )}

        {!loading && !error && !envelope && isLarge && !acceptLarge && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[11px] text-amber-300 bg-gray-950/70 px-4 text-center">
            <span>
              Fichier volumineux ({Math.round(entry.size / (1024 * 1024))} Mo) — le
              décodage complet va consommer beaucoup de RAM.
            </span>
            <button
              onClick={(ev) => { ev.stopPropagation(); setAcceptLarge(true) }}
              className="text-[11px] bg-amber-700 hover:bg-amber-600 text-white rounded px-2 py-1"
            >
              Générer quand même
            </button>
          </div>
        )}
      </div>

      {/* Timeline avec graduations */}
      <div className="relative h-[18px] mt-1 border-t border-gray-800">
        {ticks.map((t, i) => (
          <div
            key={i}
            className="absolute top-0 text-[9px] text-gray-500 font-mono select-none"
            style={{ left: t.x, transform: 'translateX(-50%)' }}
          >
            <div className="w-px h-1 bg-gray-700 mx-auto" />
            <span>{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
