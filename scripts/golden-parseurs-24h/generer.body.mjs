/**
 * Corps du générateur. Exécute les parseurs de l'arbre de travail sur les cas
 * de src/modules/parseurs24h.fixtures.ts et fige empreinte + résumé.
 *
 * Le golden décrit le comportement AVANT la correction de #19 (t replié à
 * minuit) : il a été figé tant que les parseurs étaient ceux de main@10671c5.
 * Garde-fou : un cas déjà présent doit être reproduit à l'identique, sinon rien
 * n'est écrit ; seuls les cas absents sont ajoutés, aucun cas existant n'est
 * réécrit. Quand la correction de #19 changera volontairement la sortie, le
 * golden sera mis à jour CAS PAR CAS, avec le tableau des changements attendus
 * — jamais régénéré en bloc.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { canon } from '../../src/utils/serialisationCanonique.ts'
import { CAS_PARSEURS_24H } from '../../src/modules/parseurs24h.fixtures.ts'
import { parserCas, resumer, empreinte } from '../../src/modules/parseurs24h.golden.ts'

const ROOT_DIR = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'))
const GOLDEN = path.join(ROOT_DIR, 'src/modules/parseurs24h.golden.json')
const PROVENANCE =
  "Figé le 2026-09-28 sur main@10671c5, AVANT la correction de #19 : sortie des parseurs de l'app " +
  "(parseCsv / parseWorkbook) sur les cas de parseurs24h.fixtures.ts, t REPLIÉ à minuit. Empreinte = " +
  "SHA-256 de la sérialisation canonique du MeasurementFile sans id. NE PAS régénérer en bloc : " +
  "toute évolution se fait cas par cas avec justification (scripts/golden-parseurs-24h/README.md)."

export async function main(args) {
  const ecrire = args.includes('--ecrire')
  const golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : { provenance: PROVENANCE, cas: {} }
  const ajouts = []
  let ecarts = 0
  for (const c of CAS_PARSEURS_24H) {
    const f = await parserCas(c)
    const entree = { sha256: empreinte(f), resume: resumer(f) }
    const existant = golden.cas[c.id]
    if (!existant) { ajouts.push([c.id, entree]); console.log(`+ ${c.id} (nouveau) : ${JSON.stringify(entree.resume)}`); continue }
    const identique = existant.sha256 === entree.sha256 && canon(existant.resume) === canon(JSON.parse(JSON.stringify(entree.resume)))
    console.log(`${identique ? '=' : '≠'} ${c.id}`)
    if (!identique) ecarts++
  }
  if (ecarts > 0) {
    console.error(`\n${ecarts} cas existant(s) NON reproduit(s) : rien n'est écrit.`)
    process.exit(1)
  }
  if (ajouts.length === 0) { console.log('\nGolden à jour : tous les cas existants reproduits, aucun cas nouveau.'); return }
  if (!ecrire) { console.log(`\n${ajouts.length} cas nouveau(x) à figer : relancer avec --ecrire.`); process.exit(2) }
  for (const [id, e] of ajouts) golden.cas[id] = e
  fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + '\n')
  console.log(`\n${ajouts.length} cas ajouté(s) à ${path.relative(ROOT_DIR, GOLDEN)}.`)
}
