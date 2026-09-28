/**
 * Corps du générateur. Fige le golden de la fenêtre LAr,1h en exécutant le
 * code D'ORIGINE — celui de main@f01b6d9, avant l'extraction dans
 * conformiteFenetre.ts — jamais le code courant.
 *
 * 1. `git show REF:` des modules d'origine dans un dossier TEMPORAIRE hors dépôt :
 *    Conformite2026.tsx, acoustics.ts, spectraProvenance.ts (ces deux-là n'ont
 *    que des imports `type`, effacés à l'exécution : aucune arborescence à
 *    reconstituer).
 * 2. Extraction TEXTUELLE, par programme, des helpers (LIMITS, num,
 *    hhmmToMinutes) et des corps des trois useMemo (pointNames, dataByPoint,
 *    results), assemblés tels quels dans une fonction.
 * 3. Exécution sur les cas de conformiteFenetre.fixtures.ts (arbre de travail :
 *    ce sont les ENTRÉES, communes au golden et au test).
 * 4. Empreinte = SHA-256 de canon(PointResult[]), résumé lisible des grandeurs
 *    réglementaires — exactement ce que compare conformiteFenetre.golden.test.ts.
 *
 * Garde-fou : les cas DÉJÀ présents dans le JSON doivent être reproduits à
 * l'identique, sinon le générateur refuse d'écrire (il ne reproduirait pas le
 * protocole d'origine). Seuls les cas absents du JSON sont ajoutés ; aucun cas
 * existant n'est jamais réécrit.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { CAS_FENETRE } from '../../src/utils/conformiteFenetre.fixtures.ts'
import { canon } from '../../src/utils/serialisationCanonique.ts'

export const REF = 'f01b6d9'
const ROOT_DIR = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'))
const GOLDEN = path.join(ROOT_DIR, 'src/utils/conformiteFenetre.golden.json')

const gitShow = (p) => execFileSync('git', ['show', `${REF}:${p}`], { cwd: ROOT_DIR, encoding: 'utf8', maxBuffer: 64 << 20 })

/** Texte entre l'accolade ouvrante à `from` et son accolade fermante (exclues). */
function blocAccolades(src, from) {
  const open = src.indexOf('{', from)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i)
  }
  throw new Error('accolade non fermée')
}

/** Corps de `const <nom> ... = useMemo(() => { … }` dans le composant d'origine. */
function corpsUseMemo(src, nom) {
  const re = new RegExp('const ' + nom + String.raw`(?::[^=]+)? = useMemo\(\(\) => \{`)
  const m = re.exec(src)
  if (!m) throw new Error(`useMemo « ${nom} » introuvable dans ${REF}`)
  return blocAccolades(src, m.index + m[0].length - 1)
}

/** Déclaration de premier niveau (`const X` / `function X`) jusqu'à sa fin. */
function declaration(src, debut) {
  const i = src.indexOf(debut)
  if (i < 0) throw new Error(`« ${debut} » introuvable dans ${REF}`)
  const corps = blocAccolades(src, i)
  const fin = src.indexOf(corps, i) + corps.length + 1
  return src.slice(i, fin)
}

/** Module d'origine assemblé dans un dossier temporaire ; renvoie son évaluateur. */
export async function chargerOrigine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-fenetre-'))
  fs.writeFileSync(path.join(dir, 'acoustics.ts'), gitShow('src/utils/acoustics.ts'))
  fs.writeFileSync(path.join(dir, 'spectraProvenance.ts'), gitShow('src/utils/spectraProvenance.ts'))
  const comp = gitShow('src/components/Conformite2026.tsx')
  const module = [
    `// Assemblé par scripts/golden-fenetre depuis ${REF}:src/components/Conformite2026.tsx — NE PAS éditer.`,
    `import { laeqAvg, extractBp, analyzeKt, computeKb, computeKi, computeLar1h, filterDataByPeriods } from './acoustics.ts'`,
    `import { spectraFreqsForPoint } from './spectraProvenance.ts'`,
    declaration(comp, 'const LIMITS'),
    declaration(comp, 'function num('),
    declaration(comp, 'function hhmmToMinutes('),
    `export function evaluerOrigine(e) {`,
    `  const { files, pointMap, selectedDate, periods, categories, evalHour, period, brJour, brNuit, receptor, ktManual, kiManual, ksEnabled, ksValue, ksReason } = e`,
    `  const pointNames = (() => {${corpsUseMemo(comp, 'pointNames')}})()`,
    `  const dataByPoint = (() => {${corpsUseMemo(comp, 'dataByPoint')}})()`,
    `  return (() => {${corpsUseMemo(comp, 'results')}})()`,
    `}`,
  ].join('\n\n')
  const fichier = path.join(dir, 'fenetreOrigine.ts')
  fs.writeFileSync(fichier, module)
  const mod = await import(pathToFileURL(fichier).href)
  return { evaluerOrigine: mod.evaluerOrigine, dir }
}

/** Résumé lisible — mêmes champs que conformiteFenetre.golden.test.ts. */
const resumer = (res) => res.map((r) => ({ point: r.point, ba: r.ba, bp: r.bp, bpReason: r.bpReason, kt: r.kt, ki: r.ki, kb: r.kb, ks: r.ks, lar: r.lar, pass: r.pass, count: r.count }))

export async function main(args) {
  const ecrire = args.includes('--ecrire')
  const { evaluerOrigine, dir } = await chargerOrigine()
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'))
  const ajouts = []
  let ecarts = 0
  for (const c of CAS_FENETRE) {
    const res = evaluerOrigine(c.entree())
    const entree = { sha256: createHash('sha256').update(canon(res)).digest('hex'), resume: resumer(res) }
    const existant = golden.cas[c.id]
    if (!existant) { ajouts.push([c.id, entree]); console.log(`+ ${c.id} (nouveau)`); continue }
    const identique = existant.sha256 === entree.sha256 && canon(existant.resume) === canon(JSON.parse(JSON.stringify(entree.resume)))
    console.log(`${identique ? '=' : '≠'} ${c.id}`)
    if (!identique) ecarts++
  }
  fs.rmSync(dir, { recursive: true, force: true })
  if (ecarts > 0) {
    console.error(`\n${ecarts} cas existant(s) NON reproduit(s) par le code de ${REF} : protocole rompu, rien n'est écrit.`)
    process.exit(1)
  }
  if (ajouts.length === 0) { console.log('\nGolden à jour : tous les cas existants reproduits, aucun cas nouveau.'); return }
  if (!ecrire) { console.log(`\n${ajouts.length} cas nouveau(x) à figer : relancer avec --ecrire.`); process.exit(2) }
  for (const [id, e] of ajouts) golden.cas[id] = e
  fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + '\n')
  console.log(`\n${ajouts.length} cas ajouté(s) à ${path.relative(ROOT_DIR, GOLDEN)}.`)
}
