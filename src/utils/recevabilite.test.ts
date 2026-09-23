import { describe, it, expect } from 'vitest'
import { REG_PERIODS, regPeriodOfHour, leqOnRegPeriod, type RegPeriod } from './acoustics'
import {
  periodLabel,
  evaluateRecevabilite,
  chausseeSeche,
  chausseeSecheDetail,
  verdictHeure,
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

/**
 * Verdict UNIFIÉ. Deux garanties, sur une grille exhaustive de valeurs, de
 * seuils et d'options :
 *  1. le niveau porté par les étapes = le `level` retourné (l'explication
 *     affichée ne peut pas contredire le verdict — défaut du standalone) ;
 *  2. niveau ET motifs = ceux de l'implémentation d'avant l'unification
 *     (copie FIGÉE ci-dessous, main@02f7626) : l'unification ne change aucun
 *     verdict.
 */
describe('verdictHeure — une seule fonction de verdict', () => {
  /** COPIE FIGÉE de la boucle d'evaluateRecevabilite, main@02f7626. Ne pas modifier. */
  function verdictAvantUnification(
    row: MeteoHourRow,
    asphalt: boolean,
    config: RecevabiliteConfig,
  ): { level: string; reasons: string[] } {
    const cs = (temp: number | null, hr: number | null, precip: number | null) => {
      if (precip == null || temp == null) return null
      if (precip > config.precipMaxMm) return 'non sèche'
      if (temp > 0) return 'sèche'
      if (hr == null) return null
      return hr <= config.hrDryPct ? 'sèche' : 'non sèche'
    }
    const reasons: string[] = []
    let level = 'ok'
    if (row.windSpeed != null && row.windSpeed >= config.windMaxKmh) {
      reasons.push(`vent ${row.windSpeed.toFixed(1)} km/h ≥ ${config.windMaxKmh}`)
      level = 'bad'
    }
    if (row.precipitation != null && row.precipitation > config.precipMaxMm) {
      reasons.push(`précip. ${row.precipitation.toFixed(1)} mm > ${config.precipMaxMm}`)
      level = 'bad'
    }
    if (level === 'ok' && asphalt) {
      if (cs(row.temperature, row.humidity, row.precipitation) === 'non sèche') {
        reasons.push('chaussée non sèche')
        level = 'warn'
      }
    }
    return { level, reasons }
  }

  const configs: RecevabiliteConfig[] = [
    DEFAUT_MELCCFP,
    { windMaxKmh: 30, precipMaxMm: 0.2, hrDryPct: 95 },
  ]
  const winds = [null, 5, 20, 25, 30, 31]
  const precips = [null, 0, 0.1, 0.2, 0.3]
  const temps = [null, -5, 0, 5]
  const hrs = [null, 85, 90, 95, 96]

  const grille: { row: MeteoHourRow; asphalt: boolean; config: RecevabiliteConfig }[] = []
  for (const config of configs)
    for (const asphalt of [true, false])
      for (const windSpeed of winds)
        for (const precipitation of precips)
          for (const temperature of temps)
            for (const humidity of hrs)
              grille.push({
                row: { datetime: '2026-01-15T08:00', temperature, humidity, precipitation, windSpeed, windDirection: null },
                asphalt,
                config,
              })

  it(`grille de ${grille.length} combinaisons : niveau des étapes = level retourné`, () => {
    for (const { row, asphalt, config } of grille) {
      const v = verdictHeure(row, asphalt, config)
      const attendu = v.steps.some((s) => s.cls === 'bad') ? 'bad'
        : v.steps.some((s) => s.cls === 'warn') ? 'warn' : 'ok'
      expect(v.level, JSON.stringify({ row, asphalt, config })).toBe(attendu)
    }
  })

  it('même grille : niveau ET motifs identiques à l’implémentation d’avant', () => {
    for (const { row, asphalt, config } of grille) {
      const v = verdictHeure(row, asphalt, config)
      const avant = verdictAvantUnification(row, asphalt, config)
      const ctx = JSON.stringify({ row, asphalt, config })
      expect(v.level, ctx).toBe(avant.level)
      expect(v.reasons, ctx).toEqual(avant.reasons)
    }
  })

  it('DÉFAUT DU STANDALONE : asphalte décoché, chaussée gelée humide → étape neutre, verdict recevable', () => {
    const row = { temperature: -5, humidity: 99, precipitation: 0, windSpeed: 5 }
    const v = verdictHeure(row, false, DEFAUT_MELCCFP)
    expect(v.level).toBe('ok')
    const etape = v.steps.find((s) => s.label.startsWith('Chaussée'))!
    expect(etape.cls).toBe('skip')
    expect(etape.result).toBe('critère non applicable')
    expect(v.steps.some((s) => s.result === 'À SIGNALER')).toBe(false)
    // Asphalte coché, même heure : à signaler, et l'étape le dit.
    const w = verdictHeure(row, true, DEFAUT_MELCCFP)
    expect(w.level).toBe('warn')
    expect(w.steps.find((s) => s.label.startsWith('Chaussée'))!.result).toBe('À SIGNALER')
  })

  it('evaluateRecevabilite porte les étapes de verdictHeure', () => {
    const row: MeteoHourRow = { datetime: '2026-01-15T08:00', temperature: 5, humidity: 60, precipitation: 0, windSpeed: 25, windDirection: null }
    const [h] = evaluateRecevabilite([row])
    expect(h.steps).toEqual(verdictHeure(row).steps)
    expect(h.level).toBe('bad')
  })

  it('chausseeSeche = chausseeSecheDetail(...).state', () => {
    for (const t of temps) for (const hr of hrs) for (const p of precips)
      expect(chausseeSeche(t, hr, p)).toBe(chausseeSecheDetail(t, hr, p).state)
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
