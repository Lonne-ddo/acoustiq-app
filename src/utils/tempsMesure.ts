/**
 * Temps d'une mesure en TEMPS ABSOLU NON REPLIÉ (#19, option A — lot 19.1).
 * Fonctions PURES, sans consommateur au lot 19.1 : les lots 19.2 à 19.6 y
 * basculent le code qui recalcule aujourd'hui « minuit + t × 60 000 » à la main.
 *
 * Repère : un échantillon est `(date, t)` — `date` « AAAA-MM-JJ » (date du
 * fichier) et `t` en minutes d'HEURE MURALE depuis minuit de cette date. `t` peut
 * dépasser 1440 (le lendemain à 01:00 = 1500) : il n'est jamais replié.
 *
 * A1 — heure murale : un sonomètre horodate en heure légale ; une mesure prise à
 * 3 h le jour du changement d'heure est à 3 h. L'instant absolu est donc celui de
 * `new Date(a, m, j, 0, t)`, et non « minuit + t × 60 000 » qui décale d'une heure
 * tout ce qui suit le changement, deux fois par an.
 *
 * Deux faits de DONNÉE, jamais masqués (voir `statutMural`) :
 *   - « ambigu » : au retour à l'heure normale, l'heure 01:xx existe deux fois.
 *     Deux échantillons de même horodatage mural sont alors deux mesures
 *     distinctes : à signaler, jamais fusionner, jamais refuser en silence.
 *   - « inexistant » : au passage à l'heure d'été, 02:xx n'existe pas.
 *
 * Tout ce qui dépend du fuseau passe par `instantMs` / `statutMural` (fuseau du
 * moteur JS). Le reste (dates civiles, fenêtres, clé) est de l'arithmétique de
 * calendrier, indépendante du fuseau.
 */

const MIN_MS = 60_000
const JOUR_MS = 86_400_000

/** « AAAA-MM-JJ » → minuit UTC en ms (horloge sans fuseau), ou NaN si la date n'existe pas. */
function minuitNaifMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return NaN
  const a = +m[1], mo = +m[2], j = +m[3]
  const ms = Date.UTC(a, mo - 1, j)
  const d = new Date(ms)
  // Rejette les dates que le calendrier « corrigerait » (2025-02-30 → 2 mars).
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== j) return NaN
  return ms
}

const p2 = (n: number) => String(n).padStart(2, '0')
function naifVersDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
}

const decalageMin = (ms: number) => new Date(ms).getTimezoneOffset()

/**
 * Instants absolus (epoch ms) qui s'affichent `(date, t)` en heure murale locale,
 * du plus ancien au plus récent : 1 en temps normal, 2 dans l'heure répétée, 0
 * dans l'heure sautée. `null` si `date` ou `t` est illisible.
 *
 * Calcul : `minuit local + t × 60 000 + (décalage à l'instant − décalage à
 * minuit)`. Hors changement d'heure le terme correctif vaut 0 et le résultat est
 * identique AU BIT PRÈS à `dpTimestampMs` (même addition flottante).
 *
 * Le décalage applicable est tranché à la SECONDE de l'horodatage (résolution de
 * `cleSeconde`), pas sur `t` brut : la gigue du flottant des parseurs lit 02:00
 * « 01:59:59,9999998 », qui tomberait sinon dans l'heure répétée et serait placé
 * une heure trop tôt.
 */
function instantsMuraux(date: string, t: number): { base: number; x: number; xs: number; offMinuit: number; instants: number[] } | null {
  const naif = minuitNaifMs(date)
  if (!Number.isFinite(naif) || !Number.isFinite(t)) return null
  const [a, mo, j] = date.split('-').map(Number)
  const base = new Date(a, mo - 1, j).getTime()
  const offMinuit = decalageMin(base)
  const x = t * MIN_MS
  const xs = Math.round(t * 60) * 1000
  const approx = base + xs
  // Décalages possibles autour de l'instant : un changement d'heure au plus par jour.
  const candidats = [...new Set([decalageMin(approx - JOUR_MS), decalageMin(approx), decalageMin(approx + JOUR_MS)])]
  const instants: number[] = []
  for (const o of candidats) {
    if (decalageMin(approx + (o - offMinuit) * MIN_MS) !== o) continue
    const e = o === offMinuit ? base + x : base + x + (o - offMinuit) * MIN_MS
    if (!instants.includes(e)) instants.push(e)
  }
  instants.sort((p, q) => p - q)
  return { base, x, xs, offMinuit, instants }
}

export type StatutMural = 'normal' | 'ambigu' | 'inexistant'

/**
 * Statut de l'horodatage mural `(date, t)` dans le fuseau local : 'ambigu' dans
 * l'heure répétée du retour à l'heure normale, 'inexistant' dans l'heure sautée
 * du passage à l'heure d'été — tranché à la seconde de l'horodatage. `null` si
 * l'entrée est illisible (échec technique, distinct de ces deux faits de donnée).
 */
export function statutMural(date: string, t: number): StatutMural | null {
  const r = instantsMuraux(date, t)
  if (!r) return null
  return r.instants.length === 1 ? 'normal' : r.instants.length === 2 ? 'ambigu' : 'inexistant'
}

/**
 * Vrai si l'horodatage mural `(date, t)` tombe dans l'heure répétée du retour à
 * l'heure normale : deux mesures distinctes peuvent y partager le même
 * horodatage (et la même `cleSeconde`). À signaler, jamais fusionner.
 */
