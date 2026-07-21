import { describe, it, expect } from 'vitest'
import { REG_PERIODS, regPeriodOfHour, leqOnRegPeriod, type RegPeriod } from './acoustics'
import {
  periodLabel,
  evaluateRecevabilite,
  chausseeSeche,
  seuilsUtilisesLine,
  isMelccfpDefault,
  DEFAUT_MELCCFP,
  type MeteoHourRow,
  type RecevabiliteConfig,
} from './recevabilite'

describe('regPeriodOfHour — bornes réglementaires jour/soir/nuit', () => {
  // Table alignée sur les bornes MELCCFP : jour 07-19, soir 19-22, nuit 22-07.
  const cases: [number, RegPeriod][] = [
    [7, 'jour'],
    [18, 'jour'],
    [19, 'soir'],
    [21, 'soir'],
    [22, 'nuit'],
    [6, 'nuit'],
    [0, 'nuit'],
    [23, 'nuit'],
  ]
  for (const [hour, expected] of cases) {
    it(`${String(hour).padStart(2, '0')}h → ${expected}`, () => {
      expect(regPeriodOfHour(hour)).toBe(expected)
    })
  }

  it('tolère les heures hors [0,24) via modulo', () => {
    expect(regPeriodOfHour(24)).toBe('nuit') // = 0 h
    expect(regPeriodOfHour(-2)).toBe('nuit') // = 22 h
    expect(regPeriodOfHour(31)).toBe('jour') // = 7 h
  })
})

