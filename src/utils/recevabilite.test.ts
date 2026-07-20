import { describe, it, expect } from 'vitest'
import { REG_PERIODS, regPeriodOfHour, leqOnRegPeriod, type RegPeriod } from './acoustics'
import { periodLabel, evaluateRecevabilite, type MeteoHourRow } from './recevabilite'

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
