import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import SuggestionsExclusionMeteo from '../components/meteo/SuggestionsExclusionMeteo'
import {
  suggererExclusions,
  periodesDepuisSuggestions,
  plagesMesureDepuisFichiers,
  tableauExclusionsMeteo,
  resumeMotif,
  origineMotif,
} from './exclusionMeteo'
import { makeDefaultMeteoState, type MeteoModuleState } from './meteoModule'
import { parseHourTimestamp, type MeteoHourRow } from './recevabilite'
import type { SourceResult, SourceError, SourceId, MeteoRequest } from './meteoSources'
import { makeDefaultCategories, normalizeProjectPeriods, DEFAULT_CATEGORY_IDS, type Period, type Category } from '../types'
import { buildFullProjectData, recentStateJson, loadProject } from '../modules/projectManager'
import { serializeProject, deserializeProject } from '../modules/dataverseProjectStore'
import { DEFAULT_METEO } from '../types'

const H = 3_600_000
const ms = (dt: string) => parseHourTimestamp(dt).getTime()
const row = (datetime: string, o: Partial<MeteoHourRow> = {}): MeteoHourRow => ({
  datetime, temperature: 20, humidity: 60, precipitation: 0, windSpeed: 5, windDirection: 180, ...o,
})
const REQ: MeteoRequest = { lat: 45.5, lng: -73.6, startDate: '2025-07-03', endDate: '2025-07-03', chosenClimateId: null, isArchive: true, timezone: 'America/Toronto' }
const ok = (source: SourceId, rows: MeteoHourRow[]): SourceResult => ({
  source, rows, station: { name: 'S', lat: 45.5, lng: -73.6, distanceKm: 1 }, sourceUrl: 'x', sourceLabel: 'x',
  isArchive: true, timezone: 'America/Toronto', fetchedAt: '2026-09-23T18:00:00.000Z', request: { ...REQ },
})
const ko = (source: SourceId): SourceError => ({ source, error: 'HTTP 503' })

// 08 ok · 09-10 bad (vent) · 11 warn (chaussée gelée) · 12 indéterminé · 13 bad (précip.) · 14 ok
const JOUR: MeteoHourRow[] = [
  row('2025-07-03 08:00:00'),
  row('2025-07-03 09:00:00', { windSpeed: 30 }),
  row('2025-07-03 10:00:00', { windSpeed: 25 }),
  row('2025-07-03 11:00:00', { temperature: -5, humidity: 99 }),
  row('2025-07-03 12:00:00', { temperature: 70 }),
  row('2025-07-03 13:00:00', { precipitation: 0.5 }),
  row('2025-07-03 14:00:00'),
]
// Le point 2 (gem) : seule 16 h est non recevable.
const AUTRE: MeteoHourRow[] = [row('2025-07-03 15:00:00'), row('2025-07-03 16:00:00', { windSpeed: 40 })]

function etat(): MeteoModuleState {
  const s = makeDefaultMeteoState()
  s.points = [{ ...s.points[0], id: 'p0', label: 'BV-1' }, { ...s.points[0], id: 'p1', label: 'BV-2' }]
  s.results = [
    { pointId: 'p0', outcomes: [ok('eccc', JOUR)] },
    { pointId: 'p1', outcomes: [ko('openmeteo'), ok('gem', AUTRE)] },
  ]
  return s
}
const CATS = makeDefaultCategories()
const MESURE = [{ startMs: ms('2025-07-03 00:00:00'), endMs: ms('2025-07-04 00:00:00') }]
const SEL = { pointId: 'p0', source: 'eccc' as SourceId }

