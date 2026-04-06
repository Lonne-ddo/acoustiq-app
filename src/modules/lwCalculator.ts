/**
 * Module de calcul de puissance acoustique Lw
 * Formules conformes ISO 3744 et propagation en champ libre
 */

/**
 * Lw depuis un niveau Lp mesuré en toiture (Q=1, radiation hémisphérique)
 * Lw = Lp + 20·log10(d) + 11 − C
 */
export function lwRoof(lp: number, d: number, correction: number): number {
  return lp + 20 * Math.log10(d) + 11 - correction
}

/**
 * Lw depuis un niveau Lp mesuré au sol (Q=2, quart de sphère)
 * Lw = Lp + 20·log10(d) + 8 − C
 */
export function lwGround(lp: number, d: number, correction: number): number {
  return lp + 20 * Math.log10(d) + 8 - correction
}

/**
 * Lw par méthode du parallélépipède ISO 3744
 * Lw = 10·log10(Σ 10^(Lp_i/10) · S_i) − C
 * @param measurements - tableau de couples {lp: niveau en dB, area: surface en m²}
 * @param correction   - correction météorologique K2 en dB
 */
export function lwParallelepiped(
  measurements: { lp: number; area: number }[],
  correction: number,
): number {
  if (measurements.length === 0) return 0
  const sum = measurements.reduce(
    (acc, { lp, area }) => acc + Math.pow(10, lp / 10) * area,
    0,
  )
  return 10 * Math.log10(sum) - correction
}

/**
 * Combinaison logarithmique de plusieurs Lw
 * Lw_total = 10·log10(Σ 10^(Lw_i/10))
 */
export function combineLw(lwValues: number[]): number {
  if (lwValues.length === 0) return 0
  const sum = lwValues.reduce((acc, lw) => acc + Math.pow(10, lw / 10), 0)
  return 10 * Math.log10(sum)
}

/**
 * Rétro-calcul du niveau Lp à une distance d depuis un Lw connu
 * Lp = Lw − 20·log10(d) − 11 + 10·log10(q/2)
 * @param lw - puissance acoustique en dB
 * @param d  - distance source-récepteur en mètres
 * @param q  - facteur de directivité (1 = hémisphère, 2 = quart de sphère, etc.)
 */
export function attenuationDistance(lw: number, d: number, q: number): number {
  return lw - 20 * Math.log10(d) - 11 + 10 * Math.log10(q / 2)
}