export function heureAmbigue(date: string, t: number): boolean {
  return statutMural(date, t) === 'ambigu'
}

/**
 * Instant absolu (epoch ms) de l'horodatage mural `(date, t)` — A1. Même résultat
 * que `new Date(a, m − 1, j, 0, 0, 0, t × 60 000)` : dans l'heure répétée, la
 * PREMIÈRE occurrence ; dans l'heure sautée, l'heure lue avec le décalage d'avant
 * le changement (02:30 → 03:30). NaN si `date` ou `t` est illisible — jamais 0.
 */
export function instantMs(date: string, t: number): number {
  const r = instantsMuraux(date, t)
  if (!r) return NaN
  if (r.instants.length > 0) return r.instants[0]
  const avant = decalageMin(r.base + r.xs - JOUR_MS)
  return r.base + r.x + (avant - r.offMinuit) * MIN_MS
}

/**
 * Date civile et minute du jour (0 ≤ minute < 1440) de `(date, t)`, par calcul
 * de calendrier (indépendant du fuseau). `null` si l'entrée est illisible.
 * Ex. : ('2025-07-03', 1500) → { date: '2025-07-04', minute: 60 }.
 */
export function dateEtMinute(date: string, t: number): { date: string; minute: number } | null {
  const naif = minuitNaifMs(date)
  if (!Number.isFinite(naif) || !Number.isFinite(t)) return null
  const jours = Math.floor(t / 1440)
  return { date: naifVersDate(naif + jours * JOUR_MS), minute: t - jours * 1440 }
}

/**
 * Nombre de jours de calendrier de `dateRef` à `date` (entier, signé), ou NaN.
 * Sert à exprimer un `t` dans le repère d'une autre date : aligner par clé
 * (la date), jamais par rang dans une liste de dates.
 */
export function decalageJours(dateRef: string, date: string): number {
  const a = minuitNaifMs(dateRef)
  const b = minuitNaifMs(date)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  return Math.round((b - a) / JOUR_MS)
}

/** `t` de `(date, t)` exprimé en minutes murales depuis minuit de `dateRef`. NaN si illisible. */
export function tDansRepere(dateRef: string, date: string, t: number): number {
  return t + decalageJours(dateRef, date) * 1440
}

/** Fenêtre absolue : [debutMin, finMin[ en minutes murales depuis minuit de `date`. */
export interface FenetreAbsolue {
  date: string
  debutMin: number
  finMin: number
}

function hhmmVersMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = +m[1], mi = +m[2]
  if (h > 24 || mi > 59 || (h === 24 && mi !== 0)) return null
  return h * 60 + mi
}

/**
 * Fenêtre [debut, fin[ commençant le jour `date`. Si `fin` ≤ `debut`, la fenêtre
 * se termine le LENDEMAIN (19:00 → 07:00 = de 19 h le jour J à 7 h le jour J+1) ;
 * `debut` = `fin` couvre 24 h. `null` si la date ou une heure est illisible.
 */
export function fenetreAbsolue(date: string, debutHHMM: string, finHHMM: string): FenetreAbsolue | null {
  if (!Number.isFinite(minuitNaifMs(date))) return null
  const d = hhmmVersMin(debutHHMM)
  const f = hhmmVersMin(finHHMM)
  if (d === null || f === null) return null
  return { date, debutMin: d, finMin: f > d ? f : f + 1440 }
}

/**
 * Vrai si l'échantillon `(dateFichier, t)` tombe dans la fenêtre [debut, fin[.
 * Les deux repères sont alignés par la date (`decalageJours`). Faux si `t` ou une
 * date est illisible (NaN ne tombe dans aucune fenêtre).
 */
export function dansFenetre(dateFichier: string, t: number, f: FenetreAbsolue): boolean {
  const tt = tDansRepere(f.date, dateFichier, t)
  return tt >= f.debutMin && tt < f.finMin
}

/**
 * Dates civiles distinctes (triées) touchées par les échantillons d'un fichier,
 * et nombre d'échantillons dont `t` est illisible (écartés, mais COMPTÉS).
 * NB : tant que le parseur replie `t` à minuit (avant le lot 19.6), un relevé de
 * 30 h ne renvoie que sa date de début.
 */
export function datesCouvertes(f: { date: string; data: readonly { t: number }[] }): { dates: string[]; tIllisibles: number } {
  const dates = new Set<string>()
  let tIllisibles = 0
  if (!Number.isFinite(minuitNaifMs(f.date))) return { dates: [], tIllisibles: f.data.length }
  for (const d of f.data) {
    const r = dateEtMinute(f.date, d.t)
    if (r) dates.add(r.date)
    else tIllisibles++
  }
  return { dates: [...dates].sort(), tIllisibles }
}

/**
 * Clé temporelle ENTIÈRE à la seconde de `(date, t)` : secondes murales depuis
 * 1970-01-01 00:00 en horloge sans fuseau. Indépendante du fuseau, donc la même
 * sur tous les postes. Deux mesures de l'heure répétée (`heureAmbigue`) ont la
 * même clé : c'est un fait de donnée à signaler, pas un doublon. NaN si illisible.
 */
export function cleSeconde(date: string, t: number): number {
  const naif = minuitNaifMs(date)
  if (!Number.isFinite(naif) || !Number.isFinite(t)) return NaN
  return naif / 1000 + Math.round(t * 60)
}
