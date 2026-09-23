import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { externalLinks, viewerUrl } from './meteoLinks'
import { conditionsLabel } from './wmo'
import {
  conclusionVerdict,
  hourKeyOf,
  verdictHeure,
  evaluateRecevabilite,
  DEFAUT_MELCCFP,
  RECEVABILITE_LABEL,
  type MeteoHourRow,
} from './recevabilite'
import type { SourceResult } from './meteoSources'
import MeteoInspector from '../components/meteo/MeteoInspector'

const row = (over: Partial<MeteoHourRow> = {}): MeteoHourRow => ({
  datetime: '2025-07-03T14:00', temperature: 20, humidity: 60, precipitation: 0, windSpeed: 5, windDirection: 180, ...over,
})

function src(source: SourceResult['source'], rows: MeteoHourRow[], extra: Partial<SourceResult> = {}): SourceResult {
  return {
    source, rows,
    station: { name: 'Stn', lat: 45.5, lng: -73.6, distanceKm: 1, climateId: '7025251' },
    sourceUrl: 'x', sourceLabel: 'x', isArchive: true, timezone: 'x', ...extra,
  }
}

describe('hourKeyOf', () => {
  it('Open-Meteo et ECCC donnent la même clé', () => {
    expect(hourKeyOf('2025-07-03T14:00')).toBe('2025-07-03T14')
    expect(hourKeyOf('2025-07-03 14:00:00')).toBe('2025-07-03T14')
    expect(hourKeyOf('illisible')).toBeNull()
  })
})

describe('conclusionVerdict — une phrase par niveau', () => {
  it('reprend les motifs pour bad et indéterminé', () => {
    expect(conclusionVerdict(verdictHeure(row()))).toMatch(/^RECEVABLE/)
    expect(conclusionVerdict(verdictHeure(row({ windSpeed: 30 })))).toBe('NON RECEVABLE — vent 30.0 km/h ≥ 20')
    expect(conclusionVerdict(verdictHeure(row({ temperature: -5, humidity: 99 })))).toMatch(/^À SIGNALER/)
    expect(conclusionVerdict(verdictHeure(row({ temperature: 70 })))).toMatch(/^INDÉTERMINÉ .*ni recevable ni non recevable/)
  })
})

describe('conditionsLabel — texte ECCC, sinon WMO', () => {
  it('priorité au texte, repli sur le code, « NA » ignoré', () => {
    expect(conditionsLabel({ weatherText: 'Mainly Clear', weatherCode: 3 })).toBe('Mainly Clear')
    expect(conditionsLabel({ weatherText: null, weatherCode: 61 })).toBe('Pluie légère')
    expect(conditionsLabel({ weatherText: 'NA', weatherCode: null })).toBe('—')
    expect(conditionsLabel({ weatherCode: 42 })).toBe('code 42')
  })
})

describe('liens de consultation', () => {
  it('externalLinks : 3 liens positionnés sur les coordonnées', () => {
    const l = externalLinks(45.50123, -73.61234)
    expect(l).toHaveLength(3)
    expect(l[0].url).toContain('coords=45.501,-73.612')
    expect(l.every((x) => x.url.startsWith('https://'))).toBe(true)
  })

  it('viewerUrl : archive ERA5 datée, GEM, ECCC par StationID retrouvé via climateId', () => {
    expect(viewerUrl(src('openmeteo', []), 45.5, -73.6, '2025-07-03', '2025-07-09'))
      .toContain('historical-weather-api?latitude=45.5&longitude=-73.6&start_date=2025-07-03&end_date=2025-07-09')
    expect(viewerUrl(src('gem', []), 45.5, -73.6, '2025-07-03', '2025-07-09')).toContain('/docs/gem-api?')
    const cand = { climateId: '7025251', stnId: 51157, name: 'MTL', province: 'QC', lat: 0, lng: 0, distance: 1, hasHourly: true, elevation: 0, firstYear: null, lastYear: null }
    expect(viewerUrl(src('eccc', [], { candidates: [cand] }), 45.5, -73.6, '2025-07-03', '2025-07-09'))
      .toBe('https://climate.weather.gc.ca/climate_data/hourly_data_e.html?StationID=51157&Year=2025&Month=7&Day=3&timeframe=1')
    expect(viewerUrl(src('eccc', []), 45.5, -73.6, '2025-07-03', '2025-07-09')).toBe('https://climate.weather.gc.ca/')
  })
})

describe('MeteoInspector — affiche le verdict du tableau, pas un autre', () => {
  const cas: [Partial<MeteoHourRow>, string][] = [
    [{}, 'ok'],
    [{ temperature: -5, humidity: 99 }, 'warn'],
    [{ windSpeed: 30 }, 'bad'],
    [{ precipitation: 0.4 }, 'bad'],
    [{ temperature: 70 }, 'indetermine'],
  ]

  it('les cas couvrent les QUATRE niveaux', () => {
    expect(new Set(cas.map(([, l]) => l))).toEqual(new Set(['ok', 'warn', 'bad', 'indetermine']))
  })

  for (const [over, niveau] of cas) {
    it(`detail — niveau ${niveau} ${JSON.stringify(over)}`, () => {
      const r = row(over)
      const [h] = evaluateRecevabilite([r], true, DEFAUT_MELCCFP) // ce qu'affiche le tableau
      expect(h.level).toBe(niveau)
      const html = renderToStaticMarkup(
        createElement(MeteoInspector, {
          selection: { mode: 'detail', hourKey: '2025-07-03T14', source: 'eccc' },
          outcomes: [src('eccc', [r])],
          pointLabel: 'BV-1', asphalt: true, config: DEFAULT_CFG, onClose: () => {},
        }),
      )
      const texte = html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
      expect(texte).toContain(conclusionVerdict(h).replace(/\s+/g, ' '))
      for (const s of h.steps) expect(texte).toContain(s.result)
    })
  }

  it('comparaison : un verdict par source, erreurs comprises', () => {
    const html = renderToStaticMarkup(
      createElement(MeteoInspector, {
        selection: { mode: 'comparison', hourKey: '2025-07-03T14' },
        outcomes: [src('openmeteo', [row()]), src('gem', [row({ windSpeed: 30 })]), { source: 'eccc', error: 'HTTP 503' }],
        pointLabel: 'BV-1', asphalt: true, config: DEFAULT_CFG, onClose: () => {},
      }),
    )
    expect(html).toContain(`§3.6 : ${RECEVABILITE_LABEL.ok}`)
    expect(html).toContain(`§3.6 : ${RECEVABILITE_LABEL.bad}`)
    expect(html).toContain('HTTP 503')
  })
})

const DEFAULT_CFG = DEFAUT_MELCCFP
