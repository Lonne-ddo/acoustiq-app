import { describe, it, expect } from 'vitest'
import {
  validatePeriodEdit,
  applyTimeChange,
  parseHHMMSS,
  shiftToNextDay,
  sameCivilDay,
  fmtDayMonth,
} from './periodEdit'

/** Instant local, pour que les tests ne dépendent pas du fuseau. */
const at = (y: number, mo: number, d: number, h: number, mi = 0, s = 0) =>
  new Date(y, mo - 1, d, h, mi, s).getTime()

const D1_09 = at(2026, 3, 9, 9, 0, 0)   // 09/03 09:00:00
const D1_17 = at(2026, 3, 9, 17, 0, 0)  // 09/03 17:00:00
const D1_22 = at(2026, 3, 9, 22, 0, 0)  // 09/03 22:00:00
const D2_07 = at(2026, 3, 10, 7, 0, 0)  // 10/03 07:00:00

/** Plage de mesure : 09/03 08:00 → 09/03 18:00 */
const RANGE = { startMs: at(2026, 3, 9, 8), endMs: at(2026, 3, 9, 18) }

describe('parseHHMMSS', () => {
  it('accepte HH:MM et HH:MM:SS', () => {
    expect(parseHHMMSS('09:30')).toBe(((9 * 60 + 30) * 60) * 1000)
    expect(parseHHMMSS('09:30:15')).toBe(((9 * 60 + 30) * 60 + 15) * 1000)
    expect(parseHHMMSS('9:05')).toBe(((9 * 60 + 5) * 60) * 1000)
  })

  it('refuse les valeurs hors bornes et les formats invalides', () => {
    expect(parseHHMMSS('24:00')).toBeNull()
    expect(parseHHMMSS('12:60')).toBeNull()
    expect(parseHHMMSS('12:30:60')).toBeNull()
    expect(parseHHMMSS('midi')).toBeNull()
    expect(parseHHMMSS('')).toBeNull()
  })
})

describe('applyTimeChange — chaque borne garde sa date', () => {
  it('remplace l\'heure sans changer le jour civil', () => {
    const out = applyTimeChange(D1_09, '14:30:00')
    expect(out).toBe(at(2026, 3, 9, 14, 30, 0))
    expect(sameCivilDay(out as number, D1_09)).toBe(true)
  })

  it('une borne de fin au lendemain reste au lendemain', () => {
    // Lnuit : fin le 10/03 à 07:00 → éditée à 06:00, doit rester le 10/03.
    const out = applyTimeChange(D2_07, '06:00:00')
    expect(out).toBe(at(2026, 3, 10, 6, 0, 0))
    expect(fmtDayMonth(out as number)).toBe('10/03')
  })

  it('retourne null sur une heure illisible ou une borne non finie', () => {
    expect(applyTimeChange(D1_09, 'zzz')).toBeNull()
    expect(applyTimeChange(NaN, '10:00')).toBeNull()
  })
})

describe('shiftToNextDay', () => {
  it('reporte au lendemain à la même heure locale', () => {
    expect(shiftToNextDay(at(2026, 3, 9, 7, 30))).toBe(at(2026, 3, 10, 7, 30))
  })

  it('traverse correctement une fin de mois', () => {
    expect(shiftToNextDay(at(2026, 3, 31, 22))).toBe(at(2026, 4, 1, 22))
  })
})