describe('suggererExclusions — la météo SUGGÈRE', () => {
  const r = suggererExclusions(etat(), SEL, [], CATS, MESURE)!

  it('ni « recevable » ni « à signaler » ; « non recevable » et « indéterminé » en motifs DISTINCTS, jamais fusionnés', () => {
    expect(r.suggestions.map((s) => [s.niveau, s.startMs, s.endMs])).toEqual([
      ['bad', ms('2025-07-03 09:00:00'), ms('2025-07-03 11:00:00')], // 09-10 fusionnées (même niveau)
      ['indetermine', ms('2025-07-03 12:00:00'), ms('2025-07-03 13:00:00')],
      ['bad', ms('2025-07-03 13:00:00'), ms('2025-07-03 14:00:00')], // contiguë mais autre niveau : séparée
    ])
    expect(r.suggestions.some((s) => s.heures.includes('2025-07-03 11:00:00'))).toBe(false) // warn
  })

  it('granularité : l’HEURE MÉTÉO EXACTE ; raisons dédupliquées par suggestion', () => {
    for (const s of r.suggestions) expect((s.endMs - s.startMs) % H).toBe(0)
    expect(r.suggestions[0].raisons).toEqual(['vent 30.0 km/h ≥ 20', 'vent 25.0 km/h ≥ 20'])
  })

  it('SOURCE DE VÉRITÉ : la sélection de l’onglet Météo (point 2, GEM), pas le premier point', () => {
    const r2 = suggererExclusions(etat(), { pointId: 'p1', source: 'gem' }, [], CATS, MESURE)!
    expect(r2.contexte).toMatchObject({ pointLabel: 'BV-2', source: 'gem', sourceLabel: 'GEM Canada' })
    expect(r2.suggestions.map((s) => s.heures)).toEqual([['2025-07-03 16:00:00']])
  })

  it('une heure SANS mesure n’est pas suggérée', () => {
    const matin = [{ startMs: ms('2025-07-03 08:00:00'), endMs: ms('2025-07-03 10:30:00') }]
    const r3 = suggererExclusions(etat(), SEL, [], CATS, matin)!
    expect(r3.suggestions.map((s) => s.heures)).toEqual([['2025-07-03 09:00:00', '2025-07-03 10:00:00']])
  })

  it('pas de données météo → null (fait de donnée, pas une erreur)', () => {
    expect(suggererExclusions(makeDefaultMeteoState(), SEL, [], CATS, MESURE)).toBeNull()
  })
})

describe('validation — rien n’est appliqué seul, rien n’est écrasé', () => {
  it('seules les suggestions COCHÉES deviennent des périodes ; aucune cochée → aucune période', () => {
    const r = suggererExclusions(etat(), SEL, [], CATS, MESURE)!
    expect(periodesDepuisSuggestions([], r.contexte, etat(), new Date())).toEqual([])
    const p = periodesDepuisSuggestions([r.suggestions[1]], r.contexte, etat(), new Date())
    expect(p).toHaveLength(1)
    expect(p[0].categoryId).toBe(DEFAULT_CATEGORY_IDS.exclure)
  })

  it('une exclusion MANUELLE couvrant l’heure : l’heure n’est pas reproposée, la période manuelle reste intacte', () => {
    const manuelle: Period = { id: 'm1', name: 'Chantier voisin', startMs: ms('2025-07-03 12:00:00'), endMs: ms('2025-07-03 12:00:00') + H, categoryId: DEFAULT_CATEGORY_IDS.exclure }
    const periodes = [manuelle]
    const copie = structuredClone(periodes)
    const r = suggererExclusions(etat(), SEL, periodes, CATS, MESURE)!
    expect(r.suggestions.some((s) => s.niveau === 'indetermine')).toBe(false)
    expect(periodes).toEqual(copie) // rien de modifié
  })

  it('une période INCLUSE à cheval sur 08-10 h n’est pas touchée ; seule l’heure 09 h est proposée', () => {
    const incluse: Period = { id: 'i1', name: 'Ambiant', startMs: ms('2025-07-03 08:30:00'), endMs: ms('2025-07-03 09:30:00'), categoryId: DEFAULT_CATEGORY_IDS.ambiant }
    const r = suggererExclusions(etat(), SEL, [incluse], CATS, MESURE)!
    expect(r.suggestions[0].startMs).toBe(ms('2025-07-03 09:00:00'))
    expect(incluse.startMs).toBe(ms('2025-07-03 08:30:00'))
  })

  it('DEUXIÈME PASSAGE : ce qui a été appliqué n’est plus proposé (pas de doublon)', () => {
    const r = suggererExclusions(etat(), SEL, [], CATS, MESURE)!
    const appliquees = periodesDepuisSuggestions(r.suggestions, r.contexte, etat(), new Date())
    const r2 = suggererExclusions(etat(), SEL, appliquees, CATS, MESURE)!
    expect(r2.suggestions).toEqual([])
    expect(new Set(appliquees.map((p) => p.id)).size).toBe(appliquees.length)
  })
})

