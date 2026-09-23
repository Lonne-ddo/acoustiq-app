/**
 * Exclusion des périodes SUGGÉRÉE par la recevabilité météo — calculs PURS.
 *
 * Règles (chantier exclusion ↔ météo) :
 *  - la météo SUGGÈRE, elle n'applique jamais seule : `suggererExclusions` ne
 *    produit que des propositions ; seules celles que l'utilisateur coche
 *    deviennent des périodes (`periodesDepuisSuggestions`) ;
 *  - source de vérité unique : le point et la source sélectionnés dans
 *    l'onglet Météo (`selectionEffective`), les mêmes que les bandes de la
 *    courbe LAeq ;
 *  - granularité : l'HEURE MÉTÉO EXACTE [HH:00, HH+1:00[, indépendante des
 *    périodes existantes — aucune période de l'utilisateur n'est modifiée ;
 *  - seules « non recevable » et « indéterminé » sont suggérées, JAMAIS
 *    fusionnées entre elles (deux motifs distincts) ; « à signaler » est
 *    recevable au §3.6 et n'est jamais suggérée ;
 *  - une heure déjà couverte par une période d'exclusion existante (manuelle
 *    ou météo) n'est pas reproposée : pas de doublon, rien d'écrasé.
 */
import { evaluateRecevabilite, parseHourTimestamp, RECEVABILITE_LABEL } from './recevabilite'
import { selectionEffective, type MeteoSelection, type Intervalle } from './meteoCourbe'
import { NIVEAUX_EXCLUS_PAR_METEO, type MeteoModuleState } from './meteoModule'
import { SOURCES, type MeteoRequest } from './meteoSources'
import { DEFAULT_CATEGORY_IDS, type Category, type MotifMeteo, type Period } from '../types'

const HEURE_MS = 3_600_000

export interface SuggestionExclusion {
  /** Clé stable (niveau + début) : sert aussi d'id de période. */
  key: string
  niveau: 'bad' | 'indetermine'
  startMs: number
  endMs: number
  heures: string[]
  raisons: string[]
}

/** Ce qui a produit les suggestions : figé dans le motif à la validation. */
export interface ContexteSuggestion {
  pointId: string
  pointLabel: string
  source: string
  sourceLabel: string
  fetchedAt: string | null
  request: MeteoRequest | null
}

export interface ResultatSuggestion {
  contexte: ContexteSuggestion
  suggestions: SuggestionExclusion[]
}

const couvre = (plages: Intervalle[], a: number, b: number) =>
  plages.some((p) => p.startMs <= a && p.endMs >= b)
const recoupe = (plages: Intervalle[], a: number, b: number) =>
  plages.some((p) => p.startMs < b && p.endMs > a)

/**
 * Suggestions d'exclusion pour la sélection de l'onglet Météo.
 * @param plagesMesure plages où des mesures existent (epoch ms) : une heure
 *        sans aucune mesure n'est pas suggérée (elle n'exclurait rien).
 * @returns null s'il n'y a pas de données météo (fait de donnée, pas une erreur).
 */
