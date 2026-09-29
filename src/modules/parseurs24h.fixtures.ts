/**
 * Fixtures du golden des parseurs sur des relevés de PLUS DE 24 h (#19).
 *
 * Données SYNTHÉTIQUES déterministes, au format des exports réels (en-têtes,
 * marqueur « Début », décimales virgule, datetime à double espace des CSV
 * 821SE). Chaque détecteur a son relevé qui traverse minuit, plus deux relevés
 * qui traversent un changement d'heure (horodatage en heure MURALE, comme un
 * sonomètre qui suit l'heure légale) :
 *   - printemps : l'horloge saute de 01:59 à 03:00 (aucune heure 02:xx) ;
 *   - automne : l'horloge repasse de 01:59 à 01:00 (heure 01:xx vue deux fois).
 *
 * Utilisées par scripts/golden-parseurs-24h (qui fige la sortie AVANT la
 * correction de #19) et par parseurs24h.golden.test.ts.
 */
import * as XLSX from 'xlsx'

/** Instant en heure murale, sans fuseau (ce qu'écrit le sonomètre). */
export interface Murale { a: number; mo: number; j: number; h: number; mi: number; s: number }

const murale = (a: number, mo: number, j: number, h = 0, mi = 0, s = 0): Murale => ({ a, mo, j, h, mi, s })
/** Heure murale → millisecondes « naïves » (UTC utilisé comme horloge sans fuseau). */
const naif = (m: Murale) => Date.UTC(m.a, m.mo - 1, m.j, m.h, m.mi, m.s)
const deNaif = (ms: number): Murale => {
  const d = new Date(ms)
  return murale(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())
}

/** Jours sériels Excel d'une heure murale (1900, base 25569 = 1970-01-01). */
export const serielExcel = (m: Murale) => 25569 + naif(m) / 86_400_000
const p2 = (n: number) => String(n).padStart(2, '0')
/** « 2025-07-03  11:13:42 » (double espace, comme les CSV 821SE). */
export const texteCsv = (m: Murale) => `${m.a}-${p2(m.mo)}-${p2(m.j)}  ${p2(m.h)}:${p2(m.mi)}:${p2(m.s)}`

/**
 * Horodatages muraux de `debut` (inclus) à `fin` (exclu), au pas `pasS`.
 * `sauter` : plage murale [de, a[ absente (passage à l'heure d'été).
 * `doubler` : plage murale [de, a[ émise deux fois de suite (retour à l'heure normale).
 */
export function horloge(
  debut: Murale, fin: Murale, pasS: number,
  opts: { sauter?: [Murale, Murale]; doubler?: [Murale, Murale] } = {},
): Murale[] {
  const out: Murale[] = []
  const f = naif(fin)
  const dans = (ms: number, r?: [Murale, Murale]) => !!r && ms >= naif(r[0]) && ms < naif(r[1])
  for (let ms = naif(debut); ms < f; ms += pasS * 1000) {
    if (dans(ms, opts.sauter)) continue
    out.push(deNaif(ms))
    // Fin de la plage doublée : on réémet toute la plage une seconde fois.
    if (opts.doubler && ms + pasS * 1000 === naif(opts.doubler[1])) {
      for (let r = naif(opts.doubler[0]); r < naif(opts.doubler[1]); r += pasS * 1000) out.push(deNaif(r))
    }
  }
  return out
}

/** Niveaux déterministes, arrondis au 0,1 dB comme un export. */
const r1 = (x: number) => Math.round(x * 10) / 10
export const laeqDe = (i: number) => r1(55 + 8 * Math.sin(i / 37) + 3 * Math.cos(i / 5.3))
const virgule = (x: number) => String(x).replace('.', ',')

/** Encodage cp1252 (accents du format ∈ 0xE0-0xFF = même code que l'Unicode). */
const cp1252 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

// ── Constructeurs par format ────────────────────────────────────────────────

/** CSV 821SE « Date / heure » combinée (détecteur g4-fr-datetime-combine). */
function csvDateHeure(temps: Murale[]): Blob {
  const q = (v: string) => (v.includes(',') ? `"${v}"` : v)
  const lignes = [['Type d\'enregistrement', 'Date / heure', 'LAeq', 'LCeq', 'LAFmax', 'LAImax'].join(',')]
  temps.forEach((m, i) => {
    const l = laeqDe(i)
    // 1re ligne : marqueur « Début » (le vrai export y met aussi des mesures).
    lignes.push([i === 0 ? 'Début' : '', texteCsv(m), virgule(l), virgule(r1(l + 9)), virgule(r1(l + 1.5)), virgule(r1(l + 2.5))].map(q).join(','))
  })
  return new Blob([cp1252(lignes.join('\r\n'))])
}

function classeur(feuilles: [string, unknown[][]][]): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [nom, aoa] of feuilles) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nom)
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** xlsx G4 français, Date et Temps séparés (détecteur g4-fr), date data-first. */
function xlsxG4Fr(temps: Murale[]): ArrayBuffer {
  const lignes: unknown[][] = [['Record #', 'Type d\'enregistrement', 'Date', 'Temps', 'LAeq', 'LAFmax', 'LAImax', 'LCeq']]
  temps.forEach((m, i) => {
    const s = serielExcel(m), l = laeqDe(i)
    lignes.push([i + 1, i === 0 ? 'Départ' : '', s, s, l, r1(l + 1.5), r1(l + 2.5), r1(l + 9)])
  })
  return classeur([['Sommaire', [['', ''], ['Modèle', '821SE'], ['Série', '40488']]], ['Historique temporel', lignes]])
}