describe('periodLabel — étiquetage d’un instant aux bornes exactes', () => {
  // Les 6 bornes demandées (granularité minute — periodLabel lit getHours()).
  const at = (h: number, m: number) => new Date(2026, 0, 15, h, m, 0)
  const cases: [number, number, RegPeriod][] = [
    [7, 0, 'jour'],
    [18, 59, 'jour'],
    [19, 0, 'soir'],
    [21, 59, 'soir'],
    [22, 0, 'nuit'],
    [6, 59, 'nuit'],
  ]
  for (const [h, m, expected] of cases) {
    it(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} → ${expected}`, () => {
      expect(periodLabel(at(h, m))).toBe(expected)
    })
  }
})

describe('cohérence REG_PERIODS ↔ leqOnRegPeriod', () => {
  it('chaque heure appartient EXACTEMENT à la période retournée par regPeriodOfHour', () => {
    const names: RegPeriod[] = ['jour', 'soir', 'nuit']
    for (let h = 0; h < 24; h++) {
      const t = h * 60 + 30 // milieu d'heure
      const sample = [{ t, laeq: 50 }]
      const belongs = regPeriodOfHour(h)
      for (const name of names) {
        const { startH, endH } = REG_PERIODS[name]
        const { leq } = leqOnRegPeriod(sample, startH, endH)
        if (name === belongs) expect(leq, `h=${h} devrait tomber dans ${name}`).toBe(50)
        else expect(leq, `h=${h} ne devrait pas tomber dans ${name}`).toBeNull()
      }
    }
  })

  it('les durées de période sont 720 / 180 / 540 min (12 h / 3 h / 9 h)', () => {
    expect(leqOnRegPeriod([], REG_PERIODS.jour.startH, REG_PERIODS.jour.endH).periodMin).toBe(720)
    expect(leqOnRegPeriod([], REG_PERIODS.soir.startH, REG_PERIODS.soir.endH).periodMin).toBe(180)
    expect(leqOnRegPeriod([], REG_PERIODS.nuit.startH, REG_PERIODS.nuit.endH).periodMin).toBe(540)
  })
})

describe('evaluateRecevabilite — le soir est une étiquette, pas un critère', () => {
  const row = (datetime: string, windSpeed: number | null): MeteoHourRow => ({
    datetime,
    temperature: 15,
    humidity: 60,
    precipitation: 0,
    windSpeed,
    windDirection: 180,
  })

  it('étiquette une heure de soir en « soir »', () => {
    const [h] = evaluateRecevabilite([row('2026-01-15T20:00', 5)])
    expect(h.period).toBe('soir')
    expect(h.level).toBe('ok')
  })

  it('un critère (vent ≥ 20) reste « bad » quelle que soit la période (soir inclus)', () => {
    const [h] = evaluateRecevabilite([row('2026-01-15T20:00', 25)])
    expect(h.period).toBe('soir')
    expect(h.level).toBe('bad')
  })
})

describe('seuils configurables — DEFAUT_MELCCFP = comportement d’avant', () => {
  const mk = (
    over: Partial<MeteoHourRow>,
  ): MeteoHourRow => ({
    datetime: '2026-01-15T08:00',
    temperature: 15,
    humidity: 60,
    precipitation: 0,
    windSpeed: 5,
    windDirection: 180,
    ...over,
  })

  it('NON-RÉGRESSION : les 3 critères produisent le même verdict/drapeaux qu’avant', () => {
    const rows = [
      mk({ datetime: '2026-01-15T08:00', windSpeed: 5, precipitation: 0 }), // ok
      mk({ datetime: '2026-01-15T09:00', windSpeed: 25 }), // vent → bad
      mk({ datetime: '2026-01-15T10:00', precipitation: 0.5 }), // précip → bad
      mk({ datetime: '2026-01-15T11:00', temperature: -1, humidity: 95, precipitation: 0 }), // chaussée → warn
    ]
    const ev = evaluateRecevabilite(rows, true, DEFAUT_MELCCFP)
    expect(ev.map((h) => h.level)).toEqual(['ok', 'bad', 'bad', 'warn'])
    expect(ev[1].reasons[0]).toContain('vent')
    expect(ev[1].reasons[0]).toContain('≥ 20')
    expect(ev[2].reasons[0]).toContain('> 0')
    expect(ev[3].reasons).toContain('chaussée non sèche')
  })

  it('FRONTIÈRE précip : 0 → recevable · 0.1 → non recevable (> STRICT, jamais >=)', () => {
    expect(evaluateRecevabilite([mk({ precipitation: 0 })])[0].level).toBe('ok')
    expect(evaluateRecevabilite([mk({ precipitation: 0.1 })])[0].level).toBe('bad')
  })

  it('SEUIL MODIFIÉ : windMaxKmh=30 rend recevable une ligne à 25 km/h (bad par défaut)', () => {
    const r = [mk({ windSpeed: 25 })]
    expect(evaluateRecevabilite(r, true, DEFAUT_MELCCFP)[0].level).toBe('bad')
    const cfg: RecevabiliteConfig = { ...DEFAUT_MELCCFP, windMaxKmh: 30 }
    const [h] = evaluateRecevabilite(r, true, cfg)
    expect(h.level).toBe('ok')
    // le texte reste dynamique sur le seuil configuré
    const [bad] = evaluateRecevabilite([mk({ windSpeed: 31 })], true, cfg)
    expect(bad.reasons[0]).toContain('≥ 30')
  })

  it('chausseeSeche : précip STRICT > precipMaxMm, HR ≤ hrDryPct', () => {
    // précip 0.05 : non sèche au défaut (>0), sèche si precipMaxMm relevé à 0.1
    expect(chausseeSeche(5, 60, 0.05, DEFAUT_MELCCFP)).toBe('non sèche')
    expect(chausseeSeche(5, 60, 0.05, { ...DEFAUT_MELCCFP, precipMaxMm: 0.1 })).toBe('sèche')
    // HR : 95 % non sèche au défaut (≤90), sèche si hrDryPct relevé à 96
    expect(chausseeSeche(-1, 95, 0, DEFAUT_MELCCFP)).toBe('non sèche')
    expect(chausseeSeche(-1, 95, 0, { ...DEFAUT_MELCCFP, hrDryPct: 96 })).toBe('sèche')
  })
})

describe('traçabilité — seuilsUtilisesLine / isMelccfpDefault', () => {
  it('défaut → mention MELCCFP + couplage précip explicite', () => {
    const s = seuilsUtilisesLine(DEFAUT_MELCCFP)
    expect(isMelccfpDefault(DEFAUT_MELCCFP)).toBe(true)
    expect(s).toContain('(MELCCFP)')
    expect(s).toContain('recevabilité ET chaussée') // couplage jamais caché
  })

  it('modifié → la valeur configurée + « non MELCCFP » apparaissent (= en-tête CSV)', () => {
    const cfg: RecevabiliteConfig = { ...DEFAUT_MELCCFP, windMaxKmh: 25 }
    const s = seuilsUtilisesLine(cfg)
    expect(isMelccfpDefault(cfg)).toBe(false)
    expect(s).toContain('25') // valeur configurée présente dans la sortie
    expect(s).toContain('non MELCCFP')
  })
})
