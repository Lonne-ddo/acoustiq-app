import { describe, it, expect } from 'vitest'
import {
  evalDiscord,
  detectDiscord,
  formatDiscord,
  DISCORD_THRESHOLDS,
} from './meteoDiscord'

describe('evalDiscord — désaccord d’une variable', () => {
  it('sources concordantes (Δ ≤ seuil) → pas de désaccord', () => {
    const r = evalDiscord([10, 12, 14], DISCORD_THRESHOLDS.temperature) // Δ=4 ≤ 5
    expect(r.disagree).toBe(false)
    expect(r.amplitude).toBe(4)
    expect(r.count).toBe(3)
  })

  it('Δ strictement > seuil → désaccord ; Δ == seuil → non (comparaison stricte)', () => {
    expect(evalDiscord([10, 15], DISCORD_THRESHOLDS.temperature).disagree).toBe(false) // Δ=5
    expect(evalDiscord([10, 15.1], DISCORD_THRESHOLDS.temperature).disagree).toBe(true) // Δ=5.1
  })

  it('1 seule source présente → JAMAIS de désaccord (amplitude null)', () => {
    const r = evalDiscord([25, null, undefined], DISCORD_THRESHOLDS.windSpeed)
    expect(r.count).toBe(1)
    expect(r.disagree).toBe(false)
    expect(r.amplitude).toBeNull()
    expect(r.min).toBe(25)
    expect(r.max).toBe(25)
  })

  it('2 présentes + 1 absente → évalué sur les 2', () => {
    const r = evalDiscord([5, null, 25], DISCORD_THRESHOLDS.windSpeed) // Δ=20 > 5
    expect(r.count).toBe(2)
    expect(r.amplitude).toBe(20)
    expect(r.disagree).toBe(true)
  })

  it('0 valeur présente → count 0, pas de désaccord', () => {
    const r = evalDiscord([null, null], DISCORD_THRESHOLDS.humidity)
    expect(r.count).toBe(0)
    expect(r.disagree).toBe(false)
    expect(r.amplitude).toBeNull()
  })

  it('NaN est traité comme absent', () => {
    const r = evalDiscord([NaN, 20], DISCORD_THRESHOLDS.windSpeed)
    expect(r.count).toBe(1)
    expect(r.disagree).toBe(false)
  })
})

describe('seuil PROPRE par variable', () => {
  it('HR : Δ12 ne déclenche pas (seuil 15) mais Δ20 oui', () => {
    expect(evalDiscord([50, 62], DISCORD_THRESHOLDS.humidity).disagree).toBe(false) // Δ12
    expect(evalDiscord([50, 70], DISCORD_THRESHOLDS.humidity).disagree).toBe(true) // Δ20
    // même Δ12 déclencherait sur la T° (seuil 5) — les échelles diffèrent bien
    expect(evalDiscord([50, 62], DISCORD_THRESHOLDS.temperature).disagree).toBe(true)
  })

  it('précip : Δ0.6 déclenche (seuil 0.5), Δ0.4 non', () => {
    expect(evalDiscord([0, 0.6], DISCORD_THRESHOLDS.precipitation).disagree).toBe(true)
    expect(evalDiscord([0, 0.4], DISCORD_THRESHOLDS.precipitation).disagree).toBe(false)
  })
})

describe('detectDiscord — une heure, toutes variables', () => {
  it('tout concordant → anyDisagree false, aucune variable', () => {
    const d = detectDiscord({
      temperature: [10, 11, 12],
      windSpeed: [8, 9, 10],
      precipitation: [0, 0, 0],
      humidity: [60, 65, 70],
    })
    expect(d.anyDisagree).toBe(false)
    expect(d.vars).toEqual([])
  })

  it('désaccord sur UNE seule variable (vent) isolé correctement', () => {
    const d = detectDiscord({
      temperature: [10, 11, 12], // Δ2
      windSpeed: [5, 12, 26], // Δ21 > 5
      precipitation: [0, 0, 0],
      humidity: [60, 65, 70], // Δ10 < 15
    })
    expect(d.anyDisagree).toBe(true)
    expect(d.vars).toEqual(['windSpeed'])
    expect(d.byVar.temperature.disagree).toBe(false)
    expect(d.byVar.humidity.disagree).toBe(false)
    expect(d.byVar.windSpeed.amplitude).toBe(21)
  })

  it('variables en désaccord listées dans l’ordre canonique', () => {
    const d = detectDiscord({
      humidity: [40, 80], // Δ40 > 15
      temperature: [5, 15], // Δ10 > 5
    })
    expect(d.vars).toEqual(['temperature', 'humidity'])
  })

  it('variable absente de l’entrée → résultat vide, jamais en désaccord', () => {
    const d = detectDiscord({ windSpeed: [5, 30] })
    expect(d.byVar.precipitation.count).toBe(0)
    expect(d.byVar.precipitation.disagree).toBe(false)
    expect(d.vars).toEqual(['windSpeed'])
  })

  it('une source absente sur une variable n’induit pas de désaccord', () => {
    const d = detectDiscord({
      temperature: [10, null, null], // 1 seule présente
      windSpeed: [5, 6, null], // 2 présentes, Δ1
    })
    expect(d.anyDisagree).toBe(false)
  })
})

describe('formatDiscord — étiquette compacte', () => {
  it('concordant → chaîne vide', () => {
    expect(formatDiscord(detectDiscord({ temperature: [10, 11] }))).toBe('')
  })

  it('formate label + Δ avec les décimales par variable', () => {
    const d = detectDiscord({ windSpeed: [5, 26], humidity: [40, 80] })
    expect(formatDiscord(d)).toBe('vent Δ21.0; HR Δ40')
  })
})
