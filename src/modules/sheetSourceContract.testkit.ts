import { expect } from 'vitest'
import type { SheetSource } from './formatDetectors'

/**
 * SPEC EXÉCUTABLE PARTAGÉE du contrat SheetSource (cf. JSDoc SheetSource).
 *
 * Une seule spec, plusieurs implémentations : `wbSource` (Phase 1) ET `csvSource`
 * (Phase 4) DOIVENT faire passer EXACTEMENT ces assertions. La `src` fournie doit
 * avoir été construite à partir du fixture canonique suivant (mêmes valeurs
 * normalisées, quelle que soit la source) :
 *
 *   ligne 0 (en-têtes) : ['H0','H1','H2','H3']
 *   ligne 1 (données)  : [1.5, 'texte', 46000, 42]   // number | string | number | number
 *   ligne 2 (courte)   : [7, null, null, null]        // padding largeur constante
 *
 * Si une assertion échoue, c'est l'IMPLÉMENTATION qui a tort, pas la spec.
 */
export function expectSheetSourceContract(src: SheetSource, sheetName: string): void {
  expect(src.sheetNames).toEqual([sheetName])

  const rows = src.sampleRows(sheetName, 60)

  // Largeur CONSTANTE (padding inclus).
  expect(rows.map((r) => r.length)).toEqual([4, 4, 4])

  // En-têtes = strings.
  expect(rows[0]).toEqual(['H0', 'H1', 'H2', 'H3'])

  // Types par nature de cellule + valeurs exactes (identiques quelle que soit la source).
  expect(rows[1]).toEqual([1.5, 'texte', 46000, 42])
  expect(rows[1].map((v) => typeof v)).toEqual(['number', 'string', 'number', 'number'])

  // Cellules vides/absentes → null (JAMAIS undefined), padding à largeur constante.
  expect(rows[2]).toEqual([7, null, null, null])
  expect(rows[2][1]).toBeNull()
  expect(rows[2][1]).not.toBeUndefined()
}
