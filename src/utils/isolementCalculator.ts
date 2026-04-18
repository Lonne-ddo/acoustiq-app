/**
 * Moteur de calcul de l'isolement acoustique entre deux locaux (ISO 12354-1).
 *
 * Formule fondamentale :
 *   L2(f) = L1(f) - R'(f) + 10·log10(S / A(f))
 *   A = 0.16 · V / T   (Sabine)
 *
 * L1(f)  niveau d'émission par bande tiers d'octave (dB)
 * R'(f)  indice d'affaiblissement APPARENT (incluant flancs) = R(f) - ΔR_flanc
 * S      surface totale des parois séparatives (m²)
 * A(f)   absorption équivalente de la pièce réceptrice (m²)
 * V,T    volume (m³) et temps de réverbération (s) de la pièce réceptrice
 *
 * Parois en parallèle (loi énergétique) :
 *   R'_global(f) = -10·log10( Σ (Si/Stot) · 10^(-R'i(f)/10) )
 *
 * Global en dB(A) :
 *   L2,A = 10·log10( Σ 10^((L2(f) + A_w(f)) / 10) )
 */

import { WALL_BANDS } from '../data/wallDatabase'

/** Pondération A (IEC 61672-1) aux 18 bandes tiers d'octave 100–5000 Hz. */
export const A_WEIGHTING_18: Record<string, number> = {
  '100': -19.1, '125': -16.1, '160': -13.4, '200': -10.9, '250': -8.6,
  '315': -6.6,  '400': -4.8,  '500': -3.2,  '630': -1.9,  '800': -0.8,
  '1000': 0.0,  '1250': 0.6,  '1600': 1.0,  '2000': 1.2,  '2500': 1.3,
  '3150': 1.2,  '4000': 1.0,  '5000': 0.5,
}

/** Spectres normalisés utilisés pour générer L1(f) à partir d'un Lp(A) global.
 *  Chaque profil est un vecteur de 18 valeurs en dB. Après ajout de la pondération A
 *  et sommation énergétique, le résultat est calibré à 0 dB(A). Pour obtenir un
 *  spectre correspondant à Lp(A) = X dB(A), on ajoute X à toutes les valeurs.
 *
 *  Bruit rose : densité 1/f → niveaux tiers d'octave constants.
 *  Trafic routier : forme Ctr (ISO 717-1) — basses fréquences dominantes.
 *  Industriel : peaks mi-bande 500–1000 Hz (machines tournantes, ventilation).
 *  Parole : spectre LTASS (peak 500 Hz, chute ±1 kHz).
 */
type SourceSpectrumShape = 'pink' | 'road' | 'industrial' | 'speech'

// Formes relatives (dB) — arbitraires, la fonction `levelsForSource` les
// recalibre ensuite pour que leur somme A-pondérée soit 0 dB(A).
const SHAPE_PINK: number[] = new Array(18).fill(0)
const SHAPE_ROAD: number[] = [
  // dominante basse-fréquence (véhicules lourds + pneus)
  2, 2, 1, 0, -1, -2, -3, -4, -5, -7, -9, -11, -13, -15, -17, -19, -21, -23,
]
const SHAPE_INDUSTRIAL: number[] = [
  // creux basses, bosse centrale 500–1250 Hz, déclin HF
  -4, -3, -2, -1, 0, 1, 2, 3, 3, 3, 2, 1, 0, -2, -4, -6, -8, -10,
]
const SHAPE_SPEECH: number[] = [
  // LTASS (Byrne & al.) : peak ~500 Hz, forte chute au-dessus de 4 kHz
  -15, -12, -8, -4, -1, 1, 2, 3, 3, 2, 1, 0, -2, -4, -7, -10, -13, -16,
]

function shapeForSource(kind: SourceSpectrumShape): number[] {
  switch (kind) {
    case 'pink':       return SHAPE_PINK
    case 'road':       return SHAPE_ROAD
    case 'industrial': return SHAPE_INDUSTRIAL
    case 'speech':     return SHAPE_SPEECH
  }
}

/**
 * Renvoie les 18 niveaux L1(f) (dB, non pondérés) correspondant à un niveau
 * global Lp(A) pour le type de spectre choisi. Les valeurs retournées sont
 * calibrées pour que 10·log10(Σ 10^((L+Aw)/10)) = lpA.
 */
export function levelsForSource(lpA: number, kind: SourceSpectrumShape): Record<string, number> {
  const shape = shapeForSource(kind)
  // Calibration : on cherche C tel que 10·log10(Σ 10^((shape_i + C + Aw_i)/10)) = lpA.
  let sum = 0
  for (let i = 0; i < WALL_BANDS.length; i++) {
    const f = WALL_BANDS[i]
    sum += Math.pow(10, (shape[i] + A_WEIGHTING_18[String(f)]) / 10)
  }
  const c = lpA - 10 * Math.log10(sum)
  const out: Record<string, number> = {}
  for (let i = 0; i < WALL_BANDS.length; i++) {
    out[String(WALL_BANDS[i])] = shape[i] + c
  }
  return out
}

export type SourceKind = SourceSpectrumShape

