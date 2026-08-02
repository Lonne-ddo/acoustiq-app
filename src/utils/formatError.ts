/**
 * Erreur de format porteuse d'un diagnostic (feuilles / en-têtes vus, bande
 * hors table de pondération…). Module FEUILLE volontairement isolé : les
 * utilitaires purs (`weighting`, `spectraColumns`) doivent pouvoir la lever
 * sans dépendre de `modules/formatDetectors`, qui lui-même les importe.
 * `formatDetectors` la ré-exporte pour ne casser aucun import existant.
 */
export class FormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormatError'
  }
}
