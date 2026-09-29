import { describe, it, expect } from 'vitest'
import { CAS_PARSEURS_24H } from './parseurs24h.fixtures'
import { parserCas, resumer, empreinte } from './parseurs24h.golden'
import golden from './parseurs24h.golden.json'

/**
 * GOLDEN des parseurs sur des relevés de PLUS DE 24 h (#19), figé AVANT la
 * correction : il décrit le comportement actuel, défauts compris — `t` replié à
 * minuit (retours en arrière de `t`), date du Summary décalée d'un jour, heure
 * répétée au retour à l'heure normale. Égalité STRICTE (empreinte de la sortie
 * complète + résumé lisible).
 *
 * La correction de #19 CHANGERA volontairement ces sorties : le golden sera
 * alors mis à jour cas par cas, avec le tableau des changements attendus et leur
 * justification (scripts/golden-parseurs-24h/README.md) — jamais régénéré en bloc.
 */
const G = (golden as { cas: Record<string, { sha256: string; resume: unknown }> }).cas

describe('parseurs, relevés > 24 h — non-régression stricte (avant #19)', () => {
  it('le golden couvre tous les cas des fixtures, et rien de plus', () => {
    expect(Object.keys(G).sort()).toEqual(CAS_PARSEURS_24H.map((c) => c.id).sort())
  })

  for (const c of CAS_PARSEURS_24H) {
    it(`${c.id} — ${c.titre}`, async () => {
      const f = await parserCas(c)
      expect(resumer(f)).toEqual(G[c.id].resume)
      expect(empreinte(f)).toBe(G[c.id].sha256)
    })
  }
})