describe('motif persisté — dire pourquoi, six mois plus tard', () => {
  const s = etat()
  const r = suggererExclusions(s, SEL, [], CATS, MESURE)!
  const [p] = periodesDepuisSuggestions([r.suggestions[0]], r.contexte, s, new Date('2026-09-23T19:00:00Z'))

  it('niveau, raisons, heures, source, point, fetchedAt, request, seuils, asphalte, validation', () => {
    expect(p.motifMeteo).toMatchObject({
      niveau: 'bad', heures: ['2025-07-03 09:00:00', '2025-07-03 10:00:00'], raisons: ['vent 30.0 km/h ≥ 20', 'vent 25.0 km/h ≥ 20'],
      source: 'eccc', sourceLabel: 'Env. Canada', pointId: 'p0', pointLabel: 'BV-1',
      fetchedAt: '2026-09-23T18:00:00.000Z', request: REQ, asphalte: true, valideLe: '2026-09-23T19:00:00.000Z',
    })
    expect(p.motifMeteo!.seuils).toEqual(s.recevabiliteConfig)
    expect(p.motifMeteo!.seuils).not.toBe(s.recevabiliteConfig) // copie : les seuils peuvent changer ensuite
  })

  it('la portée est dite : « d’après la météo du point BV-1 », tous les points de mesure', () => {
    expect(origineMotif(p.motifMeteo!)).toBe("d'après la météo du point BV-1 (Env. Canada)")
    expect(p.notes).toContain("d'après la météo du point BV-1")
    expect(resumeMotif(p.motifMeteo!)).toContain("s'applique à tous les points de mesure")
  })

  it('Dataverse (blob v3) : le motif revient intact après normalisation', () => {
    const gz = serializeProject(buildFullProjectData({ files: [], pointMap: {}, events: [], concordance: {}, periods: [p], categories: CATS }))
    const { schemaVersion, project } = deserializeProject(gz)
    expect(schemaVersion).toBe(3)
    expect(normalizeProjectPeriods(project.categories, project.periods).periods[0].motifMeteo).toEqual(p.motifMeteo)
  })

  it('fichier JSON et projets récents : le motif revient intact', () => {
    const json = JSON.stringify({ version: '1.3', files: [], pointAssignments: {}, events: [], concordance: {}, periods: [p], categories: CATS })
    const { project } = loadProject(json, [])
    expect(normalizeProjectPeriods(project.categories, project.periods).periods[0].motifMeteo).toEqual(p.motifMeteo)
    const recent = JSON.parse(recentStateJson({
      files: [], pointMap: {}, events: [], concordance: {}, mapImage: null, mapMarkers: {}, meteo: DEFAULT_METEO,
      checklist: {} as never, categories: CATS, periods: [p], meteoModule: makeDefaultMeteoState(), projectNumber: '',
    }))
    expect(normalizeProjectPeriods(recent.categories, recent.periods).periods[0].motifMeteo).toEqual(p.motifMeteo)
  })

  it('projet ANTÉRIEUR (période sans motif) : se recharge sans motif ; motif malformé ignoré', () => {
    const { periods } = normalizeProjectPeriods(CATS, [
      { id: 'a', name: 'Ancienne', startMs: 1, endMs: 2, categoryId: DEFAULT_CATEGORY_IDS.exclure },
      { id: 'b', name: 'Abîmée', startMs: 1, endMs: 2, categoryId: DEFAULT_CATEGORY_IDS.exclure, motifMeteo: { niveau: 'warn' } },
    ])
    expect(periods.map((x) => x.motifMeteo)).toEqual([undefined, undefined])
    expect('motifMeteo' in periods[0]).toBe(false)
  })
})