/** Calcule l'absorption équivalente de Sabine A = 0.16·V/T (m²). */
export function sabineAbsorption(volumeM3: number, rtSeconds: number): number {
  if (!Number.isFinite(volumeM3) || !Number.isFinite(rtSeconds) || rtSeconds <= 0) return 0
  return 0.16 * volumeM3 / rtSeconds
}

/** Paroi entrant dans le calcul, avec son spectre R(f) (sans correction flancs). */
export interface IsoWallInput {
  id: string
  name: string
  area: number  // m²
  R_by_band: Record<string, number>
}

/**
 * Combine énergétiquement plusieurs parois en parallèle pour obtenir R'_global(f).
 *
 *   R'_global(f) = -10·log10( Σ (Si/Stot) · 10^(-R'_i(f)/10) )
 *
 * @param walls parois séparatives (chacune avec sa surface et R par bande)
 * @param flankCorrectionDb correction forfaitaire des transmissions latérales (dB, ≤ 0)
 */
export function combinedApparentR(
  walls: IsoWallInput[],
  flankCorrectionDb: number,
): { R_prime_by_band: Record<string, number>; Stot: number } {
  const Stot = walls.reduce((s, w) => s + Math.max(0, w.area), 0)
  const out: Record<string, number> = {}
  if (Stot <= 0) {
    for (const f of WALL_BANDS) out[String(f)] = 0
    return { R_prime_by_band: out, Stot }
  }
  for (const f of WALL_BANDS) {
    const key = String(f)
    let sum = 0
    for (const w of walls) {
      if (w.area <= 0) continue
      const R = w.R_by_band[key] ?? 0
      const Rprime = R + flankCorrectionDb  // flankCorrectionDb est négatif (ex: -5)
      sum += (w.area / Stot) * Math.pow(10, -Rprime / 10)
    }
    out[key] = sum > 0 ? -10 * Math.log10(sum) : 0
  }
  return { R_prime_by_band: out, Stot }
}

/** Résultat détaillé du calcul d'isolement par bande + global. */
export interface IsolementResult {
  bands: Array<{
    freq: number
    L1: number         // dB non pondéré
    Rprime: number     // dB
    L2: number         // dB non pondéré
    L2_A: number       // dB(A) (L2 + pondération A)
  }>
  Stot: number
  A: number            // m² absorption équivalente (constante sur bande dans ce modèle)
  L2_A_global: number  // dB(A)
  L1_A_global: number  // dB(A) — utile pour contrôle de cohérence
}

/**
 * Calcul principal d'isolement acoustique.
 *
 * @param L1_by_band niveau d'émission par bande (dB non pondéré)
 * @param walls      parois séparatives
 * @param volumeM3   volume de la pièce réceptrice (m³)
 * @param rtSeconds  temps de réverbération de la pièce réceptrice (s)
 * @param flankCorrectionDb correction flancs (dB, ≤ 0, typique −5)
 */
export function computeIsolement(
  L1_by_band: Record<string, number>,
  walls: IsoWallInput[],
  volumeM3: number,
  rtSeconds: number,
  flankCorrectionDb: number,
): IsolementResult {
  const { R_prime_by_band, Stot } = combinedApparentR(walls, flankCorrectionDb)
  const A = sabineAbsorption(volumeM3, rtSeconds)
  const sToA = A > 0 && Stot > 0 ? 10 * Math.log10(Stot / A) : 0

  const bands: IsolementResult['bands'] = []
  let sumL1A = 0
  let sumL2A = 0
  for (const f of WALL_BANDS) {
    const key = String(f)
    const L1 = L1_by_band[key] ?? 0
    const Rp = R_prime_by_band[key] ?? 0
    const L2 = L1 - Rp + sToA
    const Aw = A_WEIGHTING_18[key] ?? 0
    const L2_A = L2 + Aw
    bands.push({ freq: f, L1, Rprime: Rp, L2, L2_A })
    sumL1A += Math.pow(10, (L1 + Aw) / 10)
    sumL2A += Math.pow(10, L2_A / 10)
  }

  return {
    bands,
    Stot,
    A,
    L1_A_global: sumL1A > 0 ? 10 * Math.log10(sumL1A) : 0,
    L2_A_global: sumL2A > 0 ? 10 * Math.log10(sumL2A) : 0,
  }
}

/**
 * Niveau global A-pondéré à partir d'un spectre par bande (dB non pondéré).
 * Utilitaire pour afficher le L1 global à partir d'un spectre mesuré.
 */
export function globalDBA(byBand: Record<string, number>): number {
  let s = 0
  for (const f of WALL_BANDS) {
    const key = String(f)
    const L = byBand[key]
    if (!Number.isFinite(L)) continue
    s += Math.pow(10, (L + (A_WEIGHTING_18[key] ?? 0)) / 10)
  }
  return s > 0 ? 10 * Math.log10(s) : 0
}

/** Valeurs typiques de temps de réverbération par type de local (s). */
export const TYPICAL_RT: Array<{ label: string; value: number }> = [
  { label: 'Bureau',          value: 0.5 },
  { label: 'Chambre',         value: 0.5 },
  { label: 'Salon',           value: 0.6 },
  { label: 'Salle de classe', value: 0.8 },
  { label: 'Industriel',      value: 1.5 },
]
