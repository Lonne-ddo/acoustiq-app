/**
 * Utilitaires de calcul acoustique
 */

/**
 * Calcule la moyenne énergétique (LAeq) d'un tableau de niveaux en dB
 */
export function laeqAvg(values: number[]): number {
  if (values.length === 0) return 0
  const sum = values.reduce((acc, v) => acc + Math.pow(10, v / 10), 0)
  return 10 * Math.log10(sum / values.length)
}

/**
 * Calcule le percentile Lx à partir d'un tableau de niveaux en dB
 * @param values - tableau de niveaux dB
 * @param percentile - percentile souhaité (ex: 90 pour L90)
 */
function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => b - a) // tri décroissant
  const index = Math.round((percentile / 100) * (sorted.length - 1))
  return sorted[index]
}

/**
 * Calcule le L90 (niveau de bruit résiduel) d'un tableau de niveaux en dB
 */
export function computeL90(values: number[]): number {
  return computePercentile(values, 90)
}

/**
 * Calcule le L10 (niveau de bruit de pointe) d'un tableau de niveaux en dB
 */
export function computeL10(values: number[]): number {
  return computePercentile(values, 10)
}

/**
 * Calcule le L50 (niveau médian) d'un tableau de niveaux en dB
 */
export function computeL50(values: number[]): number {
  return computePercentile(values, 50)
}

/**
 * Calcule la puissance acoustique Lw à partir d'un niveau de pression Lp
 * en champ libre sphérique (atténuation géométrique 6 dB/doublement de distance)
 * @param lp - niveau de pression acoustique en dB(A)
 * @param d  - distance source-récepteur en mètres
 */
export function attenuationFreeField(lp: number, d: number): number {
  return lp + 20 * Math.log10(d) + 11
}

/**
 * Retourne le niveau maximum instantané (LAFmax)
 */
export function computeLAFmax(values: number[]): number {
  if (values.length === 0) return 0
  return Math.max(...values)
}

/**
 * Retourne le niveau minimum instantané (LAFmin)
 */
export function computeLAFmin(values: number[]): number {
  if (values.length === 0) return 0
  return Math.min(...values)
}
