import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { evaluerFenetres, type PointResult } from './conformiteFenetre'
import { CAS_FENETRE } from './conformiteFenetre.fixtures'
import { canon } from './serialisationCanonique'
import golden from './conformiteFenetre.golden.json'

/**
 * NON-RÉGRESSION de la fenêtre LAr,1h : la fonction extraite du composant doit
 * produire, champ par champ, EXACTEMENT ce que produisait le code de main
 * (golden figé sur main@f01b6d9 par exécution du code d'origine extrait tel
 * quel — cf. `provenance` du JSON). Égalité STRICTE via la sérialisation
 * canonique (NaN, -0, undefined distingués), sans tolérance.
 *
 * Les champs AJOUTÉS depuis (couverture) sont retirés avant comparaison : ils
 * n'existaient pas sur main ; leur exactitude est testée à part.
 */
const CHAMPS_AJOUTES = ['couverture'] as const

function sansAjouts(r: PointResult[]): unknown[] {
  return r.map((x) => {
    const o: Record<string, unknown> = { ...x }
    for (const k of CHAMPS_AJOUTES) delete o[k]
    return o
  })
}

const G = (golden as { cas: Record<string, { sha256: string; resume: unknown[] }> }).cas

describe('fenêtre LAr,1h — non-régression stricte vs main', () => {
  it('le golden couvre tous les cas des fixtures, et rien de plus', () => {
    expect(Object.keys(G).sort()).toEqual(CAS_FENETRE.map((c) => c.id).sort())
  })

  for (const c of CAS_FENETRE) {
    it(`${c.id} — ${c.titre}`, () => {
      const res = evaluerFenetres(c.entree())
      const h = createHash('sha256').update(canon(sansAjouts(res))).digest('hex')
      // Message utile en cas d'écart : les grandeurs réglementaires, lisibles.
      const resume = res.map((r) => ({ point: r.point, ba: r.ba, bp: r.bp, bpReason: r.bpReason, kt: r.kt, ki: r.ki, kb: r.kb, ks: r.ks, lar: r.lar, pass: r.pass, count: r.count }))
      expect(resume).toEqual(G[c.id].resume)
      expect(h).toBe(G[c.id].sha256)
    })
  }
})
