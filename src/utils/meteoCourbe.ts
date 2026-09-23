/**
 * Recevabilité météo sur la courbe LAeq (section Analyse) — calculs PURS.
 *
 * Lecture seule : aucune exclusion, aucune période, aucun changement du modèle
 * de données. Une seule source, un seul point — ceux sélectionnés dans l'onglet
 * Météo — sans appariement ni moyenne. Les niveaux viennent de
 * `evaluateRecevabilite`, la MÊME fonction que le tableau de l'onglet Météo.
 *
 * Seules les EXCEPTIONS portent une bande (à signaler, non recevable,
 * indéterminé) : l'absence de bande signifie « recevable ».
 */
import { evaluateRecevabilite, parseHourTimestamp, type RecevabiliteLevel } from './recevabilite'
import { isError, SOURCES, type SourceId, type SourceResult } from './meteoSources'
import type { MeteoModuleState } from './meteoModule'

/** Sélection de l'onglet Météo (état d'interface, non persisté). */
export interface MeteoSelection {
  pointId: string | null
  source: SourceId | null
}

export type NiveauBande = Exclude<RecevabiliteLevel, 'ok'>

/**
 * Palette Okabe-Ito et libellés des niveaux d'EXCEPTION (recevable n'a pas de
 * bande). Motifs associés : components/meteo/MeteoCourbeMotifs.tsx.
 */
export const MOTIF_METEO: Record<NiveauBande, { couleur: string; libelle: string }> = {
  warn: { couleur: '#E69F00', libelle: 'à signaler' },
  bad: { couleur: '#D55E00', libelle: 'non recevable' },
  indetermine: { couleur: '#56B4E9', libelle: 'indéterminé (donnée aberrante)' },
}

export const ORDRE_NIVEAUX: NiveauBande[] = ['warn', 'bad', 'indetermine']

/** id SVG du motif d'un niveau ; `suffixe` distingue graphique et pastilles de légende. */
export const idMotifMeteo = (level: NiveauBande, suffixe: string) => `meteo-${level}-${suffixe}`

export interface BandeMeteo {
  startMs: number
  endMs: number
  level: NiveauBande
}

export interface Intervalle {
  startMs: number
  endMs: number
}

export interface MeteoCourbe {
  pointId: string
  pointLabel: string
  source: SourceId
  sourceLabel: string
  /** Heures d'exception, fusionnées quand elles se touchent et ont le même niveau. */
  bandes: BandeMeteo[]
  /** Heures pour lesquelles la source a une donnée (tous niveaux), fusionnées. */
  couvert: Intervalle[]
}

const HEURE_MS = 3_600_000

/**
 * Sélection EFFECTIVE : celle de l'onglet Météo si elle désigne un résultat
 * exploitable, sinon le premier point ayant un succès et sa première source en
 * succès — le même défaut que l'onglet Météo à l'ouverture. null si aucune
 * source n'a de données (fait de donnée : rien à afficher).
 */
export function selectionEffective(
  state: MeteoModuleState,
  sel: MeteoSelection,
): { pointId: string; source: SourceResult } | null {
  const avecSucces = state.results.filter((r) => r.outcomes.some((o) => !isError(o)))
  if (avecSucces.length === 0) return null
  const point = avecSucces.find((r) => r.pointId === sel.pointId) ?? avecSucces[0]
  const succes = point.outcomes.filter((o): o is SourceResult => !isError(o))
  const source = succes.find((o) => o.source === sel.source) ?? succes[0]
  return { pointId: point.pointId, source }
}

function fusionner<T extends Intervalle>(items: T[], meme: (a: T, b: T) => boolean): T[] {
  const tri = [...items].sort((a, b) => a.startMs - b.startMs)
  const out: T[] = []
  for (const it of tri) {
    const last = out[out.length - 1]
    if (last && it.startMs <= last.endMs && meme(last, it)) last.endMs = Math.max(last.endMs, it.endMs)
    else out.push({ ...it })
  }
  return out
}

