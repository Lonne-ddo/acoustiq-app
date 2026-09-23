/**
 * Cas du golden de la fenêtre LAr,1h (Conformité 2026). Données SYNTHÉTIQUES
 * déterministes, construites pour exercer chaque chemin : couverture complète,
 * les quatre causes de minutes manquantes (exclusion manuelle, exclusion
 * météo, hors période d'inclusion, absence de données), catégorie masquée, pas
 * d'échantillonnage mixtes, fichiers qui se recouvrent, fenêtre à cheval sur
 * minuit, Bp (ok / Br absent / insuffisant), termes K manuels et Ks.
 *
 * Utilisé par le harnais qui fige le golden SUR MAIN (code d'origine extrait)
 * et par le test de non-régression de la fonction extraite.
 */
import { DEFAULT_CATEGORY_IDS, makeDefaultCategories, type Category, type DataPoint, type MeasurementFile, type Period } from '../types'

export interface EntreeFenetreCas {
  files: MeasurementFile[]
  pointMap: Record<string, string>
  selectedDate: string
  periods: Period[]
  categories: Category[]
  evalHour: string
  period: 'jour' | 'nuit'
  brJour: string
  brNuit: string
  receptor: 'I' | 'II' | 'III' | 'IV'
  ktManual: Record<string, number | null>
  kiManual: Record<string, number | null>
  ksEnabled: boolean
  ksValue: string
  ksReason: string
}

const DATE = '2026-07-07'
/** Bandes 1/3 d'octave d'un export 821SE (36 bandes, 6,3 Hz → 20 kHz). */
const FREQS = [6.3, 8, 10, 12.5, 16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000]

/** Niveau déterministe, arrondi au 0,1 dB comme un export. */
const niveau = (t: number, base: number) => Math.round((base + 6 * Math.sin(t / 3.7) + 2 * Math.cos(t / 0.9)) * 10) / 10

/** Fichier de `debutMin` à `finMin` (minutes depuis minuit de `date`), pas `pasS` secondes. */
export function fichier(id: string, debutMin: number, finMin: number, pasS: number, opts: { base?: number; spectres?: boolean; date?: string } = {}): MeasurementFile {
  const base = opts.base ?? 55
  const data: DataPoint[] = []
  const n = Math.round(((finMin - debutMin) * 60) / pasS)
  for (let i = 0; i < n; i++) {
    const t = debutMin + (i * pasS) / 60
    const laeq = niveau(t, base)
    const d: DataPoint = { t, laeq, lceq: Math.round((laeq + 9) * 10) / 10, laftEq: Math.round((laeq + 2.5) * 10) / 10 }
    if (opts.spectres) {
      // Spectre plat avec une émergence à 1 kHz : Kt exercé.
      d.spectra = FREQS.map((f) => (f === 1000 ? laeq + 12 : laeq - 8))
    }
    data.push(d)
  }
  return {
    id, name: `${id}.xlsx`, model: '831C', serial: '12782', date: opts.date ?? DATE,
    startTime: '', stopTime: '', rowCount: data.length, data,
    ...(opts.spectres ? { spectraFreqs: FREQS } : {}),
  } as MeasurementFile
}

const ms = (hhmm: string, date = DATE) => {
  const [y, mo, d] = date.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  return new Date(y, mo - 1, d, h, mi).getTime()
}
const periode = (id: string, de: string, a: string, categoryId: string, extra: Partial<Period> = {}): Period =>
  ({ id, name: id, startMs: ms(de), endMs: ms(a), categoryId, ...extra })

function base(over: Partial<EntreeFenetreCas> = {}): EntreeFenetreCas {
  const f = fichier('A', 13 * 60, 16 * 60, 1, { spectres: true })
  return {
    files: [f], pointMap: { A: 'BV-1' }, selectedDate: DATE, periods: [], categories: makeDefaultCategories(),
    evalHour: '14:00', period: 'jour', brJour: '40', brNuit: '35', receptor: 'I',
    ktManual: {}, kiManual: {}, ksEnabled: false, ksValue: '5', ksReason: '',
    ...over,
  }
}

const MOTIF = {
  niveau: 'bad' as const, heures: ['2026-07-07 14:00:00'], raisons: ['vent 30.0 km/h ≥ 20'], source: 'eccc', sourceLabel: 'Env. Canada',
  pointId: 'p0', pointLabel: 'BV-1', fetchedAt: null, request: null,
  seuils: { windMaxKmh: 20, precipMaxMm: 0, hrDryPct: 90, validiteTempMinC: -50, validiteTempMaxC: 50, validitePrecipMaxMm: 100, humiditeMode: 'aucun' as const, hrMaxPct: 90, roseeEcartMinC: 2 },
  asphalte: true, valideLe: '2026-09-23T19:00:00.000Z',
}