describe('rapport — tableau des périodes exclues pour motif météo', () => {
  const s = etat()
  const r = suggererExclusions(s, SEL, [], CATS, MESURE)!
  const periodes = periodesDepuisSuggestions(r.suggestions, r.contexte, s, new Date('2026-09-23T19:00:00Z'))

  it('une ligne par période exclue : période, bornes, niveau, raisons, source · point, récupération', () => {
    const t = tableauExclusionsMeteo(periodes, CATS)
    expect(t[1]).toBe('Période | Bornes | Niveau | Raisons | Source · point | Données récupérées le')
    expect(t).toHaveLength(2 + periodes.length + 1)
    expect(t[2]).toMatch(/^Météo non recevable — BV-1 \| 2025-07-03 09:00 → 11:00 \| Météo non recevable \| vent 30\.0 km\/h ≥ 20 ; vent 25\.0 km\/h ≥ 20 \| Env\. Canada · BV-1 \| \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(t[3]).toContain('Donnée météo aberrante')
  })

  it('seules les exclusions EFFECTIVES : catégorie masquée ou période passée en « inclure » → absente', () => {
    const masquee: Category[] = CATS.map((c) => (c.id === DEFAULT_CATEGORY_IDS.exclure ? { ...c, visible: false } : c))
    expect(tableauExclusionsMeteo(periodes, masquee)).toEqual([])
    const deplacee = periodes.map((p, i) => (i === 0 ? { ...p, categoryId: DEFAULT_CATEGORY_IDS.ambiant } : p))
    expect(tableauExclusionsMeteo(deplacee, CATS)).toHaveLength(2 + periodes.length - 1 + 1)
    expect(tableauExclusionsMeteo([], CATS)).toEqual([])
  })
})

describe('plagesMesureDepuisFichiers', () => {
  it('fichiers assignés seulement ; passage de minuit ; trou > 5 min coupe la plage', () => {
    const f = { id: 'f', date: '2025-07-03', data: [{ t: 1430 }, { t: 1435 }, { t: 0 }, { t: 5 }, { t: 60 }] }
    const plages = plagesMesureDepuisFichiers([f, { id: 'libre', date: '2025-07-03', data: [{ t: 0 }] }], { f: 'BV-1' })
    expect(plages).toEqual([
      { startMs: ms('2025-07-03 23:50:00'), endMs: ms('2025-07-04 00:06:00') },
      { startMs: ms('2025-07-04 01:00:00'), endMs: ms('2025-07-04 01:01:00') },
    ])
  })
})

describe('composant de validation (rendu statique)', () => {
  it('sans données météo : rien ; avec : un bouton qui annonce le nombre de suggestions, fermé par défaut', () => {
    const vide = renderToStaticMarkup(createElement(SuggestionsExclusionMeteo, { resultat: null, onAppliquer: () => {} }))
    expect(vide).toBe('')
    const r = suggererExclusions(etat(), SEL, [], CATS, MESURE)!
    const html = renderToStaticMarkup(createElement(SuggestionsExclusionMeteo, { resultat: r, onAppliquer: () => {} }))
    expect(html).toContain(`Proposer les exclusions météo (${r.suggestions.length})`)
    expect(html).not.toContain('Appliquer (') // rien d'appliquable tant que la liste n'est pas ouverte et cochée
  })
})

describe('câblage (vérification structurelle)', () => {
  it('bandes et suggestions partagent la MÊME sélection ; l’ancien bouton (premier point) a disparu', async () => {
    const fs = await import('node:fs')
    const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(app).toContain('meteoPourCourbe(meteoModule, meteoSelection)')
    expect(app).toContain('suggererExclusions(meteoModule, meteoSelection,')
    expect(app).not.toMatch(/recevabiliteForDate|fenetresAExclure|handleExcludeNonRecevable/)
  })
})
