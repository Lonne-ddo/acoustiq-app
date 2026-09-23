import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  selectionEffective,
  meteoPourCourbe,
  portionsNonCouvertes,
  libellePortions,
  idMotifMeteo,
  zonesSurAxe,
  intervallesMesure,
} from './meteoCourbe'
import { makeDefaultMeteoState, type MeteoModuleState } from './meteoModule'
import { evaluateRecevabilite, parseHourTimestamp, type MeteoHourRow } from './recevabilite'
import type { SourceResult, SourceError, SourceId } from './meteoSources'
import { LegendeMeteo, MotifsMeteo } from '../components/meteo/MeteoCourbeMotifs'

const H = 3_600_000
const ms = (dt: string) => parseHourTimestamp(dt).getTime()
const row = (datetime: string, o: Partial<MeteoHourRow> = {}): MeteoHourRow => ({
  datetime, temperature: 20, humidity: 60, precipitation: 0, windSpeed: 5, windDirection: 180, ...o,
})
const ok = (source: SourceId, rows: MeteoHourRow[]): SourceResult => ({
  source, rows, station: { name: 'S', lat: 45.5, lng: -73.6, distanceKm: 1 }, sourceUrl: 'x', sourceLabel: 'x', isArchive: true, timezone: 'America/Toronto',
})
const ko = (source: SourceId): SourceError => ({ source, error: 'HTTP 503' })

// Journée du 3 juillet : 08 h ok, 09-10 h vent (bad), 11 h chaussée gelée (warn), 12 h aberrant, 13 h ok.
const JOUR: MeteoHourRow[] = [
  row('2025-07-03 08:00:00'),
  row('2025-07-03 09:00:00', { windSpeed: 30 }),
  row('2025-07-03 10:00:00', { windSpeed: 30 }),
  row('2025-07-03 11:00:00', { temperature: -5, humidity: 99 }),
  row('2025-07-03 12:00:00', { temperature: 70 }),
  row('2025-07-03 13:00:00'),
]

function etat(outcomesParPoint: (SourceResult | SourceError)[][]): MeteoModuleState {
  const s = makeDefaultMeteoState()
  s.points = outcomesParPoint.map((_, i) => ({ ...s.points[0], id: `p${i}`, label: `BV-${i + 1}` }))
  s.results = outcomesParPoint.map((outcomes, i) => ({ pointId: `p${i}`, outcomes }))
  return s
}

describe('selectionEffective — point actif et source sélectionnée, sinon le défaut de l’onglet Météo', () => {
  const s = etat([[ok('openmeteo', JOUR), ok('eccc', JOUR)], [ko('openmeteo'), ok('gem', JOUR)]])
  it('respecte la sélection', () => {
    const e = selectionEffective(s, { pointId: 'p1', source: 'gem' })!
    expect([e.pointId, e.source.source]).toEqual(['p1', 'gem'])
  })
  it('défaut : premier point en succès, première source en succès', () => {
    const e = selectionEffective(s, { pointId: null, source: null })!
    expect([e.pointId, e.source.source]).toEqual(['p0', 'openmeteo'])
  })
  it('source sélectionnée en échec pour ce point → première source en succès, jamais une moyenne', () => {
    const e = selectionEffective(s, { pointId: 'p1', source: 'openmeteo' })!
    expect(e.source.source).toBe('gem')
  })
  it('aucune donnée météo, ou que des échecs → null (rien à afficher, pas une erreur)', () => {
    expect(selectionEffective(makeDefaultMeteoState(), { pointId: null, source: null })).toBeNull()
    expect(selectionEffective(etat([[ko('eccc')]]), { pointId: null, source: null })).toBeNull()
    expect(meteoPourCourbe(makeDefaultMeteoState(), { pointId: null, source: null })).toBeNull()
  })
})

