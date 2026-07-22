/**
 * Calcul du repli « Plus » de la barre d'onglets primaires (pur, testable).
 *
 * Retourne le nombre d'onglets à garder INLINE pour tenir dans `availPx` ; le
 * reste passe dans le menu « Plus ». Deux invariants de priorité :
 *   - l'onglet d'index 0 (« Analyse ») est TOUJOURS gardé ;
 *   - on retire depuis la FIN de la liste — l'ordre = la priorité (gauche =
 *     prioritaire), donc « Diagnostic réseau » (dernier) bascule en premier.
 *
 * `hasDiag` : quand le dernier onglet (diagnostic) est visible, un séparateur le
 * précède ; sa largeur n'est comptée que dans le cas « tout tient inline ».
 */
export function computeVisibleCount(opts: {
  /** Largeur px de chaque onglet, dans l'ordre de priorité (index 0 = prioritaire). */
  widths: number[]
  /** Largeur disponible px. */
  availPx: number
  /** Largeur px du bouton « Plus ». */
  plusPx: number
  /** Écart entre éléments (défaut 4 = gap-1). */
  gapPx?: number
  /** Largeur du séparateur diagnostic (défaut 13). */
  sepPx?: number
  /** Un séparateur précède le dernier onglet s'il est rendu inline. */
  hasDiag?: boolean
}): number {
  const { widths, availPx, plusPx, gapPx = 4, sepPx = 13, hasDiag = false } = opts
  const n = widths.length
  if (n === 0) return 0

  // Tout tient (séparateur diagnostic inclus) → aucun repli.
  const totalAll = widths.reduce((s, w) => s + w, 0) + gapPx * (n - 1) + (hasDiag ? sepPx : 0)
  if (totalAll <= availPx) return n

  // Débordement : réserver la place du bouton « Plus » et garnir depuis la gauche.
  let used = 0
  let k = 0
  for (let i = 0; i < n; i++) {
    const add = widths[i] + (i > 0 ? gapPx : 0)
    if (k === 0 || used + add + plusPx + gapPx <= availPx) {
      used += add
      k = i + 1
    } else {
      break
    }
  }
  return Math.max(1, k) // « Analyse » toujours visible
}
