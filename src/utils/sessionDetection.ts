/**
 * Détection de sessions de mesure — découpe une série de fichiers d'un même
 * instrument en "sessions continues" séparées par des discontinuités
 * classées par sévérité selon l'écart temporel.
 *
 * Seuils (conformes au cahier des charges) :
 *   gap ≤ 5 min         → continu (même session)
 *   5 min < gap ≤ 1 h   → discontinuité courte  (severity "minor",  ambre)
 *   1 h   < gap ≤ 6 h   → discontinuité majeure (severity "major",  orange)
 *   gap > 6 h           → discontinuité critique (severity "critical", rouge)
 */
import type { MeasurementFile } from '../types'

export type GapSeverity = 'none' | 'minor' | 'major' | 'critical'

export interface SessionGap {
  /** Ecart en minutes entre la fin de la session précédente et le début de la suivante. */
  gapMin: number
  severity: GapSeverity
  /** ISO timestamp de la fin de la session précédente. */
  from: string
  /** ISO timestamp du début de la session suivante. */
  to: string
}

export interface Session {
  /** Index 0-based dans l'ordre chronologique. */
  index: number
  files: MeasurementFile[]
  startISO: string
  endISO: string
  /** Durée totale en minutes (somme des rowCount convertis à 1 s). */
  durationMin: number
}

export interface SessionAnalysis {
  sessions: Session[]
  /** Gaps[i] = écart entre sessions[i] et sessions[i+1]. Longueur = sessions.length - 1. */
  gaps: SessionGap[]
}

export function classifyGap(gapMin: number): GapSeverity {
  if (gapMin <= 5) return 'none'
  if (gapMin <= 60) return 'minor'
  if (gapMin <= 360) return 'major'
  return 'critical'
}

/** Formatte un gap en HhMM. */
export function formatGap(gapMin: number): string {
  const total = Math.max(0, Math.round(gapMin))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${String(m).padStart(2, '0')}`
}

function fileStartISO(f: MeasurementFile): string { return `${f.date}T${f.startTime}` }
function fileStopISO(f: MeasurementFile): string { return `${f.date}T${f.stopTime}` }

/**
 * Découpe une liste de fichiers en sessions. Les fichiers sont d'abord triés
 * par (date, startTime). Un gap strictement supérieur à 5 min crée une
 * nouvelle session.
 */
export function detectSessions(files: MeasurementFile[]): SessionAnalysis {
  if (files.length === 0) return { sessions: [], gaps: [] }
  const sorted = [...files].sort((a, b) => fileStartISO(a).localeCompare(fileStartISO(b)))

  const sessions: Session[] = []
  const gaps: SessionGap[] = []
  let current: MeasurementFile[] = [sorted[0]]

  const flush = () => {
    const first = current[0]
    const last = current[current.length - 1]
    const durationMin = current.reduce((sum, f) => sum + (f.rowCount || 0) / 60, 0)
    sessions.push({
      index: sessions.length,
      files: current,
      startISO: fileStartISO(first),
      endISO: fileStopISO(last),
      durationMin,
    })
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    const prevStopMs = Date.parse(fileStopISO(prev))
    const curStartMs = Date.parse(fileStartISO(cur))
    const gapMin = isFinite(prevStopMs) && isFinite(curStartMs)
      ? (curStartMs - prevStopMs) / 60000
      : Number.POSITIVE_INFINITY

    if (gapMin > 5 || gapMin < -5) {
      flush()
      gaps.push({
        gapMin: Math.max(0, gapMin),
        severity: classifyGap(gapMin),
        from: fileStopISO(prev),
        to: fileStartISO(cur),
      })
      current = [cur]
    } else {
      current.push(cur)
    }
  }
  flush()

  return { sessions, gaps }
}

/** Styles Tailwind par sévérité (bordure + texte). */
export const GAP_STYLES: Record<Exclude<GapSeverity, 'none'>, { border: string; text: string; label: string }> = {
  minor: { border: 'border-amber-700/60', text: 'text-amber-300', label: 'courte' },
  major: { border: 'border-orange-700/60', text: 'text-orange-300', label: 'majeure' },
  critical: { border: 'border-red-700/60', text: 'text-red-300', label: 'critique' },
}