describe('meteoPourCourbe — bandes d’EXCEPTION seulement, niveaux du tableau', () => {
  const s = etat([[ok('eccc', JOUR)]])
  const c = meteoPourCourbe(s, { pointId: 'p0', source: 'eccc' })!

  it('aucune bande pour « recevable » ; 09-11 h fusionnées (même niveau), niveaux distincts séparés', () => {
    expect(c.bandes).toEqual([
      { startMs: ms('2025-07-03 09:00:00'), endMs: ms('2025-07-03 11:00:00'), level: 'bad' },
      { startMs: ms('2025-07-03 11:00:00'), endMs: ms('2025-07-03 12:00:00'), level: 'warn' },
      { startMs: ms('2025-07-03 12:00:00'), endMs: ms('2025-07-03 13:00:00'), level: 'indetermine' },
    ])
    expect(c.bandes.some((b) => (b.level as string) === 'ok')).toBe(false)
  })

  it('niveau de chaque heure = celui du tableau de l’onglet Météo (evaluateRecevabilite)', () => {
    for (const h of evaluateRecevabilite(JOUR, s.asphalt, s.recevabiliteConfig)) {
      const t = ms(h.datetime)
      const b = c.bandes.find((x) => t >= x.startMs && t < x.endMs)
      expect(b?.level ?? 'ok').toBe(h.level)
    }
  })

  it('couverture : toutes les heures présentes (tous niveaux), fusionnées', () => {
    expect(c.couvert).toEqual([{ startMs: ms('2025-07-03 08:00:00'), endMs: ms('2025-07-03 14:00:00') }])
    expect([c.sourceLabel, c.pointLabel]).toEqual(['Env. Canada', 'BV-1'])
  })

  it('asphalte décoché : l’heure de chaussée gelée n’est plus une exception', () => {
    const sans = { ...s, asphalt: false }
    expect(meteoPourCourbe(sans, { pointId: 'p0', source: 'eccc' })!.bandes.some((b) => b.level === 'warn')).toBe(false)
  })
})

describe('portionsNonCouvertes — dire ce que la météo ne couvre pas', () => {
  const t0 = ms('2025-07-03 00:00:00')
  const I = (a: number, b: number) => ({ startMs: t0 + a * H, endMs: t0 + b * H })
  it('couverture complète → rien', () => {
    expect(portionsNonCouvertes([I(8, 12)], [I(6, 14)])).toEqual([])
  })
  it('début et fin non couverts', () => {
    expect(portionsNonCouvertes([I(6, 16)], [I(8, 14)])).toEqual([I(6, 8), I(14, 16)])
  })
  it('trou dans la série météo (heure manquante)', () => {
    expect(portionsNonCouvertes([I(8, 12)], [I(8, 9), I(10, 12)])).toEqual([I(9, 10)])
  })
  it('plusieurs intervalles de mesure, aucune météo sur le second', () => {
    expect(portionsNonCouvertes([I(8, 10), I(20, 22)], [I(0, 12)])).toEqual([I(20, 22)])
  })
  it('libellé lisible, préfixé du jour en multi-jours', () => {
    expect(libellePortions([I(6, 8), I(14, 16)], false)).toBe('06:00–08:00, 14:00–16:00')
    expect(libellePortions([I(6, 8)], true)).toBe('03/07 06:00–08:00')
  })
})

