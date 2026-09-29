#!/usr/bin/env node
/**
 * Contrôle par MUTATION de src/utils/tempsMesure.ts (#19, lot 19.1).
 *
 *     node scripts/temps-mesure/mutations.mjs
 *
 * Même procédé que scripts/golden-parseurs-24h/mutations.mjs : copie du projet
 * dans un dossier TEMPORAIRE hors dépôt (node_modules relié par jonction), UNE
 * mutation à la fois, rejeu de tempsMesure.test.ts, décompte des tests qui
 * tombent. Le dépôt n'est jamais modifié.
 *
 * Code de sortie 1 si une mutation survit ou si un motif n'est plus trouvé
 * exactement une fois.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = path.resolve(decodeURIComponent(new URL('../..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'))
const TEST = 'src/utils/tempsMesure.test.ts'
const TM = 'src/utils/tempsMesure.ts'

/** [nom, motif exact (unique), remplacement] */
const MUTATIONS = [
  ['T1 instant replié modulo 1440', 'const x = t * MIN_MS', 'const x = (((t % 1440) + 1440) % 1440) * MIN_MS'],
  ['T2 date civile repliée', 'const jours = Math.floor(t / 1440)', 'const jours = 0'],
  ['T3 sans correction d\'heure d\'été', 'const e = o === offMinuit ? base + x : base + x + (o - offMinuit) * MIN_MS', 'const e = base + x'],
  ['T4 heure répétée : 2e occurrence', 'if (r.instants.length > 0) return r.instants[0]', 'if (r.instants.length > 0) return r.instants[r.instants.length - 1]'],
  ['T5 heure sautée : décalage d\'après', 'const avant = decalageMin(r.base + r.xs - JOUR_MS)', 'const avant = decalageMin(r.base + r.xs + JOUR_MS)'],
  ['T6 statut tranché sur t brut', 'const approx = base + xs', 'const approx = base + x'],
  ['T7 ambigu non signalé', "r.instants.length === 2 ? 'ambigu'", "r.instants.length === 2 ? 'normal'"],
  ['T8 décalage de jours en heure locale', 'return Math.round((b - a) / JOUR_MS)', 'return Math.trunc((b + decalageMin(b) * MIN_MS - a - decalageMin(a) * MIN_MS) / JOUR_MS)'],
  ['T9 fenêtre fermée à droite', 'return tt >= f.debutMin && tt < f.finMin', 'return tt >= f.debutMin && tt <= f.finMin'],
  ['T10 début = fin : fenêtre vide', 'finMin: f > d ? f : f + 1440', 'finMin: f >= d ? f : f + 1440'],
  ['T11 dates impossibles acceptées', 'getUTCDate() !== j) return NaN', 'getUTCDate() !== j) return ms'],
  ['T12 t illisibles non comptés', 'else tIllisibles++', 'else tIllisibles += 0'],
  ['T13 clé à la seconde tronquée', 'return naif / 1000 + Math.round(t * 60)', 'return naif / 1000 + Math.floor(t * 60)'],
]

const EXCLUS = new Set(['node_modules', '.git', '.local-data', 'dist'])

function copie() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutations-temps-mesure-'))
  for (const e of fs.readdirSync(ROOT)) {
    if (EXCLUS.has(e)) continue
    fs.cpSync(path.join(ROOT, e), path.join(dir, e), { recursive: true })
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  return dir
}

/** Tests en échec dans le fichier de test (suite qui ne charge pas = « ∞ »). */
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
const orig = fs.readFileSync(path.join(dir, TM), 'utf8')
let anomalies = 0
try {
  const base = rejouer(dir)
  if (base.ko !== 0) throw new Error('les tests ne passent pas sur le code NON muté : contrôle impossible')
  console.log(`Référence : ${base.total} tests, tous verts.\n`)
  console.log('Mutation'.padEnd(42) + 'tombent'.padEnd(10) + 'verdict')
  for (const [nom, motif, remplacement] of MUTATIONS) {
    const n = orig.split(motif).length - 1
    if (n !== 1) { console.log(`${nom.padEnd(42)}MOTIF TROUVÉ ${n} FOIS — le code a changé, mettre la liste à jour`); anomalies++; continue }
    fs.writeFileSync(path.join(dir, TM), orig.replace(motif, remplacement))
    const r = rejouer(dir)
    fs.writeFileSync(path.join(dir, TM), orig)
    const tombe = r.ko !== 0
    if (!tombe) anomalies++
    console.log(nom.padEnd(42) + String(r.ko).padEnd(10) + (tombe ? 'tuée' : 'SURVIT — trou de test'))
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
console.log(anomalies ? `\n${anomalies} anomalie(s).` : '\nToutes les mutations sont tuées.')
process.exit(anomalies ? 1 : 0)
