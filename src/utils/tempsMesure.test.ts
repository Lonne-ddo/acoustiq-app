import { describe, it, expect } from 'vitest'
import {
  instantMs, statutMural, heureAmbigue, dateEtMinute, decalageJours, tDansRepere,
  fenetreAbsolue, dansFenetre, datesCouvertes, cleSeconde,
} from './tempsMesure'
import { dpTimestampMs } from './acoustics'
import { CAS_PARSEURS_24H } from '../modules/parseurs24h.fixtures'
import { parserCas } from '../modules/parseurs24h.golden'

/**
 * Lot 19.1 (#19, option A) — temps absolu non replié. Fuseau figé à
 * America/Toronto par vitest.config.ts : 8 mars 2026 (02:00 → 03:00) et
 * 2 novembre 2025 / 1er novembre 2026 (02:00 → 01:00).
 */

const H = 3_600_000
const cas = (id: string) => {
  const c = CAS_PARSEURS_24H.find((x) => x.id === id)
  if (!c) throw new Error(`fixture absente : ${id}`)
  return c
}

/**
 * Déplie un `t` replié par le parseur actuel (chute de plus de 12 h = minuit) —
 * reproduit ici ce que fera le parseur après le lot 19.6.
 */
function deplier(ts: number[]): number[] {
  let jours = 0
  return ts.map((t, i) => {
    if (i > 0 && t < ts[i - 1] - 720) jours++
    return t + jours * 1440
  })
}

/** `new Date(a, m, j, 0, t)` à la milliseconde entière : la définition de A1. */
function reference(date: string, ms: number): number {
  const [a, mo, j] = date.split('-').map(Number)
  return new Date(a, mo - 1, j, 0, 0, 0, ms).getTime()
}

describe('le fuseau des tests est figé', () => {
  it('America/Toronto (vitest.config.ts)', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Toronto')
  })
})

describe('instantMs — identique AU BIT PRÈS à dpTimestampMs hors changement d’heure', () => {
  const JUILLET = ['csv-date-heure-31h', 'xlsx-date-heure-31h', 'xlsx-g4-fr-31h', 'xlsx-g4-en-31h', 'xlsx-g4-en-sommaire-veille']
  for (const id of JUILLET) {
    it(`${id} : chaque échantillon, t replié ET déplié (gigue du flottant comprise)`, async () => {
      const f = await parserCas(cas(id))
      const ts = f.data.map((d) => d.t)
      expect(ts.length).toBeGreaterThan(300)
      for (const t of [...ts, ...deplier(ts)]) {
        // Object.is : égalité bit à bit (y compris la partie fractionnaire).
        expect(Object.is(instantMs(f.date, t), dpTimestampMs(f.date, t))).toBe(true)
      }
    })
  }
})

describe('instantMs — DIFFÈRE de dpTimestampMs après un changement d’heure (A1, attendu)', () => {
  // Comportement attendu, pas une régression : un sonomètre horodate en heure
  // murale, « minuit + t » décalait d'une heure tout ce qui suit le changement.
  it('passage à l’heure d’été (8 mars 2026) : −1 h exactement à partir de 03:00 le 8', async () => {
    const f = await parserCas(cas('csv-heure-ete'))
    expect(f.date).toBe('2026-03-07')
    const ts = deplier(f.data.map((d) => d.t))
    let avant = 0, apres = 0
    for (const t of ts) {
      const ecart = instantMs(f.date, t) - dpTimestampMs(f.date, t)
      if (t < 1440 + 120) { expect(ecart).toBe(0); avant++ } else { expect(ecart).toBe(-H); apres++ }
      expect(statutMural(f.date, t)).toBe('normal') // aucune 02:xx dans le relevé
    }
    expect(avant).toBe(119 + 120) // 22:01 → 02:00 (la ligne « Début » de 22:00 est sautée par le parseur)
    expect(apres).toBe(180)       // 03:00 → 06:00
  })

  it('retour à l’heure normale (2 nov. 2025) : 0 jusqu’à l’heure répétée, +1 h exactement à partir de 02:00', async () => {
    const f = await parserCas(cas('csv-heure-normale'))
    expect(f.date).toBe('2025-11-01')
    const ts = deplier(f.data.map((d) => d.t))
    let ambigus = 0
    for (const t of ts) {
      const ecart = instantMs(f.date, t) - dpTimestampMs(f.date, t)
      expect(ecart).toBe(t < 1440 + 120 ? 0 : H)
      if (heureAmbigue(f.date, t)) ambigus++
    }
    // Les 60 minutes 01:xx, émises deux fois : 120 échantillons ambigus.
    expect(ambigus).toBe(120)
  })

  it('heure répétée : 60 clés à la seconde partagées par DEUX mesures distinctes — toutes ambiguës', async () => {
    const f = await parserCas(cas('csv-heure-normale'))
    const ts = deplier(f.data.map((d) => d.t))
    const parCle = new Map<number, number[]>()
    ts.forEach((t, i) => parCle.set(cleSeconde(f.date, t), [...(parCle.get(cleSeconde(f.date, t)) ?? []), i]))
    const partagees = [...parCle.values()].filter((ix) => ix.length > 1)
    expect(partagees).toHaveLength(60)
    for (const ix of partagees) {
      expect(ix).toHaveLength(2)
      expect(ix[1] - ix[0]).toBe(60) // deux échantillons distincts, à une heure d'écart dans le fichier
      for (const i of ix) expect(heureAmbigue(f.date, ts[i])).toBe(true)
    }
  })
})