/** xlsx 821SE « Date / heure » combinée, sérielle (détecteur g4-fr-datetime-combine). */
function xlsxDateHeure(temps: Murale[]): ArrayBuffer {
  const lignes: unknown[][] = [['Type d\'enregistrement', 'Date / heure', 'LAeq', 'LCeq', 'LAFmax', 'LAImax']]
  temps.forEach((m, i) => {
    const l = laeqDe(i)
    lignes.push([i === 0 ? 'Début' : '', serielExcel(m), l, r1(l + 9), r1(l + 1.5), r1(l + 2.5)])
  })
  return classeur([['Résumé', [['', ''], ['Modèle', '821SE'], ['Série', '40489']]], ['Histoire du temps', lignes]])
}

/** xlsx G4 anglais (détecteur g4-en), date SUMMARY-FIRST (Summary!B4). */
function xlsxG4En(temps: Murale[], debutSommaire: string): ArrayBuffer {
  const lignes: unknown[][] = [['Record #', 'Record Type', 'Date', 'Time', 'LAeq', 'LAFmax', 'LAImax', 'LCeq']]
  temps.forEach((m, i) => {
    const s = serielExcel(m), l = laeqDe(i)
    lignes.push([i + 1, '', s, s, l, r1(l + 1.5), r1(l + 2.5), r1(l + 9)])
  })
  return classeur([
    ['Summary', [['', ''], ['Model', '831C'], ['Serial', '12782'], ['Start', debutSommaire], ['Stop', '']]],
    ['Time History', lignes],
  ])
}

// ── Cas ─────────────────────────────────────────────────────────────────────

export type SourceFixture = { kind: 'csv'; blob: Blob } | { kind: 'xlsx'; buffer: ArrayBuffer }

export interface CasParseur24h {
  id: string
  titre: string
  nom: string
  source: () => SourceFixture
}

// 31 h au pas de 60 s : du 3 juillet 18:00 au 5 juillet 01:00 (DEUX minuits traversés).
const T31 = () => horloge(murale(2025, 7, 3, 18), murale(2025, 7, 5, 1), 60)

export const CAS_PARSEURS_24H: CasParseur24h[] = [
  {
    id: 'csv-date-heure-31h', titre: 'CSV 821SE « Date / heure », 31 h, pas 60 s, deux minuits',
    nom: '821SE_40489-250703000-180000_Histoire_du_temps.csv',
    source: () => ({ kind: 'csv', blob: csvDateHeure(T31()) }),
  },
  {
    id: 'xlsx-date-heure-31h', titre: 'xlsx 821SE « Date / heure » sérielle, 31 h, pas 60 s, deux minuits',
    nom: '821SE 40489-250703000-180000.xlsx',
    source: () => ({ kind: 'xlsx', buffer: xlsxDateHeure(T31()) }),
  },
  {
    id: 'xlsx-g4-fr-31h', titre: 'xlsx G4-FR Date + Temps séparés, 31 h, pas 60 s, deux minuits',
    nom: '821SE 40488-250703000-180000.xlsx',
    source: () => ({ kind: 'xlsx', buffer: xlsxG4Fr(T31()) }),
  },
  {
    id: 'xlsx-g4-en-31h', titre: 'xlsx G4-EN (831C), date du Summary = date des données, 31 h, deux minuits',
    nom: '831C_12782-20250703 180000.xlsx',
    source: () => ({ kind: 'xlsx', buffer: xlsxG4En(T31(), '2025-07-03 18:00:00') }),
  },
  {
    // Date summary-first : le Summary annonce la veille (démarrage à 23:59, première
    // donnée retenue après minuit). Aujourd'hui `t` est relatif à minuit du jour de
    // la donnée mais `date` vient du Summary : écart d'un jour à figer.
    id: 'xlsx-g4-en-sommaire-veille', titre: 'xlsx G4-EN, Summary daté de la veille des premières données',
    nom: '831C_12782-20250702 235900.xlsx',
    source: () => ({ kind: 'xlsx', buffer: xlsxG4En(horloge(murale(2025, 7, 3, 0, 30), murale(2025, 7, 4, 6), 60), '2025-07-02 23:59:00') }),
  },
  {
    id: 'csv-heure-ete', titre: 'CSV, nuit du passage à l’heure d’été (8 mars 2026) : aucune heure 02:xx',
    nom: '821SE_40489-260307000-220000_Histoire_du_temps.csv',
    source: () => ({
      kind: 'csv',
      blob: csvDateHeure(horloge(murale(2026, 3, 7, 22), murale(2026, 3, 8, 6), 60, { sauter: [murale(2026, 3, 8, 2), murale(2026, 3, 8, 3)] })),
    }),
  },
  {
    id: 'csv-heure-normale', titre: 'CSV, nuit du retour à l’heure normale (2 nov. 2025) : heure 01:xx vue deux fois',
    nom: '821SE_40489-251101000-220000_Histoire_du_temps.csv',
    source: () => ({
      kind: 'csv',
      blob: csvDateHeure(horloge(murale(2025, 11, 1, 22), murale(2025, 11, 2, 4), 60, { doubler: [murale(2025, 11, 2, 1), murale(2025, 11, 2, 2)] })),
    }),
  },
]
