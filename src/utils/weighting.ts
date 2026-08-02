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

import { FormatError } from './formatError'

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

// ───────────────────────────────────────────────────────────────────────────
// Dépondération A → Z (spectres mesurés en dB(A) par bande)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Bandes (Hz) sans coefficient de pondération A dans `A_WEIGHTING`. Sert de
 * garde AMONT (à la construction du plan de colonnes) : on refuse un plan
 * A-dépondéré plutôt que de produire une bande fausse en aval.
 */
export function missingAWeightBands(freqs: number[]): number[] {
  return freqs.filter((f) => !(f in A_WEIGHTING))
}

/**
 * Inverse la pondération A d'un spectre mesuré en dB(A) par bande :
 *
 *     LZ(f) = LA(f) − A(f)
 *
 * Exact à la table CEI 61672 (l'aller-retour LA → LZ → LA est neutre au bit
 * près). Utilisé par les exports G4 qui ne fournissent QUE le spectre pondéré A
 * (821SE : colonnes « 1/3 LAeq … », aucune colonne « 1/3 LZeq ») afin que
 * `DataPoint.spectra` reste TOUJOURS du LZeq — invariant de toute la chaîne
 * aval (spectrogramme, spectre instantané, analyse Kt).
 *
 * JAMAIS de NaN, JAMAIS de retombée silencieuse à 0 dB : une bande absente de la
 * table lève une `FormatError` explicite (un 0 dB muet fausserait le spectre de
 * plusieurs dizaines de dB dans les extrêmes, cf. −85,4 dB à 6,3 Hz).
 *
 * @param levels niveaux dB(A) par bande
 * @param freqs  fréquences centrales alignées sur `levels`
 */
export function deweightAToZ(levels: number[], freqs: number[]): number[] {
  if (levels.length !== freqs.length) {
    throw new FormatError(
      `Dépondération A→Z impossible : ${levels.length} niveaux pour ${freqs.length} fréquences ` +
      `(alignement bande↔fréquence rompu).`,
    )
  }
  const out = new Array<number>(levels.length)
  for (let i = 0; i < levels.length; i++) {
    const a = A_WEIGHTING[freqs[i]]
    if (a === undefined) {
      throw new FormatError(
        `Dépondération A→Z impossible : la bande ${freqs[i]} Hz n'a pas de coefficient de ` +
        `pondération A (table CEI 61672, 6,3 Hz – 20 kHz).`,
      )
    }
    out[i] = levels[i] - a
  }
  return out
}
