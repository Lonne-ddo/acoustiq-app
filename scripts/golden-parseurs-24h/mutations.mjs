#!/usr/bin/env node
/**
 * Contrôle par MUTATION du golden des parseurs > 24 h (#19) — voir README.md.
 *
 *     node scripts/golden-parseurs-24h/mutations.mjs
 *
 * Copie le projet dans un dossier TEMPORAIRE hors dépôt (node_modules relié par
 * jonction), applique UNE mutation à la fois dans le chemin temps/date des
 * parseurs, rejoue parseurs24h.golden.test.ts et compte les tests qui tombent.
 * Le dépôt n'est jamais modifié.
 *
 * Code de sortie 1 si une mutation survit, si une mutation déclarée équivalente
 * est tuée, ou si un motif n'est plus trouvé exactement une fois.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'))
const TEST = 'src/modules/parseurs24h.golden.test.ts'
const FD = 'src/modules/formatDetectors.ts'
const CSV = 'src/modules/csvParser.ts'

/** [nom, fichier, motif exact (unique), remplacement, équivalente?] */
const MUTATIONS = [
  ['P1 gigue sur t (×(1+1e-12))', FD, 'return ((frac * 1440) % 1440 + 1440) % 1440', 'return ((frac * 1440 * (1 + 1e-12)) % 1440 + 1440) % 1440'],
  ['P2 date xlsx = DERNIÈRE ligne', FD, 'if (!Number.isFinite(firstDays)) firstDays = cm.readTimeDays(getCell)', 'firstDays = cm.readTimeDays(getCell)'],
  ['P3 date CSV = DERNIÈRE ligne', CSV, 'if (!Number.isFinite(firstDays)) firstDays = cm.readTimeDays(getCell)', 'firstDays = cm.readTimeDays(getCell)'],
  ['P4 Date+Temps : jour décalé de +1', FD, 'const dayPart = Number.isFinite(dDays) ? Math.floor(dDays) : 0', 'const dayPart = Number.isFinite(dDays) ? Math.floor(dDays) + 1 : 0'],
  ['P5 g4-en : date data-first', FD, "dateStrategy: 'summary-first',", "dateStrategy: 'data-first',"],
  ['P6 marqueurs non sautés', FD, "if (rt !== null && rt !== '' && rt !== undefined) return null", 'if (false) return null'],
  ['P7 date CSV décalée de −1 j', CSV, 'date: serialDaysToISO(firstDays), // data-first', 'date: serialDaysToISO(firstDays - 1), // data-first'],
]

const EXCLUS = new Set(['node_modules', '.git', '.local-data', 'dist'])

function copie() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutations-parseurs24h-'))
  for (const e of fs.readdirSync(ROOT)) {
    if (EXCLUS.has(e)) continue
    fs.cpSync(path.join(ROOT, e), path.join(dir, e), { recursive: true })
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  return dir
}

/** Tests en échec dans le fichier du golden (suite qui ne charge pas = « ∞ »). */
function rejouer(dir) {
  const out = path.join(dir, 'resultat-vitest.json')
  try {
    execSync(`npx vitest run ${TEST} --reporter=json --outputFile=${JSON.stringify(out)}`, { cwd: dir, stdio: 'ignore' })
  } catch { /* des tests qui tombent = code de sortie ≠ 0 : attendu */ }
  const r = JSON.parse(fs.readFileSync(out, 'utf8'))
  const s = r.testResults.find((t) => t.name.split(path.sep).join('/').endsWith(TEST))
  const total = s ? s.assertionResults.length : 0
  const ko = s ? (s.status === 'failed' && total === 0 ? '∞' : s.assertionResults.filter((a) => a.status !== 'passed').length) : '?'
  return { ko, total }
}

const dir = copie()
const originaux = new Map([FD, CSV].map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]))
let anomalies = 0
try {
  const base = rejouer(dir)
  if (base.ko !== 0) throw new Error('le golden ne passe pas sur le code NON muté : contrôle impossible')
  console.log(`Référence : ${base.total} tests du golden, tous verts.\n`)
  console.log('Mutation'.padEnd(36) + 'tombent'.padEnd(10) + 'verdict')
  for (const [nom, fichier, motif, remplacement, equivalente] of MUTATIONS) {
    const orig = originaux.get(fichier)
    const n = orig.split(motif).length - 1
    if (n !== 1) { console.log(`${nom.padEnd(36)}MOTIF TROUVÉ ${n} FOIS — le code a changé, mettre la liste à jour`); anomalies++; continue }
    fs.writeFileSync(path.join(dir, fichier), orig.replace(motif, remplacement))
    const r = rejouer(dir)
    fs.writeFileSync(path.join(dir, fichier), orig)
    const tombe = r.ko !== 0
    let verdict
    if (equivalente) { verdict = tombe ? 'ANOMALIE : déclarée équivalente mais tuée' : 'survit (équivalente)'; if (tombe) anomalies++ }
    else { verdict = tombe ? 'tuée' : 'SURVIT — trou de test'; if (!tombe) anomalies++ }
    console.log(nom.padEnd(36) + String(r.ko).padEnd(10) + verdict)
    if (equivalente) console.log(' '.repeat(4) + equivalente)
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
console.log(anomalies ? `\n${anomalies} anomalie(s).` : '\nToutes les mutations non équivalentes sont tuées.')
process.exit(anomalies ? 1 : 0)