export function suggererExclusions(
  state: MeteoModuleState,
  sel: MeteoSelection,
  periods: Period[],
  categories: Category[],
  plagesMesure: Intervalle[],
): ResultatSuggestion | null {
  const eff = selectionEffective(state, sel)
  if (!eff) return null
  const src = eff.source
  const exclues: Intervalle[] = periods
    .filter((p) => categories.find((c) => c.id === p.categoryId)?.mode === 'exclude')
    .map((p) => ({ startMs: p.startMs, endMs: p.endMs }))

  const heures = evaluateRecevabilite(src.rows, state.asphalt, state.recevabiliteConfig)
  const candidates = heures
    .filter((h) => NIVEAUX_EXCLUS_PAR_METEO.has(h.level))
    .map((h) => {
      const startMs = parseHourTimestamp(h.datetime).getTime()
      return { h, startMs, endMs: startMs + HEURE_MS }
    })
    .filter((c) => Number.isFinite(c.startMs))
    .filter((c) => recoupe(plagesMesure, c.startMs, c.endMs))
    .filter((c) => !couvre(exclues, c.startMs, c.endMs))
    .sort((a, b) => a.startMs - b.startMs)

  // Heures contiguës de MÊME niveau fusionnées ; deux niveaux jamais fusionnés.
  const suggestions: SuggestionExclusion[] = []
  for (const c of candidates) {
    const niveau = c.h.level as 'bad' | 'indetermine'
    const last = suggestions[suggestions.length - 1]
    if (last && last.niveau === niveau && last.endMs === c.startMs) {
      last.endMs = c.endMs
      last.heures.push(c.h.datetime)
      for (const r of c.h.reasons) if (!last.raisons.includes(r)) last.raisons.push(r)
    } else {
      suggestions.push({
        key: `meteo-excl-${niveau}-${c.startMs}`,
        niveau,
        startMs: c.startMs,
        endMs: c.endMs,
        heures: [c.h.datetime],
        raisons: [...new Set(c.h.reasons)],
      })
    }
  }

  const point = state.points.find((p) => p.id === eff.pointId)
  return {
    contexte: {
      pointId: eff.pointId,
      pointLabel: point?.label ?? eff.pointId,
      source: src.source,
      sourceLabel: SOURCES[src.source].shortLabel,
      fetchedAt: src.fetchedAt ?? null,
      request: src.request ?? null,
    },
    suggestions,
  }
}

/** « d'après la météo du point BV-1 (Env. Canada) » — la portée du motif, dite. */
export function origineMotif(m: Pick<MotifMeteo, 'pointLabel' | 'sourceLabel'>): string {
  return `d'après la météo du point ${m.pointLabel} (${m.sourceLabel})`
}

export const LIBELLE_NIVEAU_EXCLUSION: Record<'bad' | 'indetermine', string> = {
  bad: 'Météo non recevable',
  indetermine: 'Donnée météo aberrante',
}

/**
 * Périodes d'exclusion créées À LA VALIDATION, pour les seules suggestions
 * cochées. Chaque période porte son motif complet ; aucune période existante
 * n'est touchée (l'appelant AJOUTE ces périodes).
 */
export function periodesDepuisSuggestions(
  choisies: SuggestionExclusion[],
  contexte: ContexteSuggestion,
  state: Pick<MeteoModuleState, 'recevabiliteConfig' | 'asphalt'>,
  valideLe: Date,
): Period[] {
  return choisies.map((s) => {
    const motifMeteo: MotifMeteo = {
      niveau: s.niveau,
      heures: [...s.heures],
      raisons: [...s.raisons],
      source: contexte.source,
      sourceLabel: contexte.sourceLabel,
      pointId: contexte.pointId,
      pointLabel: contexte.pointLabel,
      fetchedAt: contexte.fetchedAt,
      request: contexte.request ? { ...contexte.request } : null,
      seuils: { ...state.recevabiliteConfig },
      asphalte: state.asphalt,
      valideLe: valideLe.toISOString(),
    }
    return {
      id: s.key,
      name: `${LIBELLE_NIVEAU_EXCLUSION[s.niveau]} — ${contexte.pointLabel}`,
      startMs: s.startMs,
      endMs: s.endMs,
      categoryId: DEFAULT_CATEGORY_IDS.exclure,
      notes: `Exclusion ${origineMotif(contexte)} : ${RECEVABILITE_LABEL[s.niveau]} — ${s.raisons.join(' ; ')}. S'applique à tous les points de mesure.`,
      motifMeteo,
    }
  })
}