describe('instantMs = new Date(a, m, j, 0, 0, 0, ms) — balayage minute par minute', () => {
  const balayages: [string, string][] = [
    ['2026-03-06', 'passage à l’heure d’été, t de 0 à 4 jours'],
    ['2026-10-30', 'retour à l’heure normale, t de 0 à 4 jours'],
    ['2025-06-30', 'été sans changement'],
    ['2025-12-30', 'fin d’année'],
  ]
  for (const [date, titre] of balayages) {
    it(`${date} — ${titre}`, () => {
      for (let t = -120; t <= 4 * 1440; t++) expect(instantMs(date, t)).toBe(reference(date, t * 60_000))
      for (let s = 0; s <= 4 * 86_400; s += 37) expect(instantMs(date, s / 60)).toBe(reference(date, s * 1000))
    })
  }
})

describe('statutMural / heureAmbigue', () => {
  it('heure sautée : inexistante ; première occurrence prise comme new Date (02:30 → 03:30)', () => {
    expect(statutMural('2026-03-08', 150)).toBe('inexistant')
    expect(new Date(instantMs('2026-03-08', 150)).getHours()).toBe(3)
    expect(statutMural('2026-03-08', 119)).toBe('normal')
    expect(statutMural('2026-03-08', 180)).toBe('normal')
  })
  it('heure répétée : ambiguë, quelle que soit la date de référence du fichier', () => {
    expect(statutMural('2026-11-01', 90)).toBe('ambigu')
    expect(statutMural('2026-10-31', 1440 + 90)).toBe('ambigu')
    expect(statutMural('2026-10-29', 3 * 1440 + 60)).toBe('ambigu')
    expect(statutMural('2026-11-01', 59)).toBe('normal')
    expect(statutMural('2026-11-01', 120)).toBe('normal')
    expect(heureAmbigue('2026-11-01', 90)).toBe(true)
    expect(heureAmbigue('2026-07-01', 90)).toBe(false)
  })
  it('heure répétée : instantMs rend la PREMIÈRE occurrence (heure avancée)', () => {
    const e = instantMs('2026-11-01', 90)
    expect(new Date(e).getTimezoneOffset()).toBe(240)
    expect(new Date(e + H).getHours()).toBe(1) // la seconde occurrence existe bien, une heure plus tard
  })
  it('gigue du flottant : le statut est tranché à la seconde de l’horodatage', () => {
    // 01:00 lu 00:59:59,9999998 par le parseur : bien dans l'heure répétée.
    expect(statutMural('2025-11-01', 1440 + 59.99999999650754)).toBe('ambigu')
    // 02:00 (heure normale) lu 01:59:59,9999998 : PAS replacé une heure trop tôt.
    const e = instantMs('2026-11-01', 120 - 3.5e-9)
    expect(new Date(e).getTimezoneOffset()).toBe(300)
    expect(Math.abs(e - instantMs('2026-11-01', 120))).toBeLessThan(1)
    // 03:00 lu 02:59:59,9999998 le jour du passage à l'heure d'été : normal, pas « inexistant ».
    expect(statutMural('2026-03-08', 180 - 3.5e-9)).toBe('normal')
    expect(Math.abs(instantMs('2026-03-08', 180 - 3.5e-9) - instantMs('2026-03-08', 180))).toBeLessThan(1)
  })
  it('entrée illisible : null (échec technique), distinct des faits de donnée', () => {
    expect(statutMural('2025-02-30', 60)).toBeNull()
    expect(statutMural('2025-07-03', NaN)).toBeNull()
    expect(heureAmbigue('n/a', 60)).toBe(false)
  })
})