export const CAS_FENETRE: { id: string; titre: string; entree: () => EntreeFenetreCas }[] = [
  { id: 'complet', titre: 'fenêtre couverte 60/60, pas 1 s, spectres + LCeq + LAFTeq', entree: () => base() },
  {
    id: 'exclusion-manuelle', titre: 'exclusion manuelle 14:10–14:30',
    entree: () => base({ periods: [periode('m1', '14:10', '14:30', DEFAULT_CATEGORY_IDS.exclure)] }),
  },
  {
    id: 'exclusion-meteo', titre: 'exclusion météo (motif) 14:40–15:00',
    entree: () => base({ periods: [periode('meteo-excl-bad-1', '14:40', '15:00', DEFAULT_CATEGORY_IDS.exclure, { motifMeteo: MOTIF })] }),
  },
  {
    id: 'hors-inclusion', titre: 'période « Ambiant » 14:10–14:40 seulement (hors inclusion ailleurs)',
    entree: () => base({ periods: [periode('a1', '14:10', '14:40', DEFAULT_CATEGORY_IDS.ambiant)] }),
  },
  {
    id: 'causes-mixtes', titre: 'inclusion 14:05–14:50, exclusion manuelle 14:20–14:25, exclusion météo 14:30–14:35',
    entree: () => base({
      periods: [
        periode('a1', '14:05', '14:50', DEFAULT_CATEGORY_IDS.ambiant),
        periode('m1', '14:20', '14:25', DEFAULT_CATEGORY_IDS.exclure),
        periode('meteo-excl-bad-2', '14:30', '14:35', DEFAULT_CATEGORY_IDS.exclure, { motifMeteo: MOTIF }),
      ],
    }),
  },
  {
    id: 'categorie-masquee', titre: 'exclusion 14:10–14:30 dans une catégorie MASQUÉE (neutralisée)',
    entree: () => base({
      periods: [periode('m1', '14:10', '14:30', DEFAULT_CATEGORY_IDS.exclure)],
      categories: makeDefaultCategories().map((c) => (c.id === DEFAULT_CATEGORY_IDS.exclure ? { ...c, visible: false } : c)),
    }),
  },
  {
    id: 'absence-donnees', titre: 'fichier qui s’arrête à 14:35 (25 min sans données)',
    entree: () => base({ files: [fichier('A', 13 * 60, 14 * 60 + 35, 1, { spectres: true })] }),
  },
  {
    id: 'pas-mixtes', titre: 'deux fichiers : 1 s de 14:00 à 14:30, 60 s de 14:30 à 15:00',
    entree: () => base({ files: [fichier('A', 14 * 60, 14 * 60 + 30, 1), fichier('B', 14 * 60 + 30, 15 * 60, 60, { base: 60 })], pointMap: { A: 'BV-1', B: 'BV-1' } }),
  },
  {
    id: 'recouvrement', titre: 'deux fichiers qui se recouvrent sur 14:00–15:00',
    entree: () => base({ files: [fichier('A', 13 * 60, 16 * 60, 1), fichier('B', 14 * 60, 15 * 60, 1, { base: 58 })], pointMap: { A: 'BV-1', B: 'BV-1' } }),
  },
  {
    id: 'minuit', titre: 'fenêtre 23:30 sur un fichier de 26 h (00:00–26:00, t non repliés)',
    entree: () => base({ files: [fichier('A', 0, 26 * 60, 60)], evalHour: '23:30', period: 'nuit' }),
  },
  { id: 'sans-br', titre: 'Br absent (Bp non calculable)', entree: () => base({ brJour: '' }) },
  { id: 'br-insuffisant', titre: 'Br trop proche de Ba (Ba − Br = 2,4 dB < 3)', entree: () => base({ brJour: '55' }) },
  {
    id: 'k-manuels', titre: 'Kt et Ki manuels, Ks actif, nuit, récepteur III',
    entree: () => base({ ktManual: { 'BV-1': 3 }, kiManual: { 'BV-1': 2 }, ksEnabled: true, ksValue: '5', ksReason: 'tonalité connue', period: 'nuit', receptor: 'III' }),
  },
  { id: 'sans-donnees', titre: 'fenêtre 03:00, aucune donnée', entree: () => base({ evalHour: '03:00' }) },
  {
    id: 'deux-points', titre: 'deux points, même exclusion 14:45–15:00 (les périodes valent pour tous les points)',
    entree: () => base({
      files: [fichier('A', 13 * 60, 16 * 60, 1, { spectres: true }), fichier('B', 13 * 60, 16 * 60, 1, { base: 50 })],
      pointMap: { A: 'BV-1', B: 'BV-2' },
      periods: [periode('m1', '14:45', '15:00', DEFAULT_CATEGORY_IDS.exclure)],
    }),
  },
]
