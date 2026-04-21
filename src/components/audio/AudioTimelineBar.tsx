/**
 * AudioTimelineBar — bandeau fin sous l'axe X du graphique LAeq indiquant
 * où des fichiers audio sont disponibles.
 *
 * - Hauteur 4 px, couleur bleu semi-transparent (opacity 0.30).
 * - Une barre par fichier, positionnée selon startMin + durationSec.
 * - Tooltip au survol : nom du fichier.
 * - Utilise les mêmes marges internes Recharts que le chart (PAD_LEFT 64,
 *   PAD_RIGHT 24) pour un alignement pixel-perfect.
 */
import { useEffect, useRef, useState } from 'react'
import type { AudioCoverageRange } from '../../hooks/useAudioSync'

// Marges Recharts utilisées par TimeSeriesChart — doivent rester synchronisées
const PAD_LEFT = 64
const PAD_RIGHT = 24

interface Props {
  /** Plages audio en minutes depuis minuit (aligné avec l'axe X du chart) */
  coverage: AudioCoverageRange[]
  /** Plage visible (zoom) */
  effectiveRange: { startMin: number; endMin: number }
  /** Nom d'affichage de chaque entrée, clé = entryId */
  labels?: Record<string, string>
}

export default function AudioTimelineBar({ coverage, effectiveRange, labels }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ entryId: string; x: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)))
    obs.observe(el)
    setWidth(Math.floor(el.clientWidth))
    return () => obs.disconnect()
  }, [])

  if (coverage.length === 0) return null

  const span = Math.max(0.0001, effectiveRange.endMin - effectiveRange.startMin)
  const usable = Math.max(1, width - PAD_LEFT - PAD_RIGHT)

  function pxFor(minutes: number): number {
    const frac = (minutes - effectiveRange.startMin) / span
    return PAD_LEFT + frac * usable
  }

  const segments = coverage
    .map((r) => {
      if (r.endMin < effectiveRange.startMin || r.startMin > effectiveRange.endMin) return null
      const x0 = Math.max(PAD_LEFT, pxFor(r.startMin))
      const x1 = Math.min(PAD_LEFT + usable, pxFor(r.endMin))
      if (x1 <= x0) return null
      return { r, x0, x1 }
    })
    .filter((v): v is { r: AudioCoverageRange; x0: number; x1: number } => v !== null)

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    for (const s of segments) {
      if (px >= s.x0 && px <= s.x1) {
        setHover({ entryId: s.r.entryId, x: px })
        return
      }
    }
    setHover(null)
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-4"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHover(null)}
    >
      {/* Ligne de fond sombre pour repère visuel */}
      <div
        className="absolute"
        style={{
          left: PAD_LEFT,
          right: PAD_RIGHT,
          top: 4,
          height: 4,
          backgroundColor: 'rgba(55, 65, 81, 0.35)',
          borderRadius: 2,
        }}
      />
      {segments.map(({ r, x0, x1 }) => (
        <div
          key={r.entryId}
          className="absolute cursor-help"
          style={{
            left: x0,
            width: Math.max(1, x1 - x0),
            top: 4,
            height: 4,
            backgroundColor: 'rgba(59, 130, 246, 0.30)',
            borderLeft: '1px solid rgba(59, 130, 246, 0.6)',
            borderRight: '1px solid rgba(59, 130, 246, 0.6)',
            borderRadius: 1,
          }}
          title={labels?.[r.entryId] ?? 'Audio disponible'}
        />
      ))}

      {hover && (
        <div
          className="pointer-events-none absolute px-1.5 py-0.5 rounded
                     bg-gray-900/95 border border-blue-700 text-[10px] text-blue-100
                     whitespace-nowrap shadow-lg z-10"
          style={{
            left: Math.min(Math.max(hover.x - 60, 4), Math.max(10, width - 200)),
            top: -22,
          }}
        >
          Audio disponible : {labels?.[hover.entryId] ?? hover.entryId}
        </div>
      )}
    </div>
  )
}