describe('instantMs — entrées illisibles : NaN, jamais 0', () => {
  it.each([
    ['2025-02-30', 60], ['2025-13-01', 60], ['03/07/2025', 60], ['', 60],
    ['2025-07-03', NaN], ['2025-07-03', Infinity],
  ])('%s, t=%s → NaN', (date, t) => {
    expect(instantMs(date as string, t as number)).toBeNaN()
  })
})

describe('dateEtMinute — calendrier, sans fuseau', () => {
  it.each([
    ['2025-07-03', 0, '2025-07-03', 0],
    ['2025-07-03', 1439.5, '2025-07-03', 1439.5],
    ['2025-07-03', 1440, '2025-07-04', 0],
    ['2025-07-03', 1500, '2025-07-04', 60],
    ['2025-07-03', 3 * 1440 + 1, '2025-07-06', 1],
    ['2025-07-03', -30, '2025-07-02', 1410],
    ['2025-12-31', 1500, '2026-01-01', 60],
    ['2028-02-28', 1440, '2028-02-29', 0],
    ['2027-02-28', 1440, '2027-03-01', 0],
    ['2026-03-07', 1440 + 180, '2026-03-08', 180], // 03:00 murale le jour du changement
  ])('(%s, %s) → %s %s', (date, t, d, m) => {
    expect(dateEtMinute(date as string, t as number)).toEqual({ date: d, minute: m })
  })
  it('illisible → null', () => {
    expect(dateEtMinute('2025-02-29', 0)).toBeNull()
    expect(dateEtMinute('2025-07-03', NaN)).toBeNull()
  })
})

describe('decalageJours / tDansRepere — alignement par la date', () => {
  it('entier même à travers un changement d’heure (jour de 23 h ou 25 h)', () => {
    expect(decalageJours('2026-03-07', '2026-03-09')).toBe(2)
    expect(decalageJours('2026-10-31', '2026-11-02')).toBe(2)
  })
  it('signé, à travers l’année, dates non consécutives', () => {
    expect(decalageJours('2025-12-30', '2026-01-02')).toBe(3)
    expect(decalageJours('2025-07-10', '2025-07-03')).toBe(-7)
    expect(decalageJours('2024-02-28', '2024-03-01')).toBe(2)
  })
  it('illisible → NaN', () => {
    expect(decalageJours('2025-07-03', 'x')).toBeNaN()
    expect(tDansRepere('2025-07-03', 'x', 60)).toBeNaN()
  })
  it('tDansRepere : (4 juillet, 60) = 1500 dans le repère du 3', () => {
    expect(tDansRepere('2025-07-03', '2025-07-04', 60)).toBe(1500)
    expect(tDansRepere('2025-07-04', '2025-07-03', 1500)).toBe(60)
  })
})