/**
 * Plages où des mesures existent (epoch ms), fichiers ASSIGNÉS à un point
 * seulement. `t` est en minutes depuis minuit de `f.date` et repart à 0 au
 * passage de minuit : une chute de `t` de plus de 12 h ajoute un jour. Un écart de plus de
 * 5 min entre deux points coupe la plage.
 */
export function plagesMesureDepuisFichiers(
  files: { id: string; date: string; data: { t: number }[] }[],
  pointMap: Record<string, string>,
): Intervalle[] {
  const out: Intervalle[] = []
  const ECART_MAX = 5 * 60_000
  for (const f of files) {
    if (!pointMap[f.id] || f.data.length === 0) continue
    const m = f.date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) continue
    const base = new Date(+m[1], +m[2] - 1, +m[3]).getTime()
    let jours = 0
    let tPrec = f.data[0].t
    let debut = base + tPrec * 60_000
    let prec = debut
    for (let i = 1; i < f.data.length; i++) {
      const t = f.data[i].t
      // Passage de minuit = chute de plus de 12 h (pas un simple désordre local).
      if (t < tPrec - 720) jours++
      tPrec = t
      const ts = base + (t + jours * 1440) * 60_000
      if (ts - prec > ECART_MAX) {
        out.push({ startMs: debut, endMs: prec + 60_000 })
        debut = ts
      }
      prec = ts
    }
    out.push({ startMs: debut, endMs: prec + 60_000 })
  }
  return out
}

/** Horodatage ISO → « AAAA-MM-JJ HH:MM » (heure locale), ou « inconnue ». */
export function fmtHorodatage(iso: string | null): string {
  if (!iso) return 'inconnue'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'inconnue'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Motif d'exclusion en une phrase — panneau des périodes ET rapport disent
 * exactement la même chose.
 */
export function resumeMotif(m: MotifMeteo): string {
  return (
    `${LIBELLE_NIVEAU_EXCLUSION[m.niveau]} — ${m.raisons.join(' ; ')} · ` +
    `${origineMotif(m)}, données récupérées le ${fmtHorodatage(m.fetchedAt)} · ` +
    `validée le ${fmtHorodatage(m.valideLe)} · s'applique à tous les points de mesure`
  )
}

/**
 * Tableau du rapport — « Périodes exclues pour motif météo ». Ne liste que les
 * périodes RÉELLEMENT exclues : motif météo présent ET catégorie en mode
 * `exclude` ET visible (une catégorie masquée neutralise ses périodes).
 * Colonnes : période, bornes, niveau, raisons, source et point, récupération.
 * Vide s'il n'y en a aucune.
 */
export function tableauExclusionsMeteo(periods: Period[], categories: Category[]): string[] {
  const actives = periods
    .filter((p) => p.motifMeteo)
    .filter((p) => {
      const c = categories.find((x) => x.id === p.categoryId)
      return c?.mode === 'exclude' && c.visible
    })
    .sort((a, b) => a.startMs - b.startMs)
  if (actives.length === 0) return []
  const lignes = [
    'Périodes exclues pour motif météo (suggérées par la recevabilité §3.6, validées) :',
    'Période | Bornes | Niveau | Raisons | Source · point | Données récupérées le',
  ]
  for (const p of actives) {
    const m = p.motifMeteo!
    const fin = fmtHorodatage(new Date(p.endMs).toISOString())
    const debut = fmtHorodatage(new Date(p.startMs).toISOString())
    const bornes = debut.slice(0, 10) === fin.slice(0, 10) ? `${debut} → ${fin.slice(11)}` : `${debut} → ${fin}`
    lignes.push(
      [p.name, bornes, LIBELLE_NIVEAU_EXCLUSION[m.niveau], m.raisons.join(' ; '), `${m.sourceLabel} · ${m.pointLabel}`, fmtHorodatage(m.fetchedAt)].join(' | '),
    )
  }
  lignes.push("Ces périodes s'appliquent à tous les points de mesure ; chacune est établie d'après la météo du point indiqué.")
  return lignes
}
