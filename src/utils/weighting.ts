/**
 * Tables de pondération fréquentielle (CEI 61672) par bande tiers d'octave,
 * COMPLÈTES de 6.3 Hz à 20 kHz — utilisées par le spectrogramme et le spectre
 * instantané pour convertir un spectre LZeq (linéaire) en LAeq / LCeq.
 *
 * Couvrir TOUTES les bandes évite les discontinuités visuelles : si une bande
 * hors plage recevait 0 dB d'atténuation alors que ses voisines sont fortement
 * atténuées, la bande apparaîtrait artificiellement « saturée » sur le
 * spectrogramme. Les 36 bandes standard sont donc toutes renseignées.
 */

export type Weighting = 'Z' | 'A' | 'C'

/** Pondération A (dB par bande tiers d'octave) — 6.3 Hz → 20 kHz. */
export const A_WEIGHTING: Record<number, number> = {
  6.3: -85.4, 8: -77.8, 10: -70.4, 12.5: -63.4, 16: -56.7, 20: -50.5,
  25: -44.7, 31.5: -39.4, 40: -34.6, 50: -30.2, 63: -26.2, 80: -22.5,
  100: -19.1, 125: -16.1, 160: -13.4, 200: -10.9, 250: -8.6, 315: -6.6,
  400: -4.8, 500: -3.2, 630: -1.9, 800: -0.8, 1000: 0.0, 1250: 0.6,
  1600: 1.0, 2000: 1.2, 2500: 1.3, 3150: 1.2, 4000: 1.0, 5000: 0.5,
  6300: -0.1, 8000: -1.1, 10000: -2.5, 12500: -4.3, 16000: -6.6, 20000: -9.3,
}

/** Pondération C (dB par bande tiers d'octave) — 6.3 Hz → 20 kHz. */
export const C_WEIGHTING: Record<number, number> = {
  6.3: -21.3, 8: -17.7, 10: -14.3, 12.5: -11.2, 16: -8.5, 20: -6.2,
  25: -4.4, 31.5: -3.0, 40: -2.0, 50: -1.3, 63: -0.8, 80: -0.5,
  100: -0.3, 125: -0.2, 160: -0.1, 200: 0.0, 250: 0.0, 315: 0.0,
  400: 0.0, 500: 0.0, 630: 0.0, 800: 0.0, 1000: 0.0, 1250: 0.0,
  1600: -0.1, 2000: -0.2, 2500: -0.3, 3150: -0.5, 4000: -0.8, 5000: -1.3,
  6300: -2.0, 8000: -3.0, 10000: -4.4, 12500: -6.2, 16000: -8.5, 20000: -11.2,
}

/**
 * Vecteur d'atténuation (dB) à ajouter bande par bande pour passer de LZeq à la
 * pondération demandée. En Z (linéaire), atténuation nulle partout. Une bande
 * absente de la table reçoit 0 dB (ne devrait pas arriver : tables complètes).
 */
export function weightingVector(freqs: number[], w: Weighting): number[] {
  if (w === 'Z') return freqs.map(() => 0)
  const table = w === 'A' ? A_WEIGHTING : C_WEIGHTING
  return freqs.map((f) => table[f] ?? 0)
}
