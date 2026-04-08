/**
 * Helpers de manipulation de dates pour le dashboard ECME.
 *
 * Le fichier Excel utilise une colonne par jour de l'année — chaque en-tête
 * est une date Excel sérielle ou un objet Date après lecture par SheetJS
 * (`cellDates: true`). On normalise tout vers la convention ISO `YYYY-MM-DD`
 * et on bosse en jours entiers (heure tronquée à 00:00).
 */

import * as XLSX from 'xlsx'

/** YYYY-MM-DD pour une Date JS */
export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Aujourd'hui en YYYY-MM-DD (heure locale) */
export function todayISO(): string {
  return toISODate(new Date())
}

/** Format français lisible : "08 avril 2026" */
export function formatFrLong(iso: string): string {
  const d = parseISODate(iso)
  if (!d) return iso
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ]
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`
}

/** Format compact : "08/04/2026" */
export function formatFrShort(iso: string): string {
  const d = parseISODate(iso)
  if (!d) return iso
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/** Parse une string ISO en Date locale (00:00) — retourne null si invalide */
export function parseISODate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
}

/** Différence en jours entiers (b - a) */
export function diffDays(a: string, b: string): number {
  const da = parseISODate(a)
  const db = parseISODate(b)
  if (!da || !db) return 0
  const ms = db.getTime() - da.getTime()
  return Math.round(ms / (1000 * 60 * 60 * 24))
}

/** ISO + N jours */
export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso)
  if (!d) return iso
  d.setDate(d.getDate() + days)
  return toISODate(d)
}

/**
 * Convertit une cellule Excel arbitraire (Date JS, sériel, ou string) en
 * `YYYY-MM-DD`. Retourne null si la valeur n'est pas une date valide.
 */
export function cellToISODate(value: unknown): string | null {
  if (value instanceof Date) return toISODate(value)
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (!parsed) return null
    return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }
  if (typeof value === 'string' && value.trim()) {
    // Try ISO first, then dd/mm/yyyy
    const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
    const fr = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (fr) return `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`
    const t = Date.parse(value)
    if (!isNaN(t)) return toISODate(new Date(t))
  }
  return null
}
