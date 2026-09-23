import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { meteoWorkbookBytes, COULEURS, COULEURS_NIVEAU, type MeteoExcelInput } from './meteoExcel'
import { evaluateRecevabilite, DEFAUT_MELCCFP, RECEVABILITE_LABEL, type MeteoHourRow } from './recevabilite'
import type { SourceResult } from './meteoSources'

const row = (datetime: string, over: Partial<MeteoHourRow> = {}): MeteoHourRow => ({
  datetime, temperature: 20, humidity: 60, precipitation: 0, windSpeed: 5, windDirection: 180, ...over,
})

// Une heure par niveau : ok, warn (chaussée gelée humide), bad (vent), indéterminé (T aberrante).
const rowsEccc: MeteoHourRow[] = [
  row('2025-07-03 08:00:00', { dewpoint: 12, pressureHpa: 1004.6, weatherText: 'Mainly Clear' }),
  row('2025-07-03 09:00:00', { temperature: -5, humidity: 99 }),
  row('2025-07-03 10:00:00', { windSpeed: 30 }),
  row('2025-07-03 11:00:00', { temperature: 70 }),
]
const rowsOm: MeteoHourRow[] = [row('2025-07-03T08:00', { weatherCode: 61 }), row('2025-07-03T09:00')]

function src(source: SourceResult['source'], rows: MeteoHourRow[]): SourceResult {
  return {
    source, rows,
    station: { name: 'MONTREAL INTL A', lat: 45.47, lng: -73.74, distanceKm: 3.2, climateId: '7025251' },
    sourceUrl: 'x', sourceLabel: `Libellé ${source}`, isArchive: true, timezone: 'local (LST)',
  }
}

function input(over: Partial<MeteoExcelInput> = {}): MeteoExcelInput {
  const sources = [src('eccc', rowsEccc), src('openmeteo', rowsOm)]
  return {
    pointLabel: 'BV-1', lat: 45.5, lng: -73.6, startDate: '2025-07-03', endDate: '2025-07-03',
    sources,
    recevabiliteBySource: Object.fromEntries(sources.map((s) => [s.source, evaluateRecevabilite(s.rows, true, DEFAUT_MELCCFP)])),
    asphalt: true, config: DEFAUT_MELCCFP, generatedAt: new Date(2026, 8, 23, 12, 0), ...over,
  }
}

async function relire(bytes: ArrayBuffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes)
  return wb
}

const fondDe = (c: ExcelJS.Cell) => (c.fill && c.fill.type === 'pattern' ? c.fill.fgColor?.argb : undefined)

describe('export Excel météo (ExcelJS)', () => {
  it('onglets : synthèse, un par source, comparaison, métadonnées', async () => {
    const wb = await relire(await meteoWorkbookBytes(input()))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Synthèse §3.6', 'Env. Canada', 'Open-Meteo', 'Comparaison', 'Métadonnées'])
  })

  it('verdict COLORÉ par niveau, dans la synthèse ET l’onglet source — les quatre niveaux', async () => {
    const wb = await relire(await meteoWorkbookBytes(input()))
    const ws = wb.getWorksheet('Env. Canada')!
    // lignes 4..7 = les 4 heures ECCC ; colonne 10 = verdict
    const attendus = ['ok', 'warn', 'bad', 'indetermine'] as const
    attendus.forEach((lv, i) => {
      const c = ws.getRow(4 + i).getCell(10)
      expect(c.value).toBe(RECEVABILITE_LABEL[lv])
      expect(fondDe(c)).toBe(COULEURS_NIVEAU[lv].fond)
      expect((c.font as ExcelJS.Font).color?.argb).toBe(COULEURS_NIVEAU[lv].texte)
    })
    const syn = wb.getWorksheet('Synthèse §3.6')!
    const niveaux = new Set<string>()
    syn.eachRow((r, n) => {
      if (n === 1) return
      const c = r.getCell(8)
      const lv = (Object.keys(RECEVABILITE_LABEL) as (keyof typeof RECEVABILITE_LABEL)[]).find((k) => RECEVABILITE_LABEL[k] === c.value)!
      expect(fondDe(c)).toBe(COULEURS_NIVEAU[lv].fond)
      niveaux.add(lv)
    })
    expect(niveaux).toEqual(new Set(['ok', 'warn', 'bad', 'indetermine']))
  })

  it('en-têtes sarcelle, texte blanc gras', async () => {
    const wb = await relire(await meteoWorkbookBytes(input()))
    const h = wb.getWorksheet('Synthèse §3.6')!.getRow(1).getCell(1)
    expect(fondDe(h)).toBe(COULEURS.enteteFond)
    expect((h.font as ExcelJS.Font).bold).toBe(true)
  })

  it('point de rosée : mesuré tel quel, calculé (Magnus) signalé par une note', async () => {
    const ws = (await relire(await meteoWorkbookBytes(input()))).getWorksheet('Env. Canada')!
    expect(ws.getRow(4).getCell(3).value).toBe(12)
    expect(ws.getRow(4).getCell(3).note).toBeUndefined()
    expect(ws.getRow(4).getCell(8).value).toBe(100.5) // 1004.6 hPa → 100,5 kPa (arrondi 0,1)
    expect(ws.getRow(4).getCell(9).value).toBe('Mainly Clear')
    expect(String(ws.getRow(5).getCell(3).note)).toContain('CALCULÉ')
  })

  it('métadonnées : seuils tracés ; critère d’humidité actif ⇒ non MELCCFP', async () => {
    const def = (await relire(await meteoWorkbookBytes(input()))).getWorksheet('Métadonnées')!
    expect(def.getCell('B9').value).toBe('MELCCFP (défaut)')
    const cfg = { ...DEFAUT_MELCCFP, humiditeMode: 'hr' as const }
    const mod = (await relire(await meteoWorkbookBytes(input({ config: cfg })))).getWorksheet('Métadonnées')!
    expect(mod.getCell('B9').value).toBe('MODIFIÉS — non MELCCFP')
    expect(String(mod.getCell('B10').value)).toContain('tolérance du sonomètre')
  })

  it('relu par SheetJS : même contenu (un autre lecteur ouvre le fichier)', async () => {
    const wb = XLSX.read(new Uint8Array(await meteoWorkbookBytes(input())), { type: 'array' })
    expect(wb.SheetNames).toContain('Synthèse §3.6')
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Synthèse §3.6'], { header: 1 })
    expect(rows[0]).toEqual(['Date/Heure', 'Source', 'Période', 'T (°C)', 'HR (%)', 'Précip. (mm)', 'Vent (km/h)', 'Recevabilité §3.6', 'Motif(s)'])
    expect(rows).toHaveLength(1 + rowsEccc.length + rowsOm.length)
    const cmp = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Comparaison'], { header: 1 })
    expect(cmp[1]).toEqual(['2025-07-03 08:00', 20, 60, 0, 5, 20, 60, 0, 5])
  })
})