describe('validatePeriodEdit', () => {
  // T1 — renommer : cas nominal, rien d'autre ne bouge
  it('T1 : période valide → ok, aucun message', () => {
    const v = validatePeriodEdit({ name: 'Ambiant matin', startMs: D1_09, endMs: D1_17 }, RANGE)
    expect(v.ok).toBe(true)
    expect(v.errors).toEqual([])
    expect(v.warnings).toEqual([])
    expect(v.endBeforeStart).toBe(false)
    expect(v.spansMidnight).toBe(false)
    expect(v.outsideMeasureRange).toBe(false)
  })

  // T5 — nom vide → refus AVEC message, jamais un retour silencieux
  it('T5 : nom vide → refusé, message explicite', () => {
    const v = validatePeriodEdit({ name: '', startMs: D1_09, endMs: D1_17 }, RANGE)
    expect(v.ok).toBe(false)
    expect(v.errors).toContain('Le nom ne peut pas être vide.')
  })

  it('T5 bis : nom composé uniquement d\'espaces → refusé', () => {
    const v = validatePeriodEdit({ name: '   ', startMs: D1_09, endMs: D1_17 }, RANGE)
    expect(v.ok).toBe(false)
    expect(v.errors).toHaveLength(1)
  })

  // T3 (reformulé par D-A) — bornes inversées : AVERTISSEMENT, jamais refus
  it('T3 : fin ≤ début → accepté avec avertissement, pas une erreur', () => {
    const v = validatePeriodEdit({ name: 'Nuit', startMs: D1_22, endMs: at(2026, 3, 9, 7) }, null)
    expect(v.ok).toBe(true)
    expect(v.errors).toEqual([])
    expect(v.endBeforeStart).toBe(true)
    expect(v.warnings.join(' ')).toContain('antérieure ou égale au début')
  })

  it('T3 bis : l\'avertissement montre les DEUX dates', () => {
    const v = validatePeriodEdit({ name: 'Nuit', startMs: D1_22, endMs: at(2026, 3, 9, 7) }, null)
    const msg = v.warnings.join(' ')
    expect(msg).toContain('09/03 07:00:00')
    expect(msg).toContain('09/03 22:00:00')
  })

  it('T3 ter : fin strictement égale au début est traitée comme inversée', () => {
    const v = validatePeriodEdit({ name: 'Vide', startMs: D1_09, endMs: D1_09 }, null)
    expect(v.endBeforeStart).toBe(true)
    expect(v.ok).toBe(true)
  })

  // Cas Lnuit — la raison d'être de la règle « chaque borne garde sa date »
  it('Lnuit 22:00 → 07:00 le lendemain : valide, signalée à cheval sur minuit', () => {
    const v = validatePeriodEdit({ name: 'Lnuit', startMs: D1_22, endMs: D2_07 }, null)
    expect(v.ok).toBe(true)
    expect(v.endBeforeStart).toBe(false)
    expect(v.spansMidnight).toBe(true)
    expect(v.warnings.join(' ')).toContain('à cheval sur minuit (09/03 → 10/03)')
  })

  it('à cheval sur minuit et bornes inversées sont mutuellement exclusifs', () => {
    const v = validatePeriodEdit({ name: 'X', startMs: D1_22, endMs: D2_07 }, null)
    expect(v.spansMidnight).toBe(true)
    expect(v.endBeforeStart).toBe(false)
    expect(v.warnings).toHaveLength(1)
  })

  // T4 — hors plage de mesure : accepté avec avertissement visible
  it('T4 : période après la fin des mesures → acceptée avec avertissement', () => {
    // Le cas réel : 16:37–16:52 sur un fichier qui s'arrête à 14:48.
    const range = { startMs: at(2026, 3, 9, 8), endMs: at(2026, 3, 9, 14, 48) }
    const v = validatePeriodEdit(
      { name: 'Hors plage', startMs: at(2026, 3, 9, 16, 37), endMs: at(2026, 3, 9, 16, 52) },
      range,
    )
    expect(v.ok).toBe(true)
    expect(v.outsideMeasureRange).toBe(true)
    expect(v.warnings.join(' ')).toContain('Hors de la plage de mesure')
  })

  it('T4 bis : période commençant avant le début des mesures → avertissement', () => {
    const v = validatePeriodEdit({ name: 'Tôt', startMs: at(2026, 3, 9, 6), endMs: D1_17 }, RANGE)
    expect(v.ok).toBe(true)
    expect(v.outsideMeasureRange).toBe(true)
  })

  it('T4 ter : période strictement incluse dans la plage → aucun avertissement', () => {
    const v = validatePeriodEdit({ name: 'Dedans', startMs: D1_09, endMs: D1_17 }, RANGE)
    expect(v.outsideMeasureRange).toBe(false)
    expect(v.warnings).toEqual([])
  })

  it('T4 quater : sans plage de mesure fournie, aucun contrôle de plage', () => {
    const v = validatePeriodEdit({ name: 'Libre', startMs: at(2026, 1, 1, 3), endMs: at(2026, 1, 1, 4) })
    expect(v.outsideMeasureRange).toBe(false)
    expect(v.warnings).toEqual([])
    const vNull = validatePeriodEdit({ name: 'Libre', startMs: D1_09, endMs: D1_17 }, null)
    expect(vNull.outsideMeasureRange).toBe(false)
  })

  it('T4 quinquies : une plage de mesure non finie est ignorée', () => {
    const v = validatePeriodEdit(
      { name: 'X', startMs: D1_09, endMs: D1_17 },
      { startMs: NaN, endMs: NaN },
    )
    expect(v.outsideMeasureRange).toBe(false)
  })

  // Bornes illisibles
  it('borne illisible → refus bloquant', () => {
    const v = validatePeriodEdit({ name: 'X', startMs: NaN, endMs: D1_17 }, RANGE)
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toContain('Heure de début illisible')
  })

  it('les erreurs se cumulent', () => {
    const v = validatePeriodEdit({ name: '', startMs: NaN, endMs: NaN }, RANGE)
    expect(v.ok).toBe(false)
    expect(v.errors).toHaveLength(3)
  })

  it('un nom vide n\'empêche pas de calculer les avertissements de bornes', () => {
    const v = validatePeriodEdit({ name: '', startMs: D1_22, endMs: D2_07 }, null)
    expect(v.ok).toBe(false)
    expect(v.spansMidnight).toBe(true)
  })
})
