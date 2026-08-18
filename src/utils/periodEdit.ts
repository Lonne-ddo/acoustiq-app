/**
 * Édition d'une période nommée : parsing des bornes et validation.
 *
 * Règle structurante — CHAQUE BORNE GARDE SA DATE D'ORIGINE.
 * Les bornes sont des epoch ms, l'affichage est en HH:MM:SS. Modifier l'heure
 * ne touche donc jamais au jour civil de la borne. Une période 22:00 → 07:00
 * (Lnuit) reste à cheval sur minuit après édition, au lieu d'être repliée sur
 * une seule journée et de devenir invalide.
 *
 * Corollaire assumé : reporter la fin de 02:00 à 23:00 donne 23:00 le jour de
 * la fin — pas le jour du début.
 *
 * Aucun ajustement silencieux : quand les bornes s'inversent, on le SIGNALE
 * avec les deux dates lisibles, et l'appelant propose une action explicite.
 * Jamais de +24 h en sourdine.
 */

export interface MeasureRange {
  startMs: number
  endMs: number
}

export interface PeriodDraft {
  name: string
  startMs: number
  endMs: number
}

export interface PeriodValidation {
  /** Faux uniquement en cas d'erreur bloquante (nom vide, borne illisible). */
  ok: boolean
  /** Motifs de refus. L'état n'est pas modifié tant qu'il en reste un. */
  errors: string[]
  /** Signalements non bloquants — la modification est acceptée. */
  warnings: string[]
  /** `endMs <= startMs`. L'appelant propose « reporter la fin au lendemain ». */
  endBeforeStart: boolean
  /** Les deux bornes ne tombent pas le même jour civil. */
  spansMidnight: boolean
  /** Au moins une borne sort de la plage de mesure fournie. */
  outsideMeasureRange: boolean
}

// ─── Formatage ──────────────────────────────────────────────────────────────

/** « JJ/MM » */
export function fmtDayMonth(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** « JJ/MM HH:MM:SS » */
export function fmtDayTime(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${fmtDayMonth(ms)} ${hh}:${mi}:${ss}`
}

/** Vrai si les deux instants tombent le même jour civil (heure locale). */
export function sameCivilDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/**
 * « HH:MM » ou « HH:MM:SS » → millisecondes depuis minuit, ou null.
 * Déplacé depuis PeriodsPanel pour être partagé entre création et édition —
 * même regex, même tolérance, aucun changement de comportement.
 */
export function parseHHMMSS(s: string): number | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const mi = parseInt(m[2], 10)
  const se = m[3] ? parseInt(m[3], 10) : 0
  if (h > 23 || mi > 59 || se > 59) return null
  return ((h * 60 + mi) * 60 + se) * 1000
}

/**
 * « YYYY-MM-DD » → epoch ms de minuit local, ou NaN.
 * Repris à l'identique de PeriodsPanel pour être partagé avec App (calcul de
 * la plage de mesure). Même regex, même résultat.
 */
export function dateToMsAtMidnight(iso: string): number {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return NaN
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)).getTime()
}

/**
 * Remplace la partie horaire de `originalMs` par `hhmmss`, en conservant son
 * jour civil. C'est le cœur de la règle « chaque borne garde sa date ».
 *
 * @returns le nouvel epoch ms, ou null si l'heure est illisible.
 */
export function applyTimeChange(originalMs: number, hhmmss: string): number | null {
  if (!Number.isFinite(originalMs)) return null
  const t = parseHHMMSS(hhmmss)
  if (t === null) return null
  const d = new Date(originalMs)
  d.setHours(0, 0, 0, 0)
  return d.getTime() + t
}

/**
 * Reporte un instant au lendemain, à la même heure locale.
 * `setDate(+1)` plutôt que `+24 h` : traverse correctement les changements
 * d'heure, où une journée civile ne fait pas 24 heures.
 */
export function shiftToNextDay(ms: number): number {
  const d = new Date(ms)
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Valide une période éditée.
 *
 * Erreurs (bloquantes) : nom vide, borne non finie.
 * Avertissements (non bloquants) : bornes inversées, période à cheval sur
 * minuit, borne hors de la plage de mesure.
 *
 * @param measureRange plage couverte par les fichiers de mesure. Omise ou nulle
 *                     → aucun contrôle de plage, aucun avertissement.
 */
export function validatePeriodEdit(
  draft: PeriodDraft,
  measureRange?: MeasureRange | null,
): PeriodValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (draft.name.trim() === '') {
    errors.push('Le nom ne peut pas être vide.')
  }
  if (!Number.isFinite(draft.startMs)) {
    errors.push('Heure de début illisible — format attendu HH:MM ou HH:MM:SS.')
  }
  if (!Number.isFinite(draft.endMs)) {
    errors.push('Heure de fin illisible — format attendu HH:MM ou HH:MM:SS.')
  }

  const bothFinite = Number.isFinite(draft.startMs) && Number.isFinite(draft.endMs)
  const endBeforeStart = bothFinite && draft.endMs <= draft.startMs
  const spansMidnight = bothFinite && !endBeforeStart && !sameCivilDay(draft.startMs, draft.endMs)

  if (endBeforeStart) {
    // Jamais un refus : c'est souvent l'intention « la fin est le lendemain »
    // mal exprimée. On montre les deux dates pour que l'écart soit visible,
    // et l'appelant propose le report explicite.
    warnings.push(
      `Fin (${fmtDayTime(draft.endMs)}) antérieure ou égale au début (${fmtDayTime(draft.startMs)}) — durée nulle. ` +
        'Si la période traverse minuit, reportez la fin au lendemain.',
    )
  } else if (spansMidnight) {
    warnings.push(
      `Période à cheval sur minuit (${fmtDayMonth(draft.startMs)} → ${fmtDayMonth(draft.endMs)}).`,
    )
  }

  let outsideMeasureRange = false
  if (
    measureRange &&
    bothFinite &&
    Number.isFinite(measureRange.startMs) &&
    Number.isFinite(measureRange.endMs)
  ) {
    if (draft.startMs < measureRange.startMs || draft.endMs > measureRange.endMs) {
      outsideMeasureRange = true
      warnings.push(
        `Hors de la plage de mesure (${fmtDayTime(measureRange.startMs)} → ${fmtDayTime(measureRange.endMs)}) — ` +
          'les données manquantes ne sont pas comptées dans les indices.',
      )
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    endBeforeStart,
    spansMidnight,
    outsideMeasureRange,
  }
}