describe('placement sur l’axe du graphique (minutes depuis l’ancre)', () => {
  const ancre = ms('2025-07-03 00:00:00')
  const b = (debut: string, fin: string) => ({ startMs: ms(debut), endMs: ms(fin), level: 'bad' as const })

  it('jour unique : 09-11 h → 540-660 min ; tronqué à la plage du graphique', () => {
    expect(zonesSurAxe([b('2025-07-03 09:00:00', '2025-07-03 11:00:00')], ancre, { startMin: 0, endMin: 1440 })
      .map((z) => [z.x1, z.x2])).toEqual([[540, 660]])
    expect(zonesSurAxe([b('2025-07-03 09:00:00', '2025-07-03 11:00:00')], ancre, { startMin: 600, endMin: 1440 })
      .map((z) => [z.x1, z.x2])).toEqual([[600, 660]])
  })

  it('MULTI-JOURS : une heure du 2e jour tombe à 1440 + minutes ; hors plage → absente', () => {
    const z = zonesSurAxe([b('2025-07-04 09:00:00', '2025-07-04 10:00:00')], ancre, { startMin: 0, endMin: 2880 })
    expect([z[0].x1, z[0].x2]).toEqual([1440 + 540, 1440 + 600])
    expect(zonesSurAxe([b('2025-07-05 09:00:00', '2025-07-05 10:00:00')], ancre, { startMin: 0, endMin: 2880 })).toEqual([])
  })

  it('intervalles de mesure : pas de 5 min, un trou > 2 pas coupe l’intervalle', () => {
    const ts = [480, 485, 490, 600, 605] // 08:00-08:10 puis 10:00-10:05
    expect(intervallesMesure(ts, 5, ancre)).toEqual([
      { startMs: ancre + 480 * 60_000, endMs: ancre + 495 * 60_000 },
      { startMs: ancre + 600 * 60_000, endMs: ancre + 610 * 60_000 },
    ])
    expect(intervallesMesure([], 5, ancre)).toEqual([])
  })

  it('bout en bout : mesure 06-16 h, météo 08-14 h → 06:00–08:00 et 14:00–16:00 signalés', () => {
    const c = meteoPourCourbe(etat([[ok('eccc', JOUR)]]), { pointId: null, source: null })!
    const ts = Array.from({ length: 120 }, (_, i) => 360 + i * 5) // 06:00 → 15:55, pas 5 min
    const non = portionsNonCouvertes(intervallesMesure(ts, 5, ancre), c.couvert)
    expect(libellePortions(non, false)).toBe('06:00–08:00, 14:00–16:00')
  })
})

describe('légende et motifs (rendu statique)', () => {
  it('niveaux PRÉSENTS seulement, règle « sans bande = recevable », aucune pastille « recevable »', () => {
    const html = renderToStaticMarkup(createElement(LegendeMeteo, { niveaux: ['bad'], sourceLabel: 'Env. Canada', pointLabel: 'BV-1' }))
    expect(html).toContain('non recevable')
    expect(html).not.toContain('à signaler')
    expect(html).not.toContain('indéterminé')
    expect(html).toContain('sans bande = recevable')
    expect(html).toContain('Env. Canada · BV-1')
    expect(html.match(/<pattern /g)).toHaveLength(1) // une pastille = un seul motif
  })

  it('pas d’id dupliqué quand plusieurs niveaux sont présents', () => {
    const html = renderToStaticMarkup(createElement(LegendeMeteo, { niveaux: ['warn', 'bad', 'indetermine'], sourceLabel: 'S', pointLabel: 'P' }))
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('motifs distincts : diagonales −45° (≠ audio +45°), croisillons, horizontales', () => {
    const html = renderToStaticMarkup(createElement('svg', null, createElement(MotifsMeteo, { suffixe: 't', strokeOpacity: 1 })))
    const motif = (lv: 'warn' | 'bad' | 'indetermine') => {
      const i = html.indexOf(`id="${idMotifMeteo(lv, 't')}"`)
      return html.slice(i, html.indexOf('</pattern>', i))
    }
    expect(motif('warn')).toContain('rotate(-45)')
    expect(motif('warn')).toContain('#E69F00')
    expect(motif('bad').match(/<line /g)).toHaveLength(2)
    expect(motif('bad')).toContain('#D55E00')
    expect(motif('indetermine')).toContain('y1="2.5" x2="6" y2="2.5"')
    expect(motif('indetermine')).toContain('#56B4E9')
  })
})

describe('câblage (vérification structurelle)', () => {
  it('case « Afficher la recevabilité météo » décochée par défaut ; le graphique ne reçoit rien sinon', async () => {
    const fs = await import('node:fs')
    const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(app).toMatch(/const \[showMeteoRecevabilite, setShowMeteoRecevabilite\] = useState\(false\)/)
    expect(app).toContain('meteoCourbe={showMeteoRecevabilite ? meteoCourbe : null}')
  })
})