describe('fenetreAbsolue / dansFenetre', () => {
  it('19:00 → 07:00 se termine le lendemain', () => {
    expect(fenetreAbsolue('2025-07-03', '19:00', '07:00')).toEqual({ date: '2025-07-03', debutMin: 1140, finMin: 1860 })
  })
  it('07:00 → 19:00 le même jour ; début = fin : 24 h ; 24:00 accepté', () => {
    expect(fenetreAbsolue('2025-07-03', '07:00', '19:00')).toEqual({ date: '2025-07-03', debutMin: 420, finMin: 1140 })
    expect(fenetreAbsolue('2025-07-03', '14:00', '14:00')).toEqual({ date: '2025-07-03', debutMin: 840, finMin: 2280 })
    expect(fenetreAbsolue('2025-07-03', '00:00', '24:00')).toEqual({ date: '2025-07-03', debutMin: 0, finMin: 1440 })
  })
  it.each([['2025-07-03', '25:00', '07:00'], ['2025-07-03', '19:00', '7h'], ['2025-02-30', '19:00', '07:00'], ['2025-07-03', '24:30', '07:00']])(
    'illisible → null (%s, %s, %s)', (d, a, b) => {
      expect(fenetreAbsolue(d, a, b)).toBeNull()
    })

  const nuit3 = fenetreAbsolue('2025-07-03', '19:00', '07:00')!
  it('nuit du 3 juillet : [19 h le 3, 7 h le 4[, quel que soit le repère du fichier', () => {
    expect(dansFenetre('2025-07-03', 1140, nuit3)).toBe(true)        // 19:00 le 3 (inclus)
    expect(dansFenetre('2025-07-03', 1139.99, nuit3)).toBe(false)
    expect(dansFenetre('2025-07-03', 1500, nuit3)).toBe(true)        // 01:00 le 4, t non replié
    expect(dansFenetre('2025-07-04', 60, nuit3)).toBe(true)          // même instant, fichier daté du 4
    expect(dansFenetre('2025-07-04', 420, nuit3)).toBe(false)        // 07:00 le 4 (exclu)
    expect(dansFenetre('2025-07-04', 419.99, nuit3)).toBe(true)
  })
  it('la fin de la nuit PRÉCÉDENTE n’appartient pas à la nuit du 3 (#15)', () => {
    expect(dansFenetre('2025-07-03', 120, nuit3)).toBe(false)        // 02:00 le 3 = nuit du 2
    expect(dansFenetre('2025-07-02', 1560, nuit3)).toBe(false)
  })
  it('dates non consécutives : aligné par écart de calendrier, pas par rang', () => {
    expect(dansFenetre('2025-07-10', 1380, nuit3)).toBe(false)       // 23:00 le 10
    expect(dansFenetre('2025-07-10', 1380, fenetreAbsolue('2025-07-10', '19:00', '07:00')!)).toBe(true)
  })
  it('t ou date illisible : hors de toute fenêtre', () => {
    expect(dansFenetre('2025-07-03', NaN, nuit3)).toBe(false)
    expect(dansFenetre('x', 1200, nuit3)).toBe(false)
  })
})

describe('datesCouvertes', () => {
  it('t non replié : toutes les dates touchées, triées', () => {
    expect(datesCouvertes({ date: '2025-07-03', data: [{ t: 2900 }, { t: 1380 }, { t: 1500 }] }))
      .toEqual({ dates: ['2025-07-03', '2025-07-04', '2025-07-05'], tIllisibles: 0 })
  })
  it('t illisibles : écartés mais COMPTÉS', () => {
    expect(datesCouvertes({ date: '2025-07-03', data: [{ t: 60 }, { t: NaN }, { t: Infinity }] }))
      .toEqual({ dates: ['2025-07-03'], tIllisibles: 2 })
  })
  it('date du fichier illisible : aucun échantillon datable', () => {
    expect(datesCouvertes({ date: '', data: [{ t: 60 }, { t: 61 }] })).toEqual({ dates: [], tIllisibles: 2 })
  })
  it('avant le lot 19.6, un relevé de 31 h replié ne donne que sa date de début (défaut #19 documenté)', async () => {
    const f = await parserCas(cas('csv-date-heure-31h'))
    expect(datesCouvertes(f)).toEqual({ dates: ['2025-07-03'], tIllisibles: 0 })
    expect(datesCouvertes({ date: f.date, data: deplier(f.data.map((d) => d.t)).map((t) => ({ t })) }).dates)
      .toEqual(['2025-07-03', '2025-07-04', '2025-07-05'])
  })
})

describe('cleSeconde', () => {
  it('entière, à la seconde, arrondie (gigue du flottant absorbée)', () => {
    const k = cleSeconde('2025-07-03', 0)
    expect(k).toBe(Date.UTC(2025, 6, 3) / 1000)
    expect(cleSeconde('2025-07-03', 1.5)).toBe(k + 90)
    expect(cleSeconde('2025-07-03', 0.9999999999)).toBe(k + 60)
    expect(cleSeconde('2025-07-03', 1.0000000001)).toBe(k + 60)
    expect(Number.isInteger(cleSeconde('2025-07-03', 1234.56789))).toBe(true)
  })
  it('même clé pour le même instant mural, quel que soit le repère du fichier', () => {
    expect(cleSeconde('2025-07-03', 1500)).toBe(cleSeconde('2025-07-04', 60))
  })
  it('murale : 03:00 − 01:00 le jour du passage à l’heure d’été = 2 h murales (1 h écoulée)', () => {
    expect(cleSeconde('2026-03-08', 180) - cleSeconde('2026-03-08', 60)).toBe(7200)
    expect(instantMs('2026-03-08', 180) - instantMs('2026-03-08', 60)).toBe(H)
  })
  it('illisible → NaN', () => {
    expect(cleSeconde('2025-02-30', 0)).toBeNaN()
    expect(cleSeconde('2025-07-03', NaN)).toBeNaN()
  })
})