/** Bandes et couverture de la source sélectionnée, ou null s'il n'y a pas de données. */
export function meteoPourCourbe(state: MeteoModuleState, sel: MeteoSelection): MeteoCourbe | null {
  const eff = selectionEffective(state, sel)
  if (!eff) return null
  const heures = evaluateRecevabilite(eff.source.rows, state.asphalt, state.recevabiliteConfig)
  const bandes: BandeMeteo[] = []
  const couvert: Intervalle[] = []
  for (const h of heures) {
    const startMs = parseHourTimestamp(h.datetime).getTime()
    if (!Number.isFinite(startMs)) continue
    const endMs = startMs + HEURE_MS
    couvert.push({ startMs, endMs })
    if (h.level !== 'ok') bandes.push({ startMs, endMs, level: h.level })
  }
  const point = state.points.find((p) => p.id === eff.pointId)
  return {
    pointId: eff.pointId,
    pointLabel: point?.label ?? eff.pointId,
    source: eff.source.source,
    sourceLabel: SOURCES[eff.source.source].shortLabel,
    bandes: fusionner(bandes, (a, b) => a.level === b.level),
    couvert: fusionner(couvert, () => true),
  }
}

/**
 * Portions de la plage de MESURE qu'aucune heure météo ne couvre (début, fin,
 * ou trou dans la série). Vide = couverture complète.
 */
export function portionsNonCouvertes(mesure: Intervalle[], couvert: Intervalle[]): Intervalle[] {
  const c = fusionner(couvert, () => true)
  const out: Intervalle[] = []
  for (const m of fusionner(mesure, () => true)) {
    let curseur = m.startMs
    for (const k of c) {
      if (k.endMs <= curseur) continue
      if (k.startMs >= m.endMs) break
      if (k.startMs > curseur) out.push({ startMs: curseur, endMs: Math.min(k.startMs, m.endMs) })
      curseur = Math.max(curseur, k.endMs)
      if (curseur >= m.endMs) break
    }
    if (curseur < m.endMs) out.push({ startMs: curseur, endMs: m.endMs })
  }
  return out
}

/**
 * Bandes → coordonnées de l'axe X du graphique (minutes depuis `anchorMs`,
 * offset jour × 1440 déjà inclus puisque tout part d'epoch ms), tronquées à
 * la plage du graphique. Une bande hors plage disparaît.
 */
export function zonesSurAxe(
  bandes: BandeMeteo[],
  anchorMs: number,
  plage: { startMin: number; endMin: number },
): { key: string; x1: number; x2: number; level: NiveauBande }[] {
  if (!Number.isFinite(anchorMs)) return []
  const out: { key: string; x1: number; x2: number; level: NiveauBande }[] = []
  for (const b of bandes) {
    const x1 = Math.max(plage.startMin, (b.startMs - anchorMs) / 60_000)
    const x2 = Math.min(plage.endMin, (b.endMs - anchorMs) / 60_000)
    if (x2 > x1) out.push({ key: `${b.level}-${b.startMs}`, x1, x2, level: b.level })
  }
  return out
}

/**
 * Plage de MESURE affichée, en epoch ms : instants `t` (minutes de l'axe X,
 * triés) regroupés en intervalles continus ; un écart de plus de 2 pas
 * d'agrégation coupe l'intervalle. Chaque point couvre son pas.
 */
export function intervallesMesure(ts: number[], pasMin: number, anchorMs: number): Intervalle[] {
  if (ts.length === 0 || !Number.isFinite(anchorMs)) return []
  const pas = Math.max(pasMin, 1 / 60)
  const out: Intervalle[] = []
  let debut = ts[0]
  let prec = ts[0]
  for (let i = 1; i <= ts.length; i++) {
    const t = i < ts.length ? ts[i] : Infinity
    if (t - prec > 2 * pas) {
      out.push({ startMs: anchorMs + debut * 60_000, endMs: anchorMs + (prec + pas) * 60_000 })
      debut = t
    }
    prec = t
  }
  return out
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const jjmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`

/** « 00:00–06:00 » ; préfixé du jour (« 03/07 ») quand la mesure couvre plusieurs jours. */
export function libellePortions(portions: Intervalle[], multiJours: boolean): string {
  return portions
    .map((p) => {
      const a = new Date(p.startMs)
      const b = new Date(p.endMs)
      const jour = multiJours ? `${jjmm(a)} ` : ''
      return `${jour}${hhmm(a)}–${hhmm(b)}`
    })
    .join(', ')
}
